import { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { colors, createApi, type Retailer } from '@emidost/shared';
import {
  Ban, CircleCheck, Coins, LayoutDashboard, Lock, LogIn, ScrollText,
  Smartphone, Store, UserPlus, Wallet,
} from 'lucide-react-native';

const ACCENT = '#4F46E5';
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

type Tab = 'retailers' | 'new' | 'audit';

export default function App() {
  const [session, setSession] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('retailers');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(!!data.session);
    })();
  }, []);

  if (session === null) return <View style={s.center}><ActivityIndicator color={ACCENT} size="large" /></View>;
  if (!session) return <Login onDone={() => setSession(true)} />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <LayoutDashboard color={ACCENT} size={18} />
        <Text style={s.headerTitle}>emidost Owner</Text>
      </View>
      {tab === 'retailers' && <Retailers />}
      {tab === 'new' && <NewRetailer onDone={() => setTab('retailers')} />}
      {tab === 'audit' && <Audit />}
      <View style={s.tabs}>
        <TabButton icon={Store} label="Retailers" active={tab === 'retailers'} onPress={() => setTab('retailers')} />
        <TabButton icon={UserPlus} label="New" active={tab === 'new'} onPress={() => setTab('new')} />
        <TabButton icon={ScrollText} label="Audit" active={tab === 'audit'} onPress={() => setTab('audit')} />
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

function TabButton(props: { icon: typeof Store; label: string; active: boolean; onPress: () => void }) {
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
      <Text style={s.title}>Owner sign in</Text>
      <TextInput style={s.input} placeholder="Login ID" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text style={s.error}>{error}</Text>}
      <TouchableOpacity style={s.button} onPress={submit} disabled={busy}>
        <Text style={s.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Retailers() {
  const [rows, setRows] = useState<Retailer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [topupFor, setTopupFor] = useState<string | null>(null);
  const [topupValue, setTopupValue] = useState('');
  const [allowFor, setAllowFor] = useState<string | null>(null);
  const [allowValue, setAllowValue] = useState('');

  useEffect(() => { api.listRetailers().then(setRows).catch(() => {}); }, []);

  async function suspend(r: Retailer) {
    setErr(null);
    try {
      await api.updateRetailer(r.id, { is_suspended: !r.is_suspended });
      setRows(await api.listRetailers());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Update failed'); }
  }

  async function giveCredits(r: Retailer) {
    try {
      await api.allocateCredits(r.id, { delta: parseInt(topupValue, 10), kind: 'topup' });
      setTopupFor(null); setTopupValue('');
      setRows(await api.listRetailers());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Credit update failed'); }
  }

  async function setAllowances(r: Retailer) {
    try {
      await api.setLockAllowances(r.id, parseInt(allowValue, 10));
      setAllowFor(null); setAllowValue('');
      setRows(await api.listRetailers());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Allowance update failed'); }
  }

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>Retailers</Text>
      {err && <Text style={s.error}>{err}</Text>}
      {rows.map((r) => (
        <View key={r.id} style={s.card}>
          <Text style={s.cardTitle}>{r.name} · {r.phone}</Text>
          <Text style={s.muted}>
            <Coins size={12} /> {r.credits_balance} slots · <Lock size={12} /> {r.lock_allowances} locks
          </Text>
          <View style={s.chipRow}>
            <Chip tone={r.is_suspended ? colors.textMid : colors.accentTeal} label={r.is_suspended ? 'Suspended' : 'Active'} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity style={s.smallBtn} onPress={() => suspend(r)}>
              {r.is_suspended ? <CircleCheck color="#16A34A" size={14} /> : <Ban color="#DC2626" size={14} />}
              <Text style={s.smallBtnText}>{r.is_suspended ? 'Resume' : 'Suspend'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.smallBtn} onPress={() => { setTopupFor(r.id); setAllowFor(null); }}>
              <Wallet size={14} color={ACCENT} />
              <Text style={s.smallBtnText}>Credits</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.smallBtn} onPress={() => { setAllowFor(r.id); setTopupFor(null); }}>
              <Lock size={14} color={ACCENT} />
              <Text style={s.smallBtnText}>Allowances</Text>
            </TouchableOpacity>
          </View>
          {topupFor === r.id && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="Slots to add" keyboardType="numeric" value={topupValue} onChangeText={setTopupValue} />
              <TouchableOpacity style={s.smallBtn} onPress={() => giveCredits(r)}><Text style={s.smallBtnText}>Add</Text></TouchableOpacity>
            </View>
          )}
          {allowFor === r.id && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="New total" keyboardType="numeric" value={allowValue} onChangeText={setAllowValue} />
              <TouchableOpacity style={s.smallBtn} onPress={() => setAllowances(r)}><Text style={s.smallBtnText}>Set</Text></TouchableOpacity>
            </View>
          )}
        </View>
      ))}
      {rows.length === 0 && <Text style={s.muted}>No retailers yet.</Text>}
    </ScrollView>
  );
}

function NewRetailer({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    try {
      await api.createRetailer({ name, phone, login_id: loginId, password });
      setMsg('Retailer created.');
      setTimeout(onDone, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    }
  }

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>New retailer</Text>
      {msg && <Text style={{ color: '#16A34A' }}>{msg}</Text>}
      {err && <Text style={s.error}>{err}</Text>}
      <Text style={s.label}>Name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} />
      <Text style={s.label}>Phone (SMS lock/unlock sender)</Text>
      <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Text style={s.label}>Login ID</Text>
      <TextInput style={s.input} value={loginId} onChangeText={setLoginId} autoCapitalize="none" />
      <Text style={s.label}>Password (8+ characters)</Text>
      <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry />
      <TouchableOpacity style={s.button} onPress={save}>
        <Text style={s.buttonText}>Create retailer</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Audit() {
  const [rows, setRows] = useState<{ id: string; event: string; created_at: string }[]>([]);
  useEffect(() => {
    void (async () => {
      const list = await api.listAudit();
      setRows(list as never);
    })();
  }, []);
  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>Audit</Text>
      {rows.map((r) => (
        <View key={r.id} style={s.card}>
          <Text style={s.cardTitle}>{r.event}</Text>
          <Text style={s.muted}>{new Date(r.created_at).toLocaleString()}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F7F9' },
  page: { flex: 1, backgroundColor: '#F6F7F9', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontWeight: '700', fontSize: 16 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2 },
  tabActive: { backgroundColor: '#EEF2FF' },
  tabLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', padding: 14, marginTop: 10 },
  cardTitle: { fontWeight: '700', fontSize: 15 },
  muted: { color: '#6B7280', fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, padding: 10, fontSize: 15, marginTop: 4, backgroundColor: '#fff' },
  error: { color: '#DC2626', marginTop: 8 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderRadius: 8, padding: 14, marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  smallBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: '#1A1D21' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: '600', color: '#1A1D21' },
});
