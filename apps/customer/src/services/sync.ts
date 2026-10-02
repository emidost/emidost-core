import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as DeviceMgmt from '@emidost/device-kit';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';
import {
  dueReminderCopy, isLockCommandStale, isoToEpochMillis,
  type HeartbeatNextDue, type HeartbeatRequest, type HeartbeatResponse,
} from '@emidost/shared';

const KEY_INSTALLATION = 'emidost.installation_id';
const KEY_DEVICE_TOKEN = 'emidost.device_token';
const KEY_REGISTERED = 'emidost.registered';
const KEY_BASELINE = 'emidost.sim_baseline_set';
const KEY_LAST_SYNC_OK = 'emidost.last_sync_ok_at';
const KEY_CACHED_STATE = 'emidost.cached_state';
const KEY_PHOTO_URL = 'emidost.photo_url_seen';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const FRP_ACCOUNTS = (process.env.EXPO_PUBLIC_FRP_ACCOUNTS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** No-internet watchdog: a lock-enabled loan locks after 5 days offline. */
export const OFFLINE_LOCK_AFTER_MS = 5 * 24 * 60 * 60 * 1000;
/** User rule: an overdue phone auto-blocks after 4 days with no update and no internet. */
export const OVERDUE_OFFLINE_LOCK_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

/** Whole days since the cached due date, in device-local time; 0 on any parse failure. */
function daysSinceDue(due: string | null): number {
  if (!due) return 0;
  const dueMs = Date.parse(`${due}T00:00:00`);
  if (!Number.isFinite(dueMs)) return 0;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.max(0, Math.floor((todayStart - dueMs) / 86_400_000));
}

/**
 * Customer photo cache. The heartbeat's signed photo_url is downloaded once
 * per URL change and shown from local storage on the lock screen, so it works
 * offline. Failures here never disturb the lock flow (the photo is a UX
 * nicety; the lock is local and unaffected).
 */
export const PHOTO_FILE_URI = `${FileSystem.documentDirectory}reminder-photo.jpg`;

export async function syncCustomerPhoto(photoUrl: string | null): Promise<void> {
  try {
    const seen = await AsyncStorage.getItem(KEY_PHOTO_URL);
    if (photoUrl && photoUrl !== seen) {
      const tmp = await FileSystem.downloadAsync(photoUrl, `${FileSystem.documentDirectory}reminder-photo.tmp.jpg`);
      if (tmp.status === 200) {
        await FileSystem.moveAsync({ from: tmp.uri, to: PHOTO_FILE_URI });
        await AsyncStorage.setItem(KEY_PHOTO_URL, photoUrl);
      }
    } else if (!photoUrl) {
      const info = await FileSystem.getInfoAsync(PHOTO_FILE_URI);
      if (info.exists) await FileSystem.deleteAsync(PHOTO_FILE_URI, { idempotent: true });
      await AsyncStorage.removeItem(KEY_PHOTO_URL);
    }
  } catch {
    // Download failures are swallowed: the photo simply does not show.
  }
}

export async function cachedPhotoExists(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(PHOTO_FILE_URI);
    return info.exists;
  } catch {
    return false;
  }
}

export interface CachedState {
  loan_status: string;
  lock_mode: 'lock' | 'notify_only';
  next_due: string | null;
  next_due_amount: number | null;
  overdue_days: number;
  emi_amount: number | null;
  emi_months: number | null;
  emi_due_day: number | null;
  retailer_phone: string | null;
  retailer_name: string | null;
  customer_code: string | null;
  is_locked: boolean;
}

export async function getCachedState(): Promise<CachedState | null> {
  const raw = await AsyncStorage.getItem(KEY_CACHED_STATE);
  if (!raw) return null;
  try { return JSON.parse(raw) as CachedState; } catch { return null; }
}

export async function saveCachedState(s: CachedState): Promise<void> {
  await AsyncStorage.setItem(KEY_CACHED_STATE, JSON.stringify(s));
}

export async function getLastSyncOkAt(): Promise<number> {
  const raw = await AsyncStorage.getItem(KEY_LAST_SYNC_OK);
  return raw ? parseInt(raw, 10) : 0;
}

export async function markSyncOk(): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_SYNC_OK, String(Date.now()));
}

/**
 * Offline enforcement: with no successful sync for 5 days, a lock-enabled
 * loan hard-locks locally. User rule: an OVERDUE phone (>= 1 day, from the
 * cached overdue_days or the cached due date) auto-blocks after 4 days with
 * no update and no internet. Not gated on escalation_enabled (that stops the
 * voice alerts + location SMS only, never locks). notify_only plans never
 * lock; they only remind. Returns true when the phone was just locked here.
 */
export async function enforceOfflineWatchdog(): Promise<boolean> {
  const st = await getCachedState();
  if (!st) return false;
  if (st.lock_mode !== 'lock') return false;
  if (st.loan_status !== 'RUNNING' && st.loan_status !== 'NPA') return false;
  const last = await getLastSyncOkAt();
  if (last === 0) return false; // never synced yet: no info to enforce
  const sinceSync = Date.now() - last;
  const overdue = Math.max(st.overdue_days ?? 0, daysSinceDue(st.next_due ?? null));
  if (overdue >= 1 && sinceSync >= OVERDUE_OFFLINE_LOCK_AFTER_MS) {
    await DeviceMgmt.executeAuthorizedLock('overdue-offline-watchdog-4d');
    return true;
  }
  if (sinceSync < OFFLINE_LOCK_AFTER_MS) return false;
  await DeviceMgmt.executeAuthorizedLock('offline-watchdog');
  return true;
}

/** CSPRNG device identity (Math.random is predictable and must not be used). */
export function randomHex(bytes: number): string {
  const out = Crypto.getRandomBytes(bytes);
  return Array.from(out).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Identity never changes once minted; keep it in memory after the first read
// instead of hitting AsyncStorage on every poll and ack.
let installationIdMem: string | null = null;
let deviceTokenMem: string | null = null;

export async function getInstallationId(): Promise<string> {
  if (installationIdMem) return installationIdMem;
  const existing = await AsyncStorage.getItem(KEY_INSTALLATION);
  if (existing) return (installationIdMem = existing);
  const fresh = randomHex(16);
  await AsyncStorage.setItem(KEY_INSTALLATION, fresh);
  return (installationIdMem = fresh);
}

export async function getDeviceToken(): Promise<string> {
  if (deviceTokenMem) return deviceTokenMem;
  const existing = await AsyncStorage.getItem(KEY_DEVICE_TOKEN);
  if (existing) return (deviceTokenMem = existing);
  const fresh = randomHex(32);
  await AsyncStorage.setItem(KEY_DEVICE_TOKEN, fresh);
  return (deviceTokenMem = fresh);
}

// Last value applied per native setting this process. The poll runs every
// 60 s; re-applying unchanged policies, SMS config and reminder sets each
// round is wasted native work. Process restart clears it, so the first poll
// always applies everything.
const applied = new Map<string, string>();
async function applyOnce(key: string, signature: string, fn: () => Promise<unknown>): Promise<void> {
  if (applied.get(key) === signature) return;
  await fn();
  applied.set(key, signature);
}

export async function isRegistered(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_REGISTERED)) === '1';
}

/**
 * First-run binding: the retailer hands over the enrolment token (from the
 * portal session). Registers the installation, then starts the native sync.
 */
export async function registerWithToken(token: string, deviceInfo: { manufacturer: string; model: string; os_version: string }): Promise<{ ok: boolean; error?: string }> {
  const installationId = await getInstallationId();
  const deviceToken = await getDeviceToken();
  try {
    const res = await fetch(`${API_URL}/api/device/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token.trim().toLowerCase(),
        installation_id: installationId,
        device_token: deviceToken,
        ...deviceInfo,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    await AsyncStorage.setItem(KEY_REGISTERED, '1');
    await startSync();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

/** Start the native foreground command service (app closed, boot-started). */
export async function startSync(): Promise<void> {
  const installationId = await getInstallationId();
  const deviceToken = await getDeviceToken();
  await DeviceMgmt.configureCommandService(API_URL, installationId, deviceToken);
  await DeviceMgmt.startCommandService();
}

/**
 * JS-side poll while the app is open: applies policies, runs commands (the
 * native hard-lock gate is authoritative), keeps PIN/SMS/FRP configured,
 * hides the app once the phone is an activated Device Owner. Returns UI
 * state for the screens.
 */
export interface PollUiState {
  next_due: HeartbeatNextDue | null;
  overdue_days: number;
  retailer_phone: string | null;
}

export async function pollOnce(): Promise<PollUiState | null> {
  const installationId = await getInstallationId();
  const deviceToken = await getDeviceToken();
  const stBefore = await DeviceMgmt.getDeviceManagementStatus();
  // App foreground: pull the native poll into the burst window once.
  await DeviceMgmt.kickCommandService();
  let resp: HeartbeatResponse;
  try {
    // The device reports its own live state; the server reconciles
    // devices.is_locked from the enforcedLocked readback (web scope).
    const body: HeartbeatRequest = { mode: stBefore.mode, locked: stBefore.enforcedLocked };
    const res = await fetch(`${API_URL}/api/device/heartbeat?installation_id=${installationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    resp = (await res.json()) as HeartbeatResponse;
  } catch {
    return null;
  }

  const ui: PollUiState = {
    next_due: resp.next_due ?? null,
    overdue_days: resp.overdue_days ?? 0,
    retailer_phone: resp.retailer_phone ?? null,
  };

  // Full offline capability: persist the server truth locally, and remember
  // the successful sync (the 5-day no-internet watchdog counts from here).
  await saveCachedState({
    loan_status: resp.loan_status ?? '',
    lock_mode: resp.lock_mode ?? 'lock',
    next_due: resp.next_due?.due_date ?? null,
    next_due_amount: resp.next_due?.amount_due ?? null,
    overdue_days: resp.overdue_days ?? 0,
    emi_amount: resp.emi_amount ?? null,
    emi_months: resp.emi_months ?? null,
    emi_due_day: resp.emi_due_day ?? null,
    retailer_phone: resp.retailer_phone ?? null,
    retailer_name: resp.retailer_name ?? null,
    customer_code: resp.customer_code ?? null,
    is_locked: resp.is_locked === true,
  });
  await markSyncOk();
  // Native mirror: the watchdog must work with the app closed or killed.
  await DeviceMgmt.markSyncOkNative();
  // Customer photo cache (offline lock-screen image; failures never disturb
  // the lock flow — the helper swallows its own errors).
  await syncCustomerPhoto(resp.photo_url ?? null);
  const lockMode = resp.lock_mode === 'notify_only' ? 'notify_only' : 'lock';
  await applyOnce('lock_mode', lockMode, () => DeviceMgmt.setLockModeNative(lockMode));

  const loanStatus: string = resp.loan_status ?? '';
  if (loanStatus === 'COMPLETE' || loanStatus === 'SETTLED') {
    // Release-first: unlock, stop the sentinel, clear protection, unhide,
    // and cancel every reminder. Once per process; the native service
    // repeats the release on its own ticks.
    await applyOnce('release', 'done', async () => {
      await cancelReminders();
      await DeviceMgmt.executeAuthorizedUnlock('settled');
      await DeviceMgmt.setLoanOutstanding(false);
      await DeviceMgmt.applyFinancingProtection(false, []);
      await DeviceMgmt.unhideSelf();
    });
    return ui;
  }

  // Reminders follow the DB truth while the loan is outstanding; the set is
  // rebuilt only when the next due date or amount changes.
  const dueSig = ui.next_due ? `${ui.next_due.due_date}|${ui.next_due.amount_due}` : 'none';
  await applyOnce('reminders', dueSig, () => (ui.next_due ? scheduleReminders(ui.next_due) : cancelReminders()));

  if (loanStatus === 'RUNNING' || loanStatus === 'NPA') {
    await applyOnce('protection', FRP_ACCOUNTS.join(','), async () => {
      await DeviceMgmt.setLoanOutstanding(true);
      await DeviceMgmt.applyFinancingProtection(true, FRP_ACCOUNTS);
    });
  }

  if (resp.retailer_phone && resp.customer_code) {
    const phone = String(resp.retailer_phone);
    const code = String(resp.customer_code);
    await applyOnce('sms', `${phone}|${code}`, () => DeviceMgmt.configureSmsControl(phone, code));
  }
  if (resp.pin_verify) {
    const pin = String(resp.pin_verify);
    await applyOnce('pin_verify', pin, () => DeviceMgmt.setPinVerify(pin));
  }
  if (resp.totp_secret) {
    const totp = String(resp.totp_secret);
    await applyOnce('totp', totp, () => DeviceMgmt.setTotpSecret(totp));
  }

  // SIM-swap baseline: set exactly once (a replacement SIM must never become
  // the new baseline silently; IMSI/ICCID may be null on some devices).
  if (loanStatus === 'RUNNING' || loanStatus === 'NPA') {
    const baselineSet = await AsyncStorage.getItem(KEY_BASELINE);
    if (baselineSet !== '1') {
      const sim = await DeviceMgmt.getSimInfo();
      if (sim && (sim.imsi || sim.iccid)) {
        await DeviceMgmt.setSimBaseline(sim.imsi ?? null, sim.iccid ?? null);
        await AsyncStorage.setItem(KEY_BASELINE, '1');
      }
    }
  }

  // Hide "wifi" from the launcher once the phone is an activated Device Owner.
  if ((loanStatus === 'RUNNING' || loanStatus === 'NPA') && stBefore.mode === 'DEVICE_OWNER' && !stBefore.hidden) {
    await DeviceMgmt.hideSelf();
  }

  // Commands: the native hard-lock gate is authoritative, and the unlock-wins
  // watermark is checked here too (same math as the native service), so a
  // stale LOCK is never executed by the JS path while the app is foregrounded.
  const commands = resp.commands ?? [];
  for (const cmd of commands) {
    if (cmd.status !== 'PENDING' && cmd.status !== 'RECEIVED') continue;
    if (cmd.command_type === 'LOCK') {
      const stale = isLockCommandStale({
        commandCreatedServerMs: isoToEpochMillis(String(cmd.created_at ?? '')),
        serverNowMs: isoToEpochMillis(String(resp.server_now ?? '')),
        lastUnlockWallMs: Number(stBefore.lastUnlockedAt ?? 0),
        lastUnlockElapsedMs: Number(stBefore.lastUnlockElapsed ?? 0),
        nowElapsedMs: Number(stBefore.elapsedRealtime ?? 0),
        unlockBoot: Number(stBefore.lastUnlockBoot ?? -1),
        nowBoot: Number(stBefore.bootCount ?? -1),
        nowWallMs: Date.now(),
      });
      if (stale) {
        await ack(cmd.id, 'SUPERSEDED', 'stale_lock_unlock_wins');
        continue;
      }
      const result = await DeviceMgmt.executeAuthorizedLock(String(cmd.id));
      if (result.ok) await ack(cmd.id, 'EXECUTED');
      else await ack(cmd.id, 'FAILED', result.reason ?? 'hard_lock_refused');
    } else if (cmd.command_type === 'UNLOCK') {
      await DeviceMgmt.executeAuthorizedUnlock(String(cmd.id));
      await ack(cmd.id, 'EXECUTED');
    } else if (cmd.command_type === 'RELEASE') {
      await DeviceMgmt.executeAuthorizedUnlock(String(cmd.id));
      await DeviceMgmt.setLoanOutstanding(false);
      await DeviceMgmt.applyFinancingProtection(false, []);
      await DeviceMgmt.unhideSelf();
      await ack(cmd.id, 'EXECUTED');
    } else if (cmd.command_type === 'REBOOT') {
      // Orderly reboot scheduled natively ~5 s out, so this ack lands before
      // the device goes down. Refused while locked (no reboot escape) and
      // below API 24.
      const result = await DeviceMgmt.rebootDevice();
      if (result.ok) await ack(cmd.id, 'EXECUTED');
      else await ack(cmd.id, 'FAILED', result.reason ?? 'reboot_refused_while_locked');
    } else if (cmd.command_type === 'ALERT') {
      // One notification + the bn/hi overdue voice pair once.
      const ok = await DeviceMgmt.speakAlertOnce();
      if (ok) await ack(cmd.id, 'EXECUTED');
      else await ack(cmd.id, 'FAILED', 'alert_failed');
    } else if (cmd.command_type === 'LOCATION') {
      // Fetched only when asked; never tracked in the background.
      const loc = await DeviceMgmt.getLocation();
      await ack(cmd.id, 'EXECUTED', undefined, { location: loc ?? {} });
    }
  }
  return ui;
}

async function ack(commandId: string, ackStatus: string, reason?: string, extra?: Record<string, unknown>): Promise<void> {
  const installationId = await getInstallationId();
  const deviceToken = await getDeviceToken();
  try {
    await fetch(`${API_URL}/api/device/command/ack?installation_id=${installationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify({ command_id: commandId, ack_status: ackStatus, reason, ...(extra ?? {}) }),
    });
  } catch {
    // next poll retries
  }
}

/**
 * Hidden lock-screen unlock: the portal-set device PIN or an owner-issued
 * TOTP (8 digits) unlocks the phone locally, fully offline. A code unlock has
 * no command id, so the server's command acks are handled by the next poll
 * (any pending UNLOCK/RELEASE commands are acked then) and the native service.
 */
export async function unlockWithCode(code: string): Promise<{ ok: boolean; method: 'pin' | 'totp' | null }> {
  if (await DeviceMgmt.verifyDevicePin(code)) {
    await DeviceMgmt.executeAuthorizedUnlock('pin-code');
    await DeviceMgmt.kickCommandService();
    return { ok: true, method: 'pin' };
  }
  if (await DeviceMgmt.verifyTotpUnlock(code)) {
    await DeviceMgmt.executeAuthorizedUnlock('totp-code');
    await DeviceMgmt.kickCommandService();
    return { ok: true, method: 'totp' };
  }
  return { ok: false, method: null };
}

let reminderChannelReady = false;
async function ensureReminderChannel(): Promise<void> {
  if (reminderChannelReady) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('emidost-reminders', {
      name: 'EMI reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  reminderChannelReady = true;
}

/**
 * Schedule the −3/−1/0/+1/+3 reminder set from the next due date. The due day
 * itself fires THREE times (10:00, 14:00, 20:00 local); the surrounding days
 * stay at 09:00. Previous scheduled reminders are replaced, so the set always
 * matches the DB.
 */
export async function scheduleReminders(nextDue: HeartbeatNextDue | null): Promise<void> {
  await ensureReminderChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!nextDue) return;
  const amount = `Rs ${Number(nextDue.amount_due ?? 0).toFixed(0)}`;
  const dueDay = new Date(`${nextDue.due_date}T00:00:00`);
  const offsets = [-3, -1, 0, 1, 3];
  for (const off of offsets) {
    const hours = off === 0 ? [10, 14, 20] : [9];
    for (const h of hours) {
      const at = new Date(dueDay.getTime() + off * 86_400_000 + h * 3_600_000);
      if (at.getTime() < Date.now()) continue;
      const copy = dueReminderCopy(nextDue.due_date, amount, Math.max(0, off));
      await Notifications.scheduleNotificationAsync({
        content: { title: 'EMI reminder', body: copy.en, sound: 'default' },
        trigger: { date: at, channelId: 'emidost-reminders' },
      });
    }
  }
}

export async function cancelReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
