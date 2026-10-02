import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DeviceMgmt from '@emidost/device-kit';

const KEY_INSTALLATION = 'emidost.installation_id';
const KEY_DEVICE_TOKEN = 'emidost.device_token';
const KEY_REGISTERED = 'emidost.registered';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const FRP_ACCOUNTS = (process.env.EXPO_PUBLIC_FRP_ACCOUNTS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

export function randomInstallationId(): string {
  const chars = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_INSTALLATION);
  if (existing) return existing;
  const fresh = randomInstallationId();
  await AsyncStorage.setItem(KEY_INSTALLATION, fresh);
  return fresh;
}

export async function getDeviceToken(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_DEVICE_TOKEN);
  if (existing) return existing;
  const fresh = randomInstallationId() + randomInstallationId();
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

  const loanStatus: string = resp?.loan_status ?? '';
  if (loanStatus === 'COMPLETE' || loanStatus === 'SETTLED') {
    // Release-first: unlock, stop the sentinel, clear protection, unhide.
    await DeviceMgmt.executeAuthorizedUnlock('settled');
    await DeviceMgmt.setLoanOutstanding(false);
    await DeviceMgmt.applyFinancingProtection(false, []);
    await DeviceMgmt.unhideSelf();
    return ui;
  }

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

  // SIM-swap baseline (IMSI/ICCID may be null on some devices; documented).
  if (loanStatus === 'RUNNING' || loanStatus === 'NPA') {
    const sim = await DeviceMgmt.getSimInfo();
    if (sim && (sim.imsi || sim.iccid)) {
      await DeviceMgmt.setSimBaseline(sim.imsi ?? null, sim.iccid ?? null);
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
    }
  }
  return ui;
}

async function ack(commandId: string, ackStatus: string, reason?: string): Promise<void> {
  const installationId = await getInstallationId();
  const deviceToken = await getDeviceToken();
  try {
    await fetch(`${API_URL}/api/device/command/ack?installation_id=${installationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify({ command_id: commandId, ack_status: ackStatus, reason }),
    });
  } catch {
    // next poll retries
  }
}
