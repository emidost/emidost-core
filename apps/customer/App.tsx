import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { KeyRound, Lock, PhoneCall, ShieldCheck, Siren, Smartphone } from 'lucide-react-native';
import * as DeviceMgmt from '@emidost/device-kit';
import { getOemProfile, dueReminderCopy } from '@emidost/shared';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import {
  getInstallationId, isRegistered, pollOnce, registerWithToken, startSync,
} from './src/services/sync';

const ACCENT = '#D97706';

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'bind' | 'active'>('loading');
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [due, setDue] = useState<{ due_date: string; amount_due: number } | null>(null);
  const [overdueDays, setOverdueDays] = useState(0);
  const [retailerPhone, setRetailerPhone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

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
        if (ui) {
          setDue(ui.next_due);
          setOverdueDays(ui.overdue_days);
          setRetailerPhone(ui.retailer_phone);
        }
        const st = await DeviceMgmt.getDeviceManagementStatus();
        setLocked(st.enforcedLocked);
        setHidden(st.hidden);
        if (st.enforcedLocked) {
          await DeviceMgmt.showLockOverlay('Phone locked', due
            ? `Rs ${Number(due.amount_due).toFixed(0)} due. Call your retailer.`
            : 'EMI payment required');
        }
      } finally {
        inFlight.current = false;
      }
    };
    void loop();
    timer.current = setInterval(loop, 12_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [phase, due?.amount_due]);

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
        onSpeak={speakReminder}
      />
    );
  }

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>Pay on time. The phone stays yours.</Text>
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
      <Diagnostics hidden={hidden} />
      <Text style={s.muted}>Launcher name: wifi{hidden ? ' (hidden from the app list after setup)' : ''}</Text>
    </ScrollView>
  );
}

function BindScreen({ onBound }: { onBound: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oem, setOem] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const info = await DeviceMgmt.getDeviceInfo();
      const profile = await getOemProfile(info.manufacturer, info.model);
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

  return (
    <View style={[s.page, { padding: 24 }]}>
      <Smartphone color={ACCENT} size={36} />
      <Text style={s.title}>Enter the setup code</Text>
      <Text style={s.muted}>The retailer gave you a code with this phone. It binds the phone to your EMI plan.</Text>
      {oem && <Text style={s.muted}>Detected: {oem}</Text>}
      <TextInput
        style={s.input}
        value={code}
        onChangeText={setCode}
        placeholder="Setup code"
        autoCapitalize="characters"
      />
      {error && <Text style={s.error}>{error}</Text>}
      <TouchableOpacity style={s.button} onPress={bind} disabled={busy}>
        <KeyRound color="#fff" size={16} />
        <Text style={s.buttonText}>{busy ? 'Binding…' : 'Bind this phone'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function LockedScreen(props: {
  due: { due_date: string; amount_due: number } | null;
  overdueDays: number;
  retailerPhone: string | null;
  onSpeak: () => void;
}) {
  return (
    <View style={[s.center, { backgroundColor: '#1A1D21' }]}>
      <Lock color="#F59E0B" size={44} />
      <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 12 }}>Phone locked</Text>
      <Text style={{ color: '#D1D5DB', fontSize: 18, marginTop: 8 }}>
        {props.due ? `Rs ${Number(props.due.amount_due).toFixed(0)} due ${props.due.due_date}` : 'EMI payment required'}
      </Text>
      {props.overdueDays > 0 && (
        <Text style={{ color: '#FCA5A5', marginTop: 4 }}>{props.overdueDays} days overdue</Text>
      )}
      <TouchableOpacity style={[s.button, { marginTop: 20 }]} onPress={props.onSpeak}>
        <ShieldCheck color="#fff" size={16} />
        <Text style={s.buttonText}>Hear the reminder</Text>
      </TouchableOpacity>
      {props.retailerPhone && (
        <TouchableOpacity
          style={[s.button, { backgroundColor: '#0D9488', marginTop: 10 }]}
          onPress={() => void DeviceMgmt.showCallOverlay('Call retailer', props.retailerPhone ?? '', props.retailerPhone ?? '')}
        >
          <PhoneCall color="#fff" size={16} />
          <Text style={s.buttonText}>Call retailer</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[s.button, { backgroundColor: '#DC2626', marginTop: 10 }]}
        onPress={() => void DeviceMgmt.showCallOverlay('Emergency', '112', '112')}
      >
        <Siren color="#fff" size={16} />
        <Text style={s.buttonText}>Emergency 112</Text>
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
  page: { flex: 1, backgroundColor: '#F6F7F9', padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', padding: 16, marginTop: 12 },
  cardTitle: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 4 },
  amount: { fontSize: 26, fontWeight: '700' },
  muted: { color: '#6B7280', fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 8, padding: 14, marginTop: 12 },
  rowText: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, padding: 12, fontSize: 16, marginTop: 16, backgroundColor: '#fff' },
  error: { color: '#DC2626', marginTop: 8 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderRadius: 8, padding: 14, marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
