import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { colors, createApi, type Retailer } from '@emidost/shared';
import mark from './assets/icon.png';
import {
  Ban, CircleCheck, Coins, Lock, LogIn, ScrollText,
  Smartphone, Store, UserPlus, Wallet,
} from 'lucide-react-native';

const ACCENT = colors.accentIndigo;
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
        <Image source={mark} style={s.brandMarkSm} accessible accessibilityLabel="emidost" />
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
      <I size={18} color={props.active ? ACCENT : colors.textMid} />
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
      <Image source={mark} style={s.brandMark} accessible accessibilityLabel="emidost" />
      <View style={s.band}><Text style={s.title}>Owner sign in</Text></View>
      <TextInput style={s.input} placeholder="Login ID" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text style={s.error}>{error}</Text>}
      <TouchableOpacity style={s.button} onPress={submit} disabled={busy} accessibilityRole="button" accessibilityLabel="Sign in">
        <LogIn color={colors.onAccent} size={16} />
        <Text style={s.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Retailers() {
  const [rows, setRows] = useState<Retailer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [topupFor, setTopupFor] = useState<string | null>(null);
  const [topupValue, setTopupValue] = useState('');
  const [allowFor, setAllowFor] = useState<string | null>(null);
  const [allowValue, setAllowValue] = useState('');

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setRows(await api.listRetailers());
    } catch {
      // stale list stays; pull-to-refresh retries
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function suspend(r: Retailer) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.updateRetailer(r.id, { is_suspended: !r.is_suspended });
      setRows(await api.listRetailers());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusy(false); }
  }

  async function giveCredits(r: Retailer) {
    if (busy) return;
    const delta = parseInt(topupValue, 10);
    if (!Number.isFinite(delta)) { setErr('Enter a number of credits'); return; }
    setBusy(true); setErr(null);
    try {
      await api.allocateCredits(r.id, { delta, kind: 'topup' });
      setTopupFor(null); setTopupValue('');
      setRows(await api.listRetailers());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Credit update failed'); }
    finally { setBusy(false); }
  }

  async function setAllowances(r: Retailer) {
    if (busy) return;
    const n = parseInt(allowValue, 10);
    if (!Number.isFinite(n) || n < 0) { setErr('Enter a non-negative number of locks'); return; }
    setBusy(true); setErr(null);
    try {
      await api.setLockAllowances(r.id, n);
      setAllowFor(null); setAllowValue('');
      setRows(await api.listRetailers());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Allowance update failed'); }
    finally { setBusy(false); }
  }

  return (
    <View style={s.page}>
      <View style={s.band}><Text style={s.title}>Retailers</Text></View>
      {err && <Text style={s.error}>{err}</Text>}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshing={refreshing}
        onRefresh={reload}
        removeClippedSubviews
        renderItem={({ item: r }) => (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Store size={16} color={ACCENT} />
              <Text style={s.cardTitle}>{r.name} · {r.phone}</Text>
            </View>
            <Text style={s.muted}>
              <Coins size={12} /> {r.credits_balance} slots · <Lock size={12} /> {r.lock_allowances} locks
            </Text>
            <View style={s.chipRow}>
              <Chip tone={r.is_suspended ? colors.textMid : colors.accentTeal} label={r.is_suspended ? 'Suspended' : 'Active'} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity style={s.smallBtn} onPress={() => suspend(r)} disabled={busy} accessibilityRole="button" accessibilityLabel={r.is_suspended ? 'Resume retailer' : 'Suspend retailer'}>
                {r.is_suspended ? <CircleCheck color={colors.success} size={14} /> : <Ban color={colors.danger} size={14} />}
                <Text style={s.smallBtnText}>{r.is_suspended ? 'Resume' : 'Suspend'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.smallBtn} onPress={() => { setTopupFor(r.id); setAllowFor(null); }} accessibilityRole="button" accessibilityLabel="Add credits">
                <Wallet size={14} color={ACCENT} />
                <Text style={s.smallBtnText}>Credits</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.smallBtn} onPress={() => { setAllowFor(r.id); setTopupFor(null); }} accessibilityRole="button" accessibilityLabel="Set lock allowances">
                <Lock size={14} color={ACCENT} />
                <Text style={s.smallBtnText}>Allowances</Text>
              </TouchableOpacity>
            </View>
            {topupFor === r.id && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TextInput style={[s.input, { flex: 1 }]} placeholder="Slots to add" keyboardType="numeric" value={topupValue} onChangeText={setTopupValue} />
                <TouchableOpacity style={s.smallBtn} onPress={() => giveCredits(r)} disabled={busy}><Text style={s.smallBtnText}>{busy ? 'Adding…' : 'Add'}</Text></TouchableOpacity>
              </View>
            )}
            {allowFor === r.id && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TextInput style={[s.input, { flex: 1 }]} placeholder="New total" keyboardType="numeric" value={allowValue} onChangeText={setAllowValue} />
                <TouchableOpacity style={s.smallBtn} onPress={() => setAllowances(r)} disabled={busy}><Text style={s.smallBtnText}>{busy ? 'Setting…' : 'Set'}</Text></TouchableOpacity>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={s.muted}>No retailers yet. Create one from the New tab.</Text>}
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}

function NewRetailer({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createRetailer({ name, phone, login_id: loginId, password });
      setMsg('Retailer created.');
      setTimeout(onDone, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.page}>
      <View style={s.band}><Text style={s.title}>New retailer</Text></View>
      {msg && <Text style={{ color: colors.success }}>{msg}</Text>}
      {err && <Text style={s.error}>{err}</Text>}
      <Text style={s.label}>Name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} />
      <Text style={s.label}>Phone (SMS lock/unlock sender)</Text>
      <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Text style={s.label}>Login ID</Text>
      <TextInput style={s.input} value={loginId} onChangeText={setLoginId} autoCapitalize="none" />
      <Text style={s.label}>Password (8+ characters)</Text>
      <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry />
      <TouchableOpacity style={s.button} onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel="Create retailer">
        <UserPlus color={colors.onAccent} size={16} />
        <Text style={s.buttonText}>{busy ? 'Creating…' : 'Create retailer'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Audit() {
  const [rows, setRows] = useState<{ id: string; event: string; created_at: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await api.listAudit();
      setRows(list as never);
    } catch {
      // stale list stays; pull-to-refresh retries
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return (
    <View style={s.page}>
      <View style={s.band}><Text style={s.title}>Audit</Text></View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshing={refreshing}
        onRefresh={reload}
        removeClippedSubviews
        renderItem={({ item: r }) => (
          <View style={s.card}>
            <View style={s.cardHead}>
              <ScrollText size={14} color={ACCENT} />
              <Text style={[s.cardTitle, { flex: 1 }]}>{r.event}</Text>
            </View>
            <Text style={s.muted}>{new Date(r.created_at).toLocaleString()}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={s.muted}>No audit events yet. Pull to refresh.</Text>}
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  page: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: colors.indigoSoft, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontWeight: '700', fontSize: 16, color: colors.textHi },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 2 },
  tabActive: { backgroundColor: colors.indigoSoft },
  tabLabel: { fontSize: 11, color: colors.textMid, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textHi },
  band: { backgroundColor: colors.indigoSoft, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontWeight: '700', fontSize: 15 },
  muted: { color: colors.textMid, fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMid, marginTop: 10 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, fontSize: 15, marginTop: 4, backgroundColor: colors.surface },
  error: { color: colors.danger, marginTop: 8 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderRadius: 8, padding: 14, marginTop: 12 },
  buttonText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },
  smallBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: colors.textHi },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textHi },

  // Brand mark.
  brandMark: { width: 64, height: 64, borderRadius: 16, marginBottom: 12 },
  brandMarkSm: { width: 28, height: 28, borderRadius: 8 },
});
