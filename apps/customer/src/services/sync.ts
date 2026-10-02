import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as DeviceMgmt from '@emidost/device-kit';
import * as Notifications from 'expo-notifications';
import { dueReminderCopy } from '@emidost/shared';

const KEY_INSTALLATION = 'emidost.installation_id';
const KEY_DEVICE_TOKEN = 'emidost.device_token';
const KEY_REGISTERED = 'emidost.registered';
const KEY_BASELINE = 'emidost.sim_baseline_set';
const KEY_LAST_SYNC_OK = 'emidost.last_sync_ok_at';
const KEY_CACHED_STATE = 'emidost.cached_state';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const FRP_ACCOUNTS = (process.env.EXPO_PUBLIC_FRP_ACCOUNTS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** No-internet watchdog: a lock-enabled loan locks after 5 days offline. */
export const OFFLINE_LOCK_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

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
 * loan hard-locks locally. notify_only plans never lock; they only remind.
 * Returns true when the phone was just locked here.
 */
export async function enforceOfflineWatchdog(): Promise<boolean> {
  const st = await getCachedState();
  if (!st) return false;
  if (st.lock_mode !== 'lock') return false;
  if (st.loan_status !== 'RUNNING' && st.loan_status !== 'NPA') return false;
  const last = await getLastSyncOkAt();
  if (last === 0) return false; // never synced yet: no info to enforce
  if (Date.now() - last < OFFLINE_LOCK_AFTER_MS) return false;
  await DeviceMgmt.executeAuthorizedLock('offline-watchdog');
  return true;
}

/** CSPRNG device identity (Math.random is predictable and must not be used). */
export function randomHex(bytes: number): string {
  const out = Crypto.getRandomBytes(bytes);
  return Array.from(out).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_INSTALLATION);
  if (existing) return existing;
  const fresh = randomHex(16);
  await AsyncStorage.setItem(KEY_INSTALLATION, fresh);
  return fresh;
}

export async function getDeviceToken(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_DEVICE_TOKEN);
  if (existing) return existing;
  const fresh = randomHex(32);
  await AsyncStorage.setItem(KEY_DEVICE_TOKEN, fresh);
  return fresh;
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
        token,
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
  next_due: { due_date: string; amount_due: number } | null;
  overdue_days: number;
  retailer_phone: string | null;
}

export async function pollOnce(): Promise<PollUiState | null> {
  const installationId = await getInstallationId();
  const deviceToken = await getDeviceToken();
  const stBefore = await DeviceMgmt.getDeviceManagementStatus();
  // App foreground: pull the native poll into the burst window once.
  await DeviceMgmt.kickCommandService();
  let resp: any;
  try {
    const res = await fetch(`${API_URL}/api/device/heartbeat?installation_id=${installationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify({ mode: stBefore.mode }),
    });
    if (!res.ok) return null;
    resp = await res.json();
  } catch {
    return null;
  }

  const ui: PollUiState = {
    next_due: resp?.next_due ?? null,
    overdue_days: resp?.overdue_days ?? 0,
    retailer_phone: resp?.retailer_phone ?? null,
  };

  // Full offline capability: persist the server truth locally, and remember
  // the successful sync (the 5-day no-internet watchdog counts from here).
  await saveCachedState({
    loan_status: resp?.loan_status ?? '',
    lock_mode: resp?.lock_mode ?? 'lock',
    next_due: resp?.next_due?.due_date ?? null,
    next_due_amount: resp?.next_due?.amount_due ?? null,
    overdue_days: resp?.overdue_days ?? 0,
    emi_amount: resp?.emi_amount ?? null,
    emi_months: resp?.emi_months ?? null,
    emi_due_day: resp?.emi_due_day ?? null,
    retailer_phone: resp?.retailer_phone ?? null,
    retailer_name: resp?.retailer_name ?? null,
    customer_code: resp?.customer_code ?? null,
    is_locked: Boolean(resp?.is_locked),
  });
  await markSyncOk();

  const loanStatus: string = resp?.loan_status ?? '';
  if (loanStatus === 'COMPLETE' || loanStatus === 'SETTLED') {
    // Release-first: unlock, stop the sentinel, clear protection, unhide,
    // and cancel every reminder.
    await cancelReminders();
    await DeviceMgmt.executeAuthorizedUnlock('settled');
    await DeviceMgmt.setLoanOutstanding(false);
    await DeviceMgmt.applyFinancingProtection(false, []);
    await DeviceMgmt.unhideSelf();
    return ui;
  }

  // Reminders follow the DB truth while the loan is outstanding.
  if (ui.next_due) await scheduleReminders(ui.next_due);
  else await cancelReminders();

  if (loanStatus === 'RUNNING' || loanStatus === 'NPA') {
    await DeviceMgmt.setLoanOutstanding(true);
    await DeviceMgmt.applyFinancingProtection(true, FRP_ACCOUNTS);
  }

  if (resp?.retailer_phone && resp?.customer_code) {
    await DeviceMgmt.configureSmsControl(String(resp.retailer_phone), String(resp.customer_code));
  }
  if (resp?.pin_verify) {
    await DeviceMgmt.setPinVerify(String(resp.pin_verify));
  }
  if (resp?.totp_secret) {
    await DeviceMgmt.setTotpSecret(String(resp.totp_secret));
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
  if (loanStatus === 'RUNNING' || loanStatus === 'NPA') {
    const st = await DeviceMgmt.getDeviceManagementStatus();
    if (st.mode === 'DEVICE_OWNER' && !st.hidden) {
      await DeviceMgmt.hideSelf();
    }
  }

  // Commands: the native hard-lock gate is authoritative. No stale-lock math
  // here (the native command service owns the unlock-wins watermark).
  const commands: any[] = Array.isArray(resp?.commands) ? resp.commands : [];
  for (const cmd of commands) {
    if (cmd.status !== 'PENDING' && cmd.status !== 'RECEIVED') continue;
    if (cmd.command_type === 'LOCK') {
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
 * Schedule the −3/−1/0/+1/+3 reminder set from the next due date. Previous
 * scheduled reminders are replaced, so the set always matches the DB.
 */
export async function scheduleReminders(nextDue: { due_date: string; amount_due: number } | null): Promise<void> {
  await ensureReminderChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!nextDue) return;
  const amount = `Rs ${Number(nextDue.amount_due).toFixed(0)}`;
  const due = new Date(`${nextDue.due_date}T09:00:00`);
  const offsets = [-3, -1, 0, 1, 3];
  for (const off of offsets) {
    const at = new Date(due.getTime() + off * 86_400_000);
    if (at.getTime() < Date.now()) continue;
    const copy = dueReminderCopy(nextDue.due_date, amount, Math.max(0, off));
    await Notifications.scheduleNotificationAsync({
      content: { title: 'EMI reminder', body: copy.en, sound: 'default' },
      trigger: { date: at, channelId: 'emidost-reminders' },
    });
  }
}

export async function cancelReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
