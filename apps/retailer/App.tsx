import { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import {
  colors, createApi, getOemProfile, type Customer, type Device, type Retailer,
} from '@emidost/shared';
import {
  Banknote, CalendarDays, Coins, Hash, IndianRupee, Lock, LockOpen, LogIn, QrCode,
  Settings2, Smartphone, Store, UserPlus, Wallet,
} from 'lucide-react-native';

const ACCENT = '#0D9488';
const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  {
    auth: {
      storage: AsyncStorage as never,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

const api = createApi({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});

type Tab = 'customers' | 'new' | 'devices' | 'enrol';

export default function App() {
  const [session, setSession] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('customers');
  const [balance, setBalance] = useState<{ credits_balance: number; lock_allowances: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(!!data.session);
      if (data.session) {
        const { data: profile } = await supabase.from('profiles').select('retailer_id').eq('id', data.session.user.id).maybeSingle();
        if (profile?.retailer_id) {
          const { data: r } = await supabase.from('retailers')
            .select('credits_balance, lock_allowances').eq('id', profile.retailer_id).maybeSingle();
          setBalance(r ?? null);
        }
      }
    })();
  }, []);

  if (session === null) return <View style={s.center}><ActivityIndicator color={ACCENT} size="large" /></View>;
  if (!session) return <Login onDone={() => setSession(true)} />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <Store color={ACCENT} size={18} />
        <Text style={s.headerTitle}>emidost Retailer</Text>
        <Text style={s.headerMeta}>
          <Coins size={12} /> {balance?.credits_balance ?? 0} slots · <Lock size={12} /> {balance?.lock_allowances ?? 0} locks
        </Text>
      </View>
      {tab === 'customers' && <Customers />}
      {tab === 'new' && <NewCustomer onDone={() => setTab('customers')} />}
      {tab === 'devices' && <Devices />}
      {tab === 'enrol' && <Enrol />}
      <View style={s.tabs}>
        <TabButton icon={Wallet} label="Customers" active={tab === 'customers'} onPress={() => setTab('customers')} />
        <TabButton icon={UserPlus} label="New" active={tab === 'new'} onPress={() => setTab('new')} />
        <TabButton icon={Smartphone} label="Devices" active={tab === 'devices'} onPress={() => setTab('devices')} />
        <TabButton icon={QrCode} label="Enrol" active={tab === 'enrol'} onPress={() => setTab('enrol')} />
      </View>
    </View>
  );
}

function Chip({ tone, label }: { tone: string; label: string }) {
  return (
    <View style={s.chip}>
      <View style={[s.chipDot, { backgroundColor: tone }]} />
      <Text style={s.chipText}>{label}</Text>
    </View>
  );
}

function TabButton(props: { icon: typeof Wallet; label: string; active: boolean; onPress: () => void }) {
  const I = props.icon;
  return (
    <TouchableOpacity style={[s.tab, props.active && s.tabActive]} onPress={props.onPress}>
      <I size={18} color={props.active ? ACCENT : '#6B7280'} />
      <Text style={[s.tabLabel, props.active && { color: ACCENT }]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
    else onDone();
  }

  return (
    <View style={s.center}>
      <LogIn color={ACCENT} size={36} />
      <Text style={s.title}>Retailer sign in</Text>
      <TextInput style={s.input} placeholder="Login ID" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text style={s.error}>{error}</Text>}
      <TouchableOpacity style={s.button} onPress={submit} disabled={busy}>
        <Text style={s.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Customers() {
  const [rows, setRows] = useState<Customer[]>([]);
  useEffect(() => {
    api.listCustomers().then(setRows).catch(() => {});
  }, []);
  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>Customers</Text>
      {rows.map((c) => (
        <View key={c.id} style={s.card}>
          <Text style={s.cardTitle}>{c.name}</Text>
          <Text style={s.muted}>{c.phone} · {c.brand} {c.model} · IMEI {c.imei}</Text>
          <Text style={s.muted}>
            {c.emi_months} months · Rs {Number(c.emi_amount).toFixed(0)}/month · due day {c.emi_due_day}
          </Text>
          <View style={s.chipRow}>
            <Chip
              tone={c.status === 'NPA' ? colors.danger : c.status === 'RUNNING' ? colors.accentTeal : colors.textMid}
              label={c.status === 'NPA' ? 'Missed payment' : c.status === 'RUNNING' ? 'On time' : c.status === 'COMPLETE' ? 'Paid' : c.status === 'SETTLED' ? 'Settled' : c.status}
            />
          </View>
          <PaymentRow customerId={c.id} onDone={() => api.listCustomers().then(setRows).catch(() => {})} />
        </View>
      ))}
      {rows.length === 0 && <Text style={s.muted}>No customers yet.</Text>}
    </ScrollView>
  );
}

function PaymentRow({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function record() {
    setErr(null);
    try {
      await api.recordPayment(customerId, { amount: parseFloat(amount), method: 'cash' });
      setMsg('Payment recorded');
      setAmount('');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed');
    }
  }

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          placeholder="Payment amount (Rs)"
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
        />
        <TouchableOpacity style={[s.button, { marginTop: 0, paddingVertical: 10 }]} onPress={record}>
          <Banknote size={14} color="#fff" />
          <Text style={s.buttonText}>Record</Text>
        </TouchableOpacity>
      </View>
      {msg && <Text style={{ color: '#16A34A', fontSize: 12, marginTop: 4 }}>{msg}</Text>}
      {err && <Text style={s.error}>{err}</Text>}
    </View>
  );
}

function NewCustomer({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: '', phone: '', imei: '', brand: 'Samsung', model: '',
    emi_months: '12', emi_amount: '', emi_due_day: '1',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setErr(null);
    try {
      await api.createCustomer({
        ...form,
        emi_months: parseInt(form.emi_months, 10),
        emi_amount: parseFloat(form.emi_amount),
        emi_due_day: parseInt(form.emi_due_day, 10),
      });
      setMsg('Customer added. Record consent in the portal next, then enrol the phone.');
      setTimeout(onDone, 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>New customer</Text>
      {msg && <Text style={{ color: '#16A34A' }}>{msg}</Text>}
      {err && <Text style={s.error}>{err}</Text>}
      <Field label="Name" value={form.name} onChange={set('name')} icon={UserPlus} />
      <Field label="Phone number" value={form.phone} onChange={set('phone')} icon={Smartphone} />
      <Field label="IMEI" value={form.imei} onChange={set('imei')} icon={Hash} />
      <Field label="Brand" value={form.brand} onChange={set('brand')} icon={Settings2} />
      <Field label="Model" value={form.model} onChange={set('model')} icon={Smartphone} />
      <Field label="EMI months" value={form.emi_months} onChange={set('emi_months')} icon={CalendarDays} keyboard="numeric" />
      <Field label="EMI amount per month" value={form.emi_amount} onChange={set('emi_amount')} icon={IndianRupee} keyboard="numeric" />
      <Field label="Due day (1-31)" value={form.emi_due_day} onChange={set('emi_due_day')} icon={CalendarDays} keyboard="numeric" />
      <TouchableOpacity style={s.button} onPress={save}>
        <Text style={s.buttonText}>Add customer</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; icon: typeof Wallet; keyboard?: 'numeric' }) {
  const I = props.icon;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 }}>
        <I size={12} color="#6B7280" />
        <Text style={s.label}>{props.label}</Text>
      </View>
      <TextInput
        style={s.input}
        value={props.value}
        onChangeText={props.onChange}
        keyboardType={props.keyboard === 'numeric' ? 'numeric' : 'default'}
      />
    </View>
  );
}

function Devices() {
  const [rows, setRows] = useState<Device[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.listDevices().then(setRows).catch(() => {}); }, []);

  async function toggle(d: Device) {
    setErr(null);
    try {
      await api.sendCommand(d.id, d.is_locked ? 'UNLOCK' : 'LOCK');
      const list = await api.listDevices();
      setRows(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Command failed');
    }
  }

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>Devices</Text>
      {err && <Text style={s.error}>{err}</Text>}
      {rows.map((d) => (
        <View key={d.id} style={s.card}>
          <Text style={s.cardTitle}>{d.manufacturer} {d.model}</Text>
          <View style={s.chipRow}>
            <Chip tone={d.mode === 'device_owner' ? colors.accentTeal : colors.textMid} label={d.mode === 'device_owner' ? 'Device owner' : d.mode === 'device_admin' ? 'Device admin' : 'Not enrolled'} />
            <Chip tone={d.is_locked ? colors.danger : colors.accentTeal} label={d.is_locked ? 'Locked' : 'Unlocked'} />
          </View>
          <TouchableOpacity style={[s.button, { marginTop: 8 }]} onPress={() => toggle(d)}>
            {d.is_locked ? <LockOpen color="#fff" size={16} /> : <Lock color="#fff" size={16} />}
            <Text style={s.buttonText}>{d.is_locked ? 'Unlock' : 'Lock'}</Text>
          </TouchableOpacity>
        </View>
      ))}
      {rows.length === 0 && <Text style={s.muted}>No devices yet.</Text>}
    </ScrollView>
  );
}

function Enrol() {
  const [steps, setSteps] = useState<string[]>([]);
  const [hint, setHint] = useState('');
  useEffect(() => {
    // The walkthrough targets the CUSTOMER phone brand chosen in the form; the
    // generic verified checklist is shown here as the default.
    const profile = getOemProfile('', '');
    setSteps(profile.setupSteps);
    setHint(profile.wirelessDebugGateHint);
  }, []);

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>Enrol a phone</Text>
      <Text style={s.muted}>
        1. Record consent in the portal. 2. Factory-reset the customer phone, skip every account, set no PIN.
        3. Generate the QR in the portal (Enrolment QR page) and scan it from the setup wizard after 6 taps.
        4. Or use wireless pairing: Developer options → Wireless debugging → Pair with pairing code, then type the code in the customer app.
      </Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>Phone setup steps</Text>
        {steps.map((st) => (
          <View key={st} style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
            <Settings2 size={14} color={ACCENT} />
            <Text style={s.muted}>{st}</Text>
          </View>
        ))}
        <Text style={[s.muted, { marginTop: 10 }]}>{hint}</Text>
      </View>
      <TouchableOpacity style={s.button} onPress={() => {}}>
        <QrCode color="#fff" size={16} />
        <Text style={s.buttonText}>Open portal QR page</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F7F9' },
  page: { flex: 1, backgroundColor: '#F6F7F9', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontWeight: '700', fontSize: 16, flex: 1 },
  headerMeta: { color: '#6B7280', fontSize: 12 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2 },
  tabActive: { backgroundColor: '#F0FDFA' },
  tabLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', padding: 14, marginTop: 10 },
  cardTitle: { fontWeight: '700', fontSize: 15 },
  muted: { color: '#6B7280', fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, padding: 10, fontSize: 15, marginTop: 4, backgroundColor: '#fff' },
  error: { color: '#DC2626', marginTop: 8 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderRadius: 8, padding: 14, marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: '600', color: '#1A1D21' },
});
