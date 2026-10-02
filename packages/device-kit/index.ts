import { requireNativeModule } from 'expo-modules-core';

const native = requireNativeModule('EmidostDeviceManagement');

export function isSupported(): boolean {
  return native != null;
}

export interface DeviceStatus {
  mode: 'UNMANAGED' | 'DEVICE_ADMIN' | 'DEVICE_OWNER' | 'UNSUPPORTED';
  adminActive: boolean;
  enforcedLocked: boolean;
  hidden: boolean;
  lastLockAssertAt: number;
  kioskActive: boolean;
  // Unlock-wins watermark readback (mirrors LockStateStore + SystemClock).
  lastUnlockedAt: number;
  lastUnlockElapsed: number;
  lastUnlockBoot: number;
  bootCount: number;
  elapsedRealtime: number;
  // True when the SIM baseline has a readable IMSI or ICCID (null on some devices — documented).
  simBaselinePresent: boolean;
}

export interface OemProfile {
  family: string;
  displayName: string;
  needsAutostartGrant: boolean;
  needsBatteryExemption: boolean;
  restrictedSettingsPath: string;
  wirelessDebugGateHint: string;
}

export interface ProtectionStatus {
  device_owner: boolean;
  uninstall_blocked: boolean;
  factory_reset_blocked: boolean;
  safe_boot_blocked: boolean;
  add_user_blocked: boolean;
  debugging_blocked: boolean;
  clock_blocked: boolean;
  outgoing_calls_blocked: boolean;
  frp_apply: boolean;
  frp_accounts_missing: boolean;
  frp_release: boolean;
}

export interface LockResult {
  ok: boolean;
  commandId: string;
  mode?: string;
  enforced?: boolean;
  reason?: string | null;
}

/** One bundled-adb step result (honest per-step reporting). */
export interface AdbStepResult {
  ok: boolean;
  output: string;
  error?: string;
  skipped?: boolean;
  readback?: boolean;
  results?: Array<{ perm: string; ok: boolean; skipped: boolean; output: string }>;
}

/** Transient pairing capture (settings package only, 10-min expiry). */
export interface AdbPairingInfo {
  address: string;
  port: string;
  code: string;
  /** Main wireless-debugging screen "IP address & Port" (connect target); empty until seen. */
  connectHost: string;
  connectPort: string;
  expiresAt: number;
}

export function isDeviceOwner(): Promise<boolean> {
  return native.isDeviceOwner();
}
export function isDeviceAdminEnabled(): Promise<boolean> {
  return native.isDeviceAdminEnabled();
}
export function getManagementMode(): Promise<string> {
  return native.getManagementMode();
}
export function getDeviceManagementStatus(): Promise<DeviceStatus> {
  return native.getDeviceManagementStatus();
}
export function getDeviceInfo(): Promise<{ manufacturer: string; model: string; androidVersion: string; sdkInt: number }> {
  return native.getDeviceInfo();
}
export function lockNow(): Promise<boolean> {
  return native.lockNow();
}
/** Pins the foreground activity into kiosk mode (requires DO + lock-task permit). */
export function enterLockTask(): Promise<boolean> {
  return native.enterLockTask();
}
/** Unpins the foreground activity when the phone is unlocked again. */
export function exitLockTask(): Promise<boolean> {
  return native.exitLockTask();
}
export function executeAuthorizedLock(commandId: string): Promise<LockResult> {
  return native.executeAuthorizedLock(commandId);
}
export function executeAuthorizedUnlock(commandId: string): Promise<{ ok: boolean; commandId: string }> {
  return native.executeAuthorizedUnlock(commandId);
}
export function applyFinancingProtection(active: boolean, frpAccounts: string[]): Promise<{ applied: boolean; status: ProtectionStatus }> {
  return native.applyFinancingProtection(active, JSON.stringify(frpAccounts));
}
export function getProtectionStatus(): Promise<ProtectionStatus> {
  return native.getProtectionStatus();
}
export function setUninstallProtection(active: boolean): Promise<{ applied: boolean; reason?: string }> {
  return native.setUninstallProtection(active);
}
export function getOemProfile(): Promise<OemProfile> {
  return native.getOemProfile();
}
export function openOemAutostartSettings(): Promise<{ opened: boolean }> {
  return native.openOemAutostartSettings();
}
export function openOemBackgroundPopups(): Promise<{ opened: boolean }> {
  return native.openOemBackgroundPopups();
}
export function configureCommandService(baseUrl: string, installationId: string, deviceToken: string): Promise<boolean> {
  return native.configureCommandService(baseUrl, installationId, deviceToken);
}
export function startCommandService(): Promise<boolean> {
  return native.startCommandService();
}
export function stopCommandService(): Promise<boolean> {
  return native.stopCommandService();
}
export function isCommandServiceRunning(): boolean {
  return native.isCommandServiceRunning();
}
export function configureSmsControl(sendersCsv: string, customerCode: string): Promise<boolean> {
  return native.configureSmsControl(sendersCsv, customerCode);
}
export function setSimBaseline(imsi: string | null, iccid: string | null): Promise<boolean> {
  return native.setSimBaseline(imsi, iccid);
}
export function setLoanOutstanding(outstanding: boolean): Promise<boolean> {
  return native.setLoanOutstanding(outstanding);
}
export function hideSelf(): Promise<{ hidden: boolean }> {
  return native.hideSelf();
}
export function unhideSelf(): Promise<{ hidden: boolean }> {
  return native.unhideSelf();
}
export function getHiddenState(): boolean {
  return native.getHiddenState();
}
export function setPinVerify(hash: string): Promise<boolean> {
  return native.setPinVerify(hash);
}
export function verifyDevicePin(pin: string): Promise<boolean> {
  return native.verifyDevicePin(pin);
}
export function hasDevicePin(): boolean {
  return native.hasDevicePin();
}
export function showLockOverlay(title: string, body: string): Promise<{ shown: boolean }> {
  return native.showLockOverlay(title, body);
}
export function showCallOverlay(title: string, body: string, phone: string): Promise<{ shown: boolean }> {
  return native.showCallOverlay(title, body, phone);
}
export function showReminderOverlay(title: string, body: string): Promise<{ shown: boolean }> {
  return native.showReminderOverlay(title, body);
}
export function dismissOverlay(): Promise<boolean> {
  return native.dismissOverlay();
}
export function getSimInfo(): Promise<{ simState: number; carrier: string; phoneNumber: string; imsi: string | null; iccid: string | null }> {
  return native.getSimInfo();
}

/** On-demand location: fetched only when the owner asks (no background tracking). */
export function getLocation(): Promise<{ lat: number; lng: number; accuracy: number; at: number } | null> {
  return native.getLocation();
}

/** App foreground: pull the next command poll into the burst window. */
export function kickCommandService(): Promise<boolean> {
  return native.kickCommandService();
}

/** Mirror a successful sync natively so the 5-day watchdog survives a killed app. */
export function markSyncOkNative(): Promise<boolean> {
  return native.markSyncOkNative();
}

/** Mirror the plan mode natively (lock vs notify_only). */
export function setLockModeNative(mode: 'lock' | 'notify_only'): Promise<boolean> {
  return native.setLockModeNative(mode);
}
export function isAccessibilityEnabled(): Promise<boolean> {
  return native.isAccessibilityEnabled();
}
export function setEnrolmentSessionActive(active: boolean): Promise<boolean> {
  return native.setEnrolmentSessionActive(active);
}
export function getAdbBridgeStatus(): Promise<{ implemented: boolean; note: string }> {
  return native.getAdbBridgeStatus();
}

// Pairing walkthrough helpers (customer app, pre-bind).
export function canDrawOverlays(): Promise<boolean> {
  return native.canDrawOverlays();
}
export function openOverlaySettings(): Promise<boolean> {
  return native.openOverlaySettings();
}
export function openAccessibilitySettings(): Promise<boolean> {
  return native.openAccessibilitySettings();
}
export function openDevelopmentSettings(): Promise<boolean> {
  return native.openDevelopmentSettings();
}
export function getPairingInfo(): Promise<AdbPairingInfo> {
  return native.getPairingInfo();
}
export function clearPairingInfo(): Promise<boolean> {
  return native.clearPairingInfo();
}

// Bundled-adb self-pair steps (background thread; 20 s timeout each).
export function adbPrepare(): Promise<AdbStepResult> {
  return native.adbPrepare();
}
export function adbPair(host: string, port: string, code: string): Promise<AdbStepResult> {
  return native.adbPair(host, port, code);
}
export function adbConnect(host: string, port: string): Promise<AdbStepResult> {
  return native.adbConnect(host, port);
}
export function adbGrantRuntimePermissions(pkg: string): Promise<AdbStepResult> {
  return native.adbGrantRuntimePermissions(pkg);
}
export function adbSetDeviceOwner(pkg: string, adminComponent: string): Promise<AdbStepResult> {
  return native.adbSetDeviceOwner(pkg, adminComponent);
}
export function adbDisableDebugging(): Promise<AdbStepResult> {
  return native.adbDisableDebugging();
}
export function adbDisconnect(host: string, port: string): Promise<AdbStepResult> {
  return native.adbDisconnect(host, port);
}

export function rebootDevice(): Promise<{ ok: boolean; reason?: string }> {
  return native.rebootDevice();
}
export function setTotpSecret(secret: string): Promise<boolean> {
  return native.setTotpSecret(secret);
}
export function verifyTotpUnlock(code: string): Promise<boolean> {
  return native.verifyTotpUnlock(code);
}
/** ALERT command: one notification + the bn/hi overdue voice pair once. */
export function speakAlertOnce(): Promise<boolean> {
  return native.speakAlertOnce();
}
/** REMIND command: one notification + the friendly bn/hi reminder voice pair once. */
export function speakReminderOnce(): Promise<boolean> {
  return native.speakReminderOnce();
}
