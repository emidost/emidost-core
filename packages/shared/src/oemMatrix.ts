// Verified OEM matrix (port of the TelePoint research wave; sources in
// docs/OEM_COMPATIBILITY.md there, reproduced in oemMatrixNotes below).
// A family is "certified" only after a real device passes the acceptance walk.

export type OemFamily =
  | 'NEAR_STOCK' | 'SAMSUNG' | 'XIAOMI' | 'VIVO'
  | 'OPPO' | 'HONOR' | 'TRANSSION' | 'UNKNOWN';

export type OemConfidence = 'VERIFIED' | 'EXPECTED' | 'TEST_REQUIRED' | 'UNSUPPORTED';

export interface OemProfile {
  family: OemFamily;
  displayName: string;
  needsAutostartGrant: boolean;
  needsBatteryExemption: boolean;
  restrictedSettingsPath: string;
  wirelessDebugGateHint: string;
  screenPinReset: OemConfidence;
  emergencyDialTestRequired: boolean;
  powerMenuRisk: boolean;
  setupSteps: string[];
}

const M = (m: string) => m.toLowerCase();

export function detectFamily(manufacturer: string, brand: string): OemFamily {
  const m = M(manufacturer || '');
  const b = M(brand || '');
  if (/xiaomi|redmi|poco/.test(m + b)) return 'XIAOMI';
  if (/vivo|iqoo/.test(m)) return 'VIVO';
  if (/oppo|realme|oneplus/.test(m)) return 'OPPO';
  if (/huawei|honor|hihonor/.test(m)) return 'HONOR';
  if (/samsung/.test(m)) return 'SAMSUNG';
  if (/tecno|infinix|itel|transsion/.test(m)) return 'TRANSSION';
  if (/motorola|nothing|cmf|lava|hmd|nokia|google|pixel/.test(m)) return 'NEAR_STOCK';
  return 'UNKNOWN';
}

export function getOemProfile(manufacturer: string, brand: string): OemProfile {
  const family = detectFamily(manufacturer, brand);
  switch (family) {
    case 'XIAOMI':
      return {
        family, displayName: 'Xiaomi / Redmi / POCO (HyperOS / MIUI)',
        needsAutostartGrant: true, needsBatteryExemption: true,
        restrictedSettingsPath: 'Settings → Apps → Manage apps → wifi → ⋮ → Allow restricted settings',
        wirelessDebugGateHint:
          'Wireless pairing needs no Mi account or SIM. Turn off MIUI Optimization, keep notification style set to Native, and re-check Developer options after security scans. The input-injection toggle does require a Mi account; enrolment does not use it.',
        screenPinReset: 'UNSUPPORTED', emergencyDialTestRequired: true, powerMenuRisk: true,
        setupSteps: [
          'Factory reset, skip every account, set no lock PIN',
          'Developer options: tap OS version 7 times',
          'Turn off MIUI Optimization',
          'Allow restricted settings on the app info page',
          'Grant autostart in Security Center and set battery to No restrictions',
        ],
      };
    case 'VIVO':
      return {
        family, displayName: 'vivo / iQOO (Funtouch OS)',
        needsAutostartGrant: true, needsBatteryExemption: true,
        restrictedSettingsPath: 'Settings → Apps → App management → app → ⋮ → Allow restricted settings',
        wirelessDebugGateHint:
          'No account or SIM needed for wireless pairing. Only the extra USB security toggles ask for a vivo account.',
        screenPinReset: 'UNSUPPORTED', emergencyDialTestRequired: true, powerMenuRisk: true,
        setupSteps: [
          'Factory reset, skip every account, set no lock PIN',
          'Developer options: tap Software version 7 times',
          'Grant background startup in iManager',
          'Grant background pop-up windows',
          'Allow restricted settings on the app info page',
        ],
      };
    case 'OPPO':
      return {
        family, displayName: 'OPPO / OnePlus / realme (ColorOS / OxygenOS)',
        needsAutostartGrant: true, needsBatteryExemption: true,
        restrictedSettingsPath: 'Settings → Apps → App management → app → ⋮ → Allow restricted settings',
        wirelessDebugGateHint:
          'Turn off permission monitoring in Developer options (ColorOS 15) or it revokes accessibility and adb. Keep the screen on during enrolment; adb Wi-Fi can drop when the screen turns off.',
        screenPinReset: 'UNSUPPORTED', emergencyDialTestRequired: true, powerMenuRisk: true,
        setupSteps: [
          'Factory reset, skip every account, set no lock PIN',
          'Developer options: tap Build number 7 times',
          'Turn off permission monitoring',
          'Grant autostart and allow background activity',
          'Allow restricted settings on the app info page',
        ],
      };
    case 'HONOR':
      return {
        family, displayName: 'HONOR (MagicOS)',
        needsAutostartGrant: true, needsBatteryExemption: true,
        restrictedSettingsPath: 'Settings → Apps → app → ⋮ → Allow restricted settings',
        wirelessDebugGateHint:
          'No account needed. After activation set App launch: auto-launch, secondary launch, and run in background.',
        screenPinReset: 'UNSUPPORTED', emergencyDialTestRequired: true, powerMenuRisk: true,
        setupSteps: [
          'Factory reset, skip every account, set no lock PIN',
          'Developer options: tap Build number 7 times',
          'Allow restricted settings on the app info page',
          'App launch: auto-launch + secondary launch + run in background',
          'Battery: no restrictions',
        ],
      };
    case 'SAMSUNG':
      return {
        family, displayName: 'Samsung (One UI)',
        needsAutostartGrant: false, needsBatteryExemption: true,
        restrictedSettingsPath: 'Settings → Apps → app → ⋮ (top-right) → Allow restricted settings',
        wirelessDebugGateHint:
          'Turn off Samsung Auto Blocker first: it is on by default from One UI 6 and blocks APK installs, USB commands, and under Maximum restrictions device-admin apps. Use wireless pairing, not USB.',
        screenPinReset: 'UNSUPPORTED', emergencyDialTestRequired: true, powerMenuRisk: true,
        setupSteps: [
          'Factory reset, skip every account, set no lock PIN',
          'Turn off Auto Blocker in Settings → Security and privacy',
          'Developer options: tap Build number 7 times',
          'Allow restricted settings on the app info page',
          'Battery → app → Unrestricted (re-check after OS updates)',
        ],
      };
    case 'TRANSSION':
      return {
        family, displayName: 'TECNO / Infinix / itel (HiOS / XOS / itel OS)',
        needsAutostartGrant: true, needsBatteryExemption: true,
        restrictedSettingsPath: 'Settings → Apps → app → ⋮ → Allow restricted settings',
        wirelessDebugGateHint:
          'No account needed. Keep "Disable permission monitoring" off in Phone Master, or adb and wireless debugging grey out.',
        screenPinReset: 'UNSUPPORTED', emergencyDialTestRequired: true, powerMenuRisk: true,
        setupSteps: [
          'Factory reset, skip every account, set no lock PIN',
          'Developer options: tap Build number 7 times',
          'Keep permission monitoring off in Phone Master',
          'Grant auto-start in Phone Master',
          'Allow restricted settings on the app info page',
        ],
      };
    case 'NEAR_STOCK':
    case 'UNKNOWN':
      return {
        family,
        displayName: family === 'UNKNOWN' ? 'Unknown OEM' : 'Pixel / Motorola / Nothing / CMF / Lava / HMD (near-stock)',
        needsAutostartGrant: false, needsBatteryExemption: false,
        restrictedSettingsPath: 'Settings → Apps → app → ⋮ → Allow restricted settings',
        wirelessDebugGateHint: 'No account needed. Developer options via Build number 7 taps.',
        screenPinReset: 'UNSUPPORTED', emergencyDialTestRequired: true, powerMenuRisk: false,
        setupSteps: [
          'Factory reset, skip every account, set no lock PIN',
          'Developer options: tap Build number 7 times',
          'Allow restricted settings on the app info page',
        ],
      };
  }
}

export const OEM_NOTES = {
  platform: [
    'dpm set-device-owner works over wireless adb on Android 11+; blockers are any Google account, secondary users, a pre-existing passcode, or an existing owner/admin (factory reset required).',
    'resetPassword() is unavailable to Device Owner apps on Android 11+, so the screen PIN feature is a force-PIN-change policy, not a remote PIN set.',
    'DISALLOW_OUTGOING_CALLS keeps emergency calls dialable; test 112 per family anyway.',
    'LOCK_TASK_FEATURE_GLOBAL_ACTIONS is on by default until setLockTaskFeatures is called; the lock must clear it explicitly or the power menu keeps a Reboot entry.',
    'Android 13+ blocks sideloaded-app accessibility/notification/overlay until "Allow restricted settings" is tapped on the app info page.',
  ],
  perFamily: {
    XIAOMI: 'MIUI 14 MediaTek pairing crash: fall back to the provisioning QR, not adb tcpip (which needs a PC).',
    SAMSUNG: 'Auto Blocker is the first gate. Re-check the Unrestricted battery entry after OS updates; Samsung re-sleeps apps.',
    OPPO: 'ColorOS 15 permission monitoring auto-revokes accessibility and adb; disable it first.',
    TRANSSION: 'Auto-start lives in Phone Master (com.cyin.himgr.autostart.AutoStartActivity).',
    HONOR: 'No stable exported autostart activity is verified; use the 3-toggle walkthrough.',
  } as Record<string, string>,
} as const;
