import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Image, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { KeyRound, Lock, PhoneCall, Settings2, ShieldCheck, Siren, Smartphone, RefreshCw, CircleCheck } from 'lucide-react-native';
import * as DeviceMgmt from '@emidost/device-kit';
import {
  colors, getOemProfile, dueReminderCopy, lockScreenCopy, locked as LOCKED, type CopyLang,
} from '@emidost/shared';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import {
  getInstallationId, isRegistered, pollOnce, registerWithToken, startSync,
  getCachedState, enforceOfflineWatchdog, unlockWithCode,
  cachedPhotoExists, PHOTO_FILE_URI,
} from './src/services/sync';

const ACCENT = colors.accentAmber;

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'bind' | 'active'>('loading');
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [photoExists, setPhotoExists] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugTaps, setDebugTaps] = useState(0);
  const [due, setDue] = useState<{ due_date: string; amount_due: number | null } | null>(null);
  const [overdueDays, setOverdueDays] = useState(0);
  const [retailerPhone, setRetailerPhone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  // The loop reads the latest due through a ref, so a new due amount does not
  // restart the interval (which used to fire an extra heartbeat each time).
  const dueRef = useRef(due);
  dueRef.current = due;

  useEffect(() => {
    void (async () => {
      const registered = await isRegistered();
      setPhase(registered ? 'active' : 'bind');
      if (registered) await startSync();
    })();
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    if (phase !== 'active') return;
    const loop = async () => {
      if (inFlight.current) return; // single-flight: never overlap slow rounds
      inFlight.current = true;
      try {
        const ui = await pollOnce();
        let latestDue = dueRef.current;
        if (ui) {
          latestDue = ui.next_due;
          setDue(ui.next_due);
          setOverdueDays(ui.overdue_days);
          setRetailerPhone(ui.retailer_phone);
        } else {
          // Offline: fall back to the synced local copy and run the 5-day
          // no-internet watchdog (lock-enabled plans only).
          const cached = await getCachedState();
          if (cached?.next_due) {
            latestDue = { due_date: cached.next_due, amount_due: cached.next_due_amount ?? 0 };
            setDue(latestDue);
          }
          setOverdueDays(cached?.overdue_days ?? 0);
          setRetailerPhone(cached?.retailer_phone ?? null);
          await enforceOfflineWatchdog();
        }
        const st = await DeviceMgmt.getDeviceManagementStatus();
        setLocked(st.enforcedLocked);
        setHidden(st.hidden);
        setPhotoExists(await cachedPhotoExists());
        if (st.enforcedLocked) {
          await DeviceMgmt.showLockOverlay('Phone locked', latestDue
            ? `Rs ${Number(latestDue.amount_due).toFixed(0)} due. Call your retailer.`
            : 'EMI payment required');
          // Kiosk pinning: lock-task mode only engages when the foreground
          // activity calls startLockTask. Idempotent; re-asserted each loop.
          await DeviceMgmt.enterLockTask();
        } else {
          // Unlock/release: leave lock-task mode so the phone is freely usable.
          await DeviceMgmt.exitLockTask();
        }
      } finally {
        inFlight.current = false;
      }
    };
    void loop();
    // UI refresh only. Enforcement is local, commands arrive by SMS instantly,
    // and the native service polls slowly (2 h idle, 15 s burst) online.
    timer.current = setInterval(loop, 60_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [phase]);

  async function speakReminder() {
    if (!due) return;
    const copy = dueReminderCopy(due.due_date, `Rs ${Number(due.amount_due).toFixed(0)}`, overdueDays);
    Speech.speak(copy.bn, { language: 'bn-IN' });
    Speech.speak(copy.hi, { language: 'hi-IN' });
  }

  if (phase === 'loading') {
    return <View style={s.center}><ActivityIndicator size="large" color={ACCENT} /></View>;
  }

  if (phase === 'bind') {
    return <BindScreen onBound={() => setPhase('active')} />;
  }

  if (locked) {
    return (
      <LockedScreen
        due={due} overdueDays={overdueDays}
        retailerPhone={retailerPhone}
        photoUri={photoExists ? PHOTO_FILE_URI : null}
        onUnlocked={() => { setLocked(false); void pollOnce(); }}
      />
    );
  }

  return (
    <ScrollView style={s.page}>
      {photoExists && (
        <View style={[s.card, { alignItems: 'center' }]}>
          <Image source={{ uri: PHOTO_FILE_URI }} style={s.photoCard} accessible accessibilityLabel="Customer photo" />
        </View>
      )}
      <View style={s.band}><Text style={s.title}>Pay on time. The phone stays yours.</Text></View>
      <View style={s.card}>
        <Text style={s.cardTitle}>Next instalment</Text>
        <Text style={s.amount}>{due ? `Rs ${Number(due.amount_due).toFixed(0)}` : 'No dues'}</Text>
        <Text style={s.muted}>{due ? `Due ${due.due_date}` : 'Everything is paid'}</Text>
      </View>
      <TouchableOpacity style={s.row} onPress={speakReminder}>
        <ShieldCheck color={ACCENT} size={20} />
        <Text style={s.rowText}>Hear the reminder</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.row}
        onPress={() => { if (retailerPhone) void DeviceMgmt.showCallOverlay('Call retailer', retailerPhone, retailerPhone); }}
      >
        <PhoneCall color={ACCENT} size={20} />
        <Text style={s.rowText}>{retailerPhone ? `Call your retailer ${retailerPhone}` : 'Retailer contact'}</Text>
      </TouchableOpacity>
      {/* Diagnostics are store/owner tooling: hidden behind three taps. */}
      <TouchableOpacity
        onPress={() => {
          setDebugTaps((n) => {
            if (n + 1 >= 3) setShowDebug((v) => !v);
            return n + 1 >= 3 ? 0 : n + 1;
          });
        }}
      >
        <Text style={s.muted}>Tap the version three times for device details</Text>
      </TouchableOpacity>
      {showDebug && <Diagnostics hidden={hidden} />}
    </ScrollView>
  );
}

function BindScreen({ onBound }: { onBound: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oem, setOem] = useState<string | null>(null);
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  useEffect(() => {
    void (async () => {
      const info = await DeviceMgmt.getDeviceInfo();
      const profile = await getOemProfile(info.manufacturer, '');
      setOem(profile?.displayName ?? null);
    })();
  }, []);

  async function bind() {
    setBusy(true);
    setError(null);
    const info = await DeviceMgmt.getDeviceInfo();
    const result = await registerWithToken(code.trim(), {
      manufacturer: info.manufacturer, model: info.model, os_version: info.androidVersion,
    });
    setBusy(false);
    if (result.ok) onBound();
    else setError(result.error ?? 'Binding failed');
  }

  if (showWalkthrough) {
    return <PairingWalkthrough onDone={() => setShowWalkthrough(false)} />;
  }

  return (
    <View style={[s.page, { padding: 24 }]}>
      <Smartphone color={ACCENT} size={36} />
      <View style={s.band}><Text style={s.title}>Enter the setup code</Text></View>
      <Text style={s.muted}>The retailer gave you a code with this phone. It binds the phone to your EMI plan.</Text>
      {oem && <Text style={s.muted}>Detected: {oem}</Text>}
      <TextInput
        style={s.input}
        value={code}
        onChangeText={setCode}
        placeholder="Setup code"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error && <Text style={s.error}>{error}</Text>}
      <TouchableOpacity style={s.button} onPress={bind} disabled={busy} accessibilityRole="button" accessibilityLabel="Bind this phone">
        <KeyRound color={colors.onAccent} size={16} />
        <Text style={s.buttonText}>{busy ? 'Binding…' : 'Bind this phone'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.linkRow}
        onPress={() => setShowWalkthrough(true)}
        accessibilityRole="button"
        accessibilityLabel="Wireless pairing walkthrough"
      >
        <Settings2 color={ACCENT} size={16} />
        <Text style={s.linkText}>Wireless pairing walkthrough</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Pre-bind pairing walkthrough: overlay grant → accessibility → wireless
 * debugging → the pairing dialog (ip:port + 6-digit code) shown big for the
 * retailer to type. The accessibility service reads only the settings-package
 * pairing dialog during the authorized session (10-min expiry, cleared on
 * exit or consumption).
 */
function PairingWalkthrough({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [overlayOk, setOverlayOk] = useState<boolean | null>(null);
  const [a11yOk, setA11yOk] = useState<boolean | null>(null);
  const [pairing, setPairing] = useState<DeviceMgmt.AdbPairingInfo | null>(null);
  const [expired, setExpired] = useState(false);

  // Step 1: poll the overlay permission until granted.
  useEffect(() => {
    if (step !== 1) return;
    let active = true;
    const tick = async () => {
      const ok = await DeviceMgmt.canDrawOverlays();
      if (active) setOverlayOk(ok);
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { active = false; clearInterval(t); };
  }, [step]);

  // Step 2: poll the accessibility toggle until the service is on.
  useEffect(() => {
    if (step !== 2) return;
    let active = true;
    const tick = async () => {
      const ok = await DeviceMgmt.isAccessibilityEnabled();
      if (active) setA11yOk(ok);
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { active = false; clearInterval(t); };
  }, [step]);

  // Step 3: keep the authorized session alive and watch for the pairing dialog.
  useEffect(() => {
    if (step !== 3) return;
    let active = true;
    const tick = async () => {
      await DeviceMgmt.setEnrolmentSessionActive(true);
      const info = await DeviceMgmt.getPairingInfo();
      if (active && info.address && info.code) {
        setPairing(info);
        setStep(4);
      }
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { active = false; clearInterval(t); };
  }, [step]);

  // Step 4: watch the 10-min expiry and refresh the connect address when the
  // main wireless-debugging screen is read after the pairing dialog.
  useEffect(() => {
    if (step !== 4 || !pairing) return;
    const t = setInterval(async () => {
      if (pairing.expiresAt > 0 && Date.now() > pairing.expiresAt) {
        setExpired(true);
        return;
      }
      const info = await DeviceMgmt.getPairingInfo();
      if (info.address && info.code) {
        setPairing((prev) => {
          if (!prev) return prev;
          if (prev.connectHost === info.connectHost && prev.connectPort === info.connectPort) return prev;
          return { ...prev, connectHost: info.connectHost, connectPort: info.connectPort };
        });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [step, pairing]);

  // Exit: end the session and wipe the transient pairing values.
  useEffect(() => () => {
    void DeviceMgmt.setEnrolmentSessionActive(false);
    void DeviceMgmt.clearPairingInfo();
  }, []);

  return (
    <View style={[s.page, { padding: 24 }]}>
      <View style={s.band}>
        <TouchableOpacity onPress={onDone} accessibilityRole="button" accessibilityLabel="Back to bind screen">
          <Text style={s.linkText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Wireless pairing</Text>
      </View>

      {step === 1 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Step 1: allow the lock overlay</Text>
          <Text style={s.muted}>The lock screen covers other apps while the EMI is unpaid. Allow drawing over other apps.</Text>
          <TouchableOpacity style={s.button} onPress={() => void DeviceMgmt.openOverlaySettings()} accessibilityRole="button" accessibilityLabel="Open overlay permission">
            <Settings2 color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>Open overlay permission</Text>
          </TouchableOpacity>
          <Text style={s.muted}>{overlayOk ? 'Overlay allowed.' : 'Waiting for the permission…'}</Text>
          <TouchableOpacity style={s.button} onPress={() => setStep(2)} disabled={!overlayOk} accessibilityRole="button" accessibilityLabel="Continue">
            <CircleCheck color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 2 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Step 2: turn on emidost protection</Text>
          <Text style={s.muted}>Open accessibility settings and switch on emidost protection. It reads only the pairing code during this walkthrough.</Text>
          <TouchableOpacity style={s.button} onPress={() => void DeviceMgmt.openAccessibilitySettings()} accessibilityRole="button" accessibilityLabel="Open accessibility settings">
            <Settings2 color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>Open accessibility settings</Text>
          </TouchableOpacity>
          <Text style={s.muted}>{a11yOk ? 'Service is on.' : 'Waiting for the switch…'}</Text>
          <TouchableOpacity style={s.button} onPress={() => setStep(3)} disabled={!a11yOk} accessibilityRole="button" accessibilityLabel="Continue">
            <CircleCheck color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 3 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Step 3: start wireless pairing</Text>
          <Text style={s.muted}>Open developer options, tap Wireless debugging, then Pair device with pairing code. The numbers appear here.</Text>
          <TouchableOpacity style={s.button} onPress={() => void DeviceMgmt.openDevelopmentSettings()} accessibilityRole="button" accessibilityLabel="Open developer options">
            <Settings2 color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>Open developer options</Text>
          </TouchableOpacity>
          <Text style={s.muted}>Watching for the pairing code…</Text>
        </View>
      )}

      {step === 4 && pairing && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Give these numbers to the retailer's phone</Text>
          {expired ? (
            <Text style={s.error}>This pairing code expired. Start a new one on the phone.</Text>
          ) : (
            <>
              <Text style={s.pairLabel}>Pairing port</Text>
              <Text style={s.pairBig} accessibilityLabel={`Pairing address ${pairing.address} port ${pairing.port}`}>
                {pairing.address}:{pairing.port}
              </Text>
              <Text style={s.pairLabel}>Pairing code</Text>
              <Text style={s.pairCode} accessibilityLabel={`Pairing code ${pairing.code}`}>{pairing.code}</Text>
              <Text style={s.pairLabel}>Connect port</Text>
              {pairing.connectHost && pairing.connectPort ? (
                <Text style={s.pairMid} accessibilityLabel={`Connect port ${pairing.connectPort}`}>
                  {pairing.connectHost}:{pairing.connectPort}
                </Text>
              ) : (
                <Text style={s.muted}>Not seen yet. Read it on the phone's Wireless debugging screen.</Text>
              )}
              <Text style={s.muted}>Valid for 10 minutes.</Text>
            </>
          )}
          <TouchableOpacity
            style={s.button}
            onPress={async () => {
              await DeviceMgmt.clearPairingInfo();
              setPairing(null);
              setExpired(false);
              setStep(3);
            }}
            accessibilityRole="button"
            accessibilityLabel={expired ? 'Start again' : 'Clear and pair again'}
          >
            <RefreshCw color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>{expired ? 'Start again' : 'Clear and pair again'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const LOCALE: Record<CopyLang, string> = { en: 'en-IN', bn: 'bn-IN', hi: 'hi-IN' };
const LANG_LABEL: Record<CopyLang, string> = { en: 'English', bn: 'বাংলা', hi: 'हिंदी' };

function formatAmount(n: number | null): string {
  return `Rs ${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDueDate(iso: string, lang: CopyLang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'long' });
  } catch {
    return iso;
  }
}

/**
 * Lock screen. Dark surface = locked. The amount sits at the top in tabular
 * numerals, an amber ring breathes around the padlock, and the three actions
 * (pay now, call retailer, call 112) are always live. The screen reflects the
 * server lock state only; there is no optimistic green.
 */
function LockedScreen(props: {
  due: { due_date: string; amount_due: number | null } | null;
  overdueDays: number;
  retailerPhone: string | null;
  photoUri: string | null;
  onUnlocked: () => void;
}) {
  const [lang, setLang] = useState<CopyLang>('en');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Kiosk pinning re-asserted while the locked screen is mounted (idempotent).
    void DeviceMgmt.enterLockTask();
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (active) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) { ring.setValue(0); return undefined; }
    // Breathing ring: scale 1 to 1.04, opacity 0.5 to 0.2, 3s loop, native driver.
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [reduceMotion, ring]);

  const amount = props.due ? formatAmount(props.due.amount_due) : 'Rs 0';
  const copy = lockScreenCopy(lang, {
    amount,
    dueDate: props.due ? formatDueDate(props.due.due_date, lang) : '',
    retailerPhone: props.retailerPhone ?? '',
    overdueDays: props.overdueDays,
  });
  const message = props.overdueDays > 0 ? copy.overdue : copy.locked;

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.2] });

  function speak() {
    if (message) Speech.speak(message, { language: LOCALE[lang] });
  }

  async function submitCode() {
    if (codeBusy || !code.trim()) return;
    setCodeBusy(true);
    setCodeError(null);
    const result = await unlockWithCode(code.trim());
    setCodeBusy(false);
    if (result.ok) {
      setCode('');
      setShowCode(false);
      props.onUnlocked();
    } else {
      setCodeError('Code not accepted');
    }
  }

  return (
    <View style={s.lockPage}>
      <View style={s.langRow}>
        {(['en', 'bn', 'hi'] as CopyLang[]).map((l) => (
          <TouchableOpacity
            key={l}
            style={[s.langChip, lang === l && s.langChipActive]}
            onPress={() => setLang(l)}
            accessibilityRole="button"
            accessibilityState={{ selected: lang === l }}
          >
            <Text style={[s.langChipText, lang === l && s.langChipTextActive]}>{LANG_LABEL[l]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {props.photoUri && (
        <Image
          source={{ uri: props.photoUri }}
          style={s.photoAvatar}
          accessible
          accessibilityLabel="Customer photo"
        />
      )}

      <Text style={s.lockAmount} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={amount}>
        {amount}
      </Text>

      <View style={s.ringWrap}>
        <Animated.View
          style={[s.breathRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
          pointerEvents="none"
        />
        {/* Hidden unlock entry: long-press the emblem (same pattern as the
            three-tap diagnostics). Accepts the portal-set device PIN or an
            owner-issued TOTP; both verify fully offline. */}
        <TouchableOpacity
          onLongPress={() => setShowCode((v) => !v)}
          delayLongPress={400}
          accessibilityRole="button"
          accessibilityLabel="Lock emblem. Long press to enter an unlock code."
        >
          <View style={s.lockEmblem}>
            <Lock color={LOCKED.ring} size={40} />
          </View>
        </TouchableOpacity>
      </View>

      <Text style={s.lockMessage}>{message}</Text>

      {showCode && (
        <View style={s.codeRow}>
          <TextInput
            style={s.codeInput}
            value={code}
            onChangeText={setCode}
            placeholder="PIN or unlock code"
            placeholderTextColor={LOCKED.textLow}
            keyboardType="numeric"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {codeError && <Text style={s.codeError}>{codeError}</Text>}
          <TouchableOpacity
            style={s.codeBtn}
            onPress={submitCode}
            disabled={codeBusy}
            accessibilityRole="button"
          >
            <KeyRound color={LOCKED.textHi} size={14} />
            <Text style={s.codeBtnText}>{codeBusy ? 'Checking…' : 'Unlock with code'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={s.payBtn}
        onPress={() => { if (props.retailerPhone) void DeviceMgmt.showCallOverlay('Call to pay', props.retailerPhone, props.retailerPhone); }}
        accessibilityRole="button"
        accessibilityLabel={copy.actions.payNow}
      >
        <PhoneCall color={colors.textHi} size={18} />
        <Text style={s.payBtnText}>{copy.actions.payNow}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.outlineBtn}
        onPress={() => { if (props.retailerPhone) void DeviceMgmt.showCallOverlay('Call retailer', props.retailerPhone, props.retailerPhone); }}
        accessibilityRole="button"
        accessibilityLabel={copy.actions.callRetailer}
      >
        <PhoneCall color={LOCKED.textHi} size={16} />
        <Text style={s.outlineBtnText}>{copy.actions.callRetailer}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.linkBtn}
        onPress={() => void DeviceMgmt.showCallOverlay('Emergency', '112', '112')}
        accessibilityRole="link"
        accessibilityLabel={copy.actions.emergency}
      >
        <Siren color={LOCKED.textMid} size={14} />
        <Text style={s.linkBtnText}>{copy.actions.emergency}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Diagnostics({ hidden }: { hidden: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const st = await DeviceMgmt.getProtectionStatus();
      setStatus(Object.entries(st).map(([k, v]) => `${k}: ${String(v)}`).join('\n'));
    })();
  }, []);
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Protection</Text>
      <Text style={[s.muted, { fontFamily: 'monospace' }]}>{status ?? 'reading…'}</Text>
      <Text style={s.muted}>Hidden from app list: {hidden ? 'yes' : 'no'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textHi },
  band: { backgroundColor: colors.amberSoft, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 12 },
  cardTitle: { fontSize: 12, fontWeight: '600', color: colors.textMid, marginBottom: 4 },
  amount: { fontSize: 26, fontWeight: '700' },
  muted: { color: colors.textMid, fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 8, padding: 14, marginTop: 12 },
  rowText: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 12, fontSize: 16, marginTop: 16, backgroundColor: colors.surface },
  error: { color: colors.danger, marginTop: 8 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderRadius: 8, padding: 14, marginTop: 12 },
  buttonText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },

  // Pairing walkthrough.
  linkRow: { alignItems: 'center', marginTop: 16 },
  linkText: { color: ACCENT, fontSize: 14, fontWeight: '600', marginTop: 8 },
  pairLabel: { fontSize: 12, fontWeight: '600', color: colors.textMid, marginTop: 12 },
  pairBig: { fontSize: 34, fontWeight: '700', color: colors.textHi, fontVariant: ['tabular-nums'], marginTop: 4 },
  pairMid: { fontSize: 24, fontWeight: '700', color: colors.textHi, fontVariant: ['tabular-nums'], marginTop: 4 },
  pairCode: { fontSize: 56, fontWeight: '700', color: ACCENT, fontVariant: ['tabular-nums'], letterSpacing: 6, marginTop: 4 },

  // Customer photo.
  photoCard: { width: 96, height: 96, borderRadius: 48, borderWidth: 1, borderColor: colors.border },
  photoAvatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 1, borderColor: LOCKED.border, backgroundColor: LOCKED.surface, marginBottom: 16 },

  // Lock screen (dark = locked).
  lockPage: { flex: 1, backgroundColor: LOCKED.bg, padding: 24, alignItems: 'center', justifyContent: 'center' },
  langRow: { position: 'absolute', top: 48, flexDirection: 'row', gap: 8 },
  langChip: { borderWidth: 1, borderColor: LOCKED.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  langChipActive: { borderColor: LOCKED.ring },
  langChipText: { color: LOCKED.textMid, fontSize: 13, fontWeight: '600' },
  langChipTextActive: { color: LOCKED.textHi },
  lockAmount: { color: LOCKED.textHi, fontSize: 96, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'center', marginBottom: 8 },
  ringWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginVertical: 16 },
  breathRing: { position: 'absolute', width: 112, height: 112, borderRadius: 56, borderWidth: 2, borderColor: LOCKED.ring },
  lockEmblem: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: LOCKED.surface },
  lockMessage: { color: LOCKED.textHi, fontSize: 17, lineHeight: 24, textAlign: 'center', maxWidth: 420, marginBottom: 24 },
  codeRow: { alignItems: 'center', width: '100%', maxWidth: 420, marginBottom: 16 },
  codeInput: { borderWidth: 1, borderColor: LOCKED.border, color: LOCKED.textHi, backgroundColor: LOCKED.surface, borderRadius: 8, padding: 12, fontSize: 16, width: '100%', maxWidth: 300, textAlign: 'center', marginTop: 4 },
  codeError: { color: LOCKED.danger, fontSize: 13, marginTop: 6 },
  codeBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LOCKED.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, marginTop: 10 },
  codeBtnText: { color: LOCKED.textHi, fontSize: 14, fontWeight: '600' },
  payBtn: { backgroundColor: LOCKED.amberHi, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 420 },
  payBtnText: { color: colors.textHi, fontSize: 17, fontWeight: '700' },
  outlineBtn: { flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: LOCKED.border, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 420, marginTop: 12 },
  outlineBtnText: { color: LOCKED.textHi, fontSize: 15, fontWeight: '600' },
  linkBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 8 },
  linkBtnText: { color: LOCKED.textMid, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
