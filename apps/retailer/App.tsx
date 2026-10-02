import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, FlatList, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import * as DeviceMgmt from '@emidost/device-kit';
import Svg, { Circle } from 'react-native-svg';
import mark from './assets/icon.png';
import {
  colors, createApi, getOemProfile, totpCode, totpSecondsLeft,
  type Customer, type Device, type Retailer,
} from '@emidost/shared';
import {
  ArrowLeft, Banknote, BellRing, CalendarDays, Camera, CheckCircle2, Coins, Copy, Hash, ImagePlus, IndianRupee, KeyRound, Lock, LockOpen, LogIn, Play, QrCode,
  Settings2, Smartphone, UserPlus, Wallet,
} from 'lucide-react-native';

const ACCENT = colors.accentTeal;
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

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const api = createApi({
  baseUrl: API_URL,
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});

type Tab = 'customers' | 'new' | 'devices' | 'enrol';

export default function App() {
  const [session, setSession] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('customers');
  const [balance, setBalance] = useState<{ credits_balance: number; lock_allowances: number } | null>(null);
  // The brand chosen in the customer form drives the per-OEM Enrol walkthrough.
  const [enrolBrand, setEnrolBrand] = useState('');
  // Full-screen offline unlock code view for one device.
  const [unlockFor, setUnlockFor] = useState<Device | null>(null);
  // Full-screen wireless enrol runner.
  const [wirelessEnrol, setWirelessEnrol] = useState(false);

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
  if (unlockFor) return <UnlockCodeScreen device={unlockFor} onClose={() => setUnlockFor(null)} />;
  if (wirelessEnrol) return <WirelessEnrol onClose={() => setWirelessEnrol(false)} />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <Image source={mark} style={s.brandMarkSm} accessible accessibilityLabel="emidost" />
        <Text style={s.headerTitle}>emidost Retailer</Text>
        <Text style={s.headerMeta}>
          <Coins size={12} /> {balance?.credits_balance ?? 0} slots · <Lock size={12} /> {balance?.lock_allowances ?? 0} locks
        </Text>
      </View>
      {tab === 'customers' && <Customers />}
      {tab === 'new' && <NewCustomer onDone={() => setTab('customers')} onBrand={setEnrolBrand} />}
      {tab === 'devices' && <Devices onUnlockCode={setUnlockFor} />}
      {tab === 'enrol' && <Enrol brand={enrolBrand} onWirelessEnrol={() => setWirelessEnrol(true)} />}
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
      <Text style={s.title}>Retailer sign in</Text>
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

function Customers() {
  const [rows, setRows] = useState<Customer[]>([]);
  useEffect(() => {
    api.listCustomers().then(setRows).catch(() => {});
  }, []);
  return (
    <View style={s.page}>
      <Text style={s.title}>Customers</Text>
      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        renderItem={({ item: c }) => (
          <View style={s.card}>
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
              <Chip
                tone={c.lock_mode === 'notify_only' ? colors.textMid : colors.accentTeal}
                label={c.lock_mode === 'notify_only' ? 'Reminders only' : 'Lock plan'}
              />
              {!!c.photo_path && (
                <Chip tone={colors.accentTeal} label="Photo" />
              )}
            </View>
            {(c.status === 'RUNNING' || c.status === 'NPA') && <SetupCode customerId={c.id} />}
            <PaymentRow customerId={c.id} onDone={() => api.listCustomers().then(setRows).catch(() => {})} />
          </View>
        )}
        ListEmptyComponent={<Text style={s.muted}>No customers yet.</Text>}
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}

/**
 * Mints the one-time enrolment token the customer phone types on its bind
 * screen. Valid 15 minutes; shown once (only its hash is stored).
 */
function SetupCode({ customerId }: { customerId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const session = await api.createEnrolment(customerId, {});
      setCode(session.token);
      setExpiresAt(session.expires_at);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create a setup code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginTop: 10 }}>
      {code ? (
        <View>
          <Text style={s.label}>Setup code (type it on the customer phone)</Text>
          <Text selectable style={{ fontFamily: 'monospace', fontSize: 15, marginTop: 4 }}>{code}</Text>
          {expiresAt && (
            <Text style={s.muted}>Valid until {new Date(expiresAt).toLocaleTimeString()}</Text>
          )}
        </View>
      ) : (
        <TouchableOpacity style={s.button} onPress={create} disabled={busy}>
          <Hash color={colors.onAccent} size={16} />
          <Text style={s.buttonText}>{busy ? 'Creating…' : 'Create setup code'}</Text>
        </TouchableOpacity>
      )}
      {err && <Text style={s.error}>{err}</Text>}
    </View>
  );
}

function PaymentRow({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function record() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.recordPayment(customerId, { amount: parseFloat(amount), method: 'cash' });
      setMsg('Payment recorded');
      setAmount('');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
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
        <TouchableOpacity style={[s.button, { marginTop: 0, paddingVertical: 10 }]} onPress={record} disabled={busy}>
          <Banknote size={14} color={colors.onAccent} />
          <Text style={s.buttonText}>{busy ? '…' : 'Record'}</Text>
        </TouchableOpacity>
      </View>
      {msg && <Text style={{ color: colors.success, fontSize: 12, marginTop: 4 }}>{msg}</Text>}
      {err && <Text style={s.error}>{err}</Text>}
    </View>
  );
}

function NewCustomer({ onDone, onBrand }: { onDone: () => void; onBrand: (brand: string) => void }) {
  const [form, setForm] = useState({
    name: '', phone: '', imei: '', brand: 'Samsung', model: '',
    emi_months: '12', emi_amount: '', emi_due_day: '1',
    lock_mode: 'lock' as 'lock' | 'notify_only',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Customer | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const customer = await api.createCustomer({
        ...form,
        emi_months: parseInt(form.emi_months, 10),
        emi_amount: parseFloat(form.emi_amount),
        emi_due_day: parseInt(form.emi_due_day, 10),
      });
      setCreated(customer);
      setMsg('Customer added. Add a photo now, or skip with Done.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(source: 'gallery' | 'camera') {
    if (photoBusy) return;
    setPhotoErr(null);
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setPhotoErr('Camera permission needed to take a photo.'); return; }
        const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
        if (!res.canceled && res.assets?.[0]) setPhotoUri(res.assets[0].uri);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { setPhotoErr('Photo library permission needed to pick a photo.'); return; }
        const res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
        if (!res.canceled && res.assets?.[0]) setPhotoUri(res.assets[0].uri);
      }
    } catch {
      setPhotoErr('Could not open the photo picker.');
    }
  }

  async function uploadPhoto() {
    if (!created || !photoUri || photoBusy) return;
    setPhotoBusy(true);
    setPhotoErr(null);
    try {
      await api.uploadCustomerPhoto(created.id, { uri: photoUri, name: `customer-${created.id}.jpg`, mime: 'image/jpeg' });
      setPhotoMsg('Photo added');
    } catch (e) {
      setPhotoErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>New customer</Text>
      {msg && <Text style={{ color: colors.success }}>{msg}</Text>}
      {err && <Text style={s.error}>{err}</Text>}

      {created && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Add a customer photo</Text>
          <Text style={s.muted}>It shows on the phone's lock screen so the retailer knows whose phone this is.</Text>
          <View style={s.quickRow}>
            <TouchableOpacity
              style={[s.outlineBtn, { flex: 1 }]}
              onPress={() => pickPhoto('gallery')}
              disabled={photoBusy}
              accessibilityRole="button"
              accessibilityLabel="Pick photo from gallery"
            >
              <ImagePlus size={16} color={ACCENT} />
              <Text style={s.outlineBtnText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.outlineBtn, { flex: 1 }]}
              onPress={() => pickPhoto('camera')}
              disabled={photoBusy}
              accessibilityRole="button"
              accessibilityLabel="Take photo with camera"
            >
              <Camera size={16} color={ACCENT} />
              <Text style={s.outlineBtnText}>Camera</Text>
            </TouchableOpacity>
          </View>
          {photoUri && (
            <Image source={{ uri: photoUri }} style={s.photoPreview} accessible accessibilityLabel="Customer photo preview" />
          )}
          {photoUri && !photoMsg && (
            <TouchableOpacity
              style={s.button}
              onPress={uploadPhoto}
              disabled={photoBusy}
              accessibilityRole="button"
              accessibilityLabel="Upload photo"
            >
              <CheckCircle2 color={colors.onAccent} size={16} />
              <Text style={s.buttonText}>{photoBusy ? 'Uploading…' : 'Upload photo'}</Text>
            </TouchableOpacity>
          )}
          {photoMsg && <Text style={{ color: colors.success, marginTop: 8 }}>{photoMsg}</Text>}
          {photoErr && <Text style={s.error}>{photoErr}</Text>}
          <TouchableOpacity
            style={[s.outlineBtn, { marginTop: 12 }]}
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={s.outlineBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      <Field label="Name" value={form.name} onChange={set('name')} icon={UserPlus} />
      <Field label="Phone number" value={form.phone} onChange={set('phone')} icon={Smartphone} />
      <Field label="IMEI" value={form.imei} onChange={set('imei')} icon={Hash} />
      <Field label="Brand" value={form.brand} onChange={(v) => { set('brand')(v); onBrand(v); }} icon={Settings2} />
      <Field label="Model" value={form.model} onChange={set('model')} icon={Smartphone} />
      <Field label="EMI months" value={form.emi_months} onChange={set('emi_months')} icon={CalendarDays} keyboard="numeric" />
      <Field label="EMI amount per month" value={form.emi_amount} onChange={set('emi_amount')} icon={IndianRupee} keyboard="numeric" />
      <Field label="Due day (1-31)" value={form.emi_due_day} onChange={set('emi_due_day')} icon={CalendarDays} keyboard="numeric" />

      <Text style={[s.label, { marginTop: 14 }]}>Phone lock plan</Text>
      <TouchableOpacity
        style={[s.choice, form.lock_mode === 'lock' && { borderColor: ACCENT, backgroundColor: colors.tealSoft }]}
        onPress={() => set('lock_mode')('lock')}
      >
        <Lock size={14} color={form.lock_mode === 'lock' ? ACCENT : colors.textMid} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700' }}>Lock on missed payment</Text>
          <Text style={{ color: colors.textMid, fontSize: 12 }}>Locks the phone when overdue or 5 days offline.</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.choice, form.lock_mode === 'notify_only' && { borderColor: ACCENT, backgroundColor: colors.tealSoft }]}
        onPress={() => set('lock_mode')('notify_only')}
      >
        <BellRing size={14} color={form.lock_mode === 'notify_only' ? ACCENT : colors.textMid} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700' }}>Never lock, only reminders</Text>
          <Text style={{ color: colors.textMid, fontSize: 12 }}>Due and overdue notices only. The phone never locks.</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={s.button} onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel="Add customer">
        <UserPlus color={colors.onAccent} size={16} />
        <Text style={s.buttonText}>{busy ? 'Adding…' : 'Add customer'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; icon: typeof Wallet; keyboard?: 'numeric' }) {
  const I = props.icon;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 }}>
        <I size={12} color={colors.textMid} />
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

function Devices({ onUnlockCode }: { onUnlockCode: (d: Device) => void }) {
  const [rows, setRows] = useState<Device[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [alerting, setAlerting] = useState<string | null>(null);
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

  async function alert(d: Device) {
    if (alerting) return;
    setAlerting(d.id);
    setErr(null);
    try {
      await api.sendCommand(d.id, 'ALERT');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Alert failed');
    } finally {
      setAlerting(null);
    }
  }

  return (
    <View style={s.page}>
      <Text style={s.title}>Devices</Text>
      {err && <Text style={s.error}>{err}</Text>}
      <FlatList
        data={rows}
        keyExtractor={(d) => d.id}
        renderItem={({ item: d }) => (
          <View style={s.card}>
            <Text style={s.cardTitle}>{d.manufacturer} {d.model}</Text>
            <View style={s.chipRow}>
              <Chip tone={d.mode === 'device_owner' ? colors.accentTeal : colors.textMid} label={d.mode === 'device_owner' ? 'Device owner' : d.mode === 'device_admin' ? 'Device admin' : 'Not enrolled'} />
              <Chip tone={d.is_locked ? colors.danger : colors.accentTeal} label={d.is_locked ? 'Locked' : 'Unlocked'} />
            </View>
            <View style={s.quickRow}>
              <TouchableOpacity
                style={[s.button, { marginTop: 0, flex: 1 }]}
                onPress={() => toggle(d)}
                accessibilityRole="button"
                accessibilityLabel={d.is_locked ? 'Unlock device' : 'Lock device'}
              >
                {d.is_locked ? <LockOpen color={colors.onAccent} size={16} /> : <Lock color={colors.onAccent} size={16} />}
                <Text style={s.buttonText}>{d.is_locked ? 'Unlock' : 'Lock'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.outlineBtn, { marginTop: 0, flex: 1 }]}
                onPress={() => onUnlockCode(d)}
                accessibilityRole="button"
                accessibilityLabel="Offline unlock code"
              >
                <KeyRound size={14} color={ACCENT} />
                <Text style={s.outlineBtnText} numberOfLines={1} adjustsFontSizeToFit>Offline code</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.outlineBtn, { marginTop: 0, flex: 1 }]}
                onPress={() => alert(d)}
                disabled={alerting === d.id}
                accessibilityRole="button"
                accessibilityLabel="Alert the phone"
              >
                <BellRing size={14} color={ACCENT} />
                <Text style={s.outlineBtnText}>{alerting === d.id ? 'Sending…' : 'Alert'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.muted}>No devices yet.</Text>}
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}

/**
 * Google Authenticator-style offline unlock code for one device. The TOTP
 * secret is fetched once (online) and cached in SecureStore; codes are then
 * generated locally forever, so this works with the phone fully offline.
 */
function UnlockCodeScreen({ device, onClose }: { device: Device; onClose: () => void }) {
  const key = `emidost.retailer.unlockkey.${device.id}`;
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await api.listCustomers();
        if (active) setCustomerName(list.find((c) => c.id === device.customer_id)?.name ?? null);
      } catch {
        // The name is optional decoration; the code works without it.
      }
    })();
    return () => { active = false; };
  }, [device.customer_id]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let saved = await SecureStore.getItemAsync(key);
        if (!saved) {
          const res = await api.getDeviceUnlockKey(device.id);
          saved = res.secret;
          await SecureStore.setItemAsync(key, saved);
        }
        if (active) setSecret(saved);
      } catch (e) {
        if (!active) return;
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('409')) {
          setError('The phone has no unlock key yet. It must complete one online sync before offline unlock works.');
        } else {
          setError('No saved key. Connect once to load it.');
        }
      }
    })();
    return () => { active = false; };
  }, [key, device.id]);

  // 1 s tick: the code recomputes and flips at each 30 s boundary.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (active) setReduceMotion(v); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const code = useMemo(() => (secret ? totpCode(secret, now) : null), [secret, now]);
  const secondsLeft = totpSecondsLeft(now);

  async function copyCode() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  const header = customerName
    ? `${customerName} · ${device.manufacturer ?? ''} ${device.model ?? ''}`.trim()
    : `${device.manufacturer ?? ''} ${device.model ?? ''}`.trim();

  // Countdown ring: the stroke drains as the 30 s window elapses.
  const R = 44;
  const CIRC = 2 * Math.PI * R;
  const dashOffset = CIRC * (1 - secondsLeft / 30);

  return (
    <View style={s.page}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Back to devices" style={s.backBtn}>
          <ArrowLeft color={ACCENT} size={18} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Offline unlock code</Text>
      </View>
      <Text style={s.muted}>{header}</Text>

      {error ? (
        <View style={s.card}>
          <Text style={s.muted}>{error}</Text>
          <TouchableOpacity style={s.button} onPress={onClose} accessibilityRole="button" accessibilityLabel="Back to devices">
            <ArrowLeft color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>Back to devices</Text>
          </TouchableOpacity>
        </View>
      ) : !secret || !code ? (
        <View style={s.center}><ActivityIndicator color={ACCENT} size="large" /></View>
      ) : (
        <View style={[s.card, { alignItems: 'center', marginTop: 16 }]}>
          <Text style={s.codeLabel}>Current code</Text>
          <Text
            style={s.bigCode}
            accessibilityLabel={`Unlock code ${code.slice(0, 4)} ${code.slice(4)}`}
          >
            {code.slice(0, 4)} {code.slice(4)}
          </Text>
          {reduceMotion ? (
            <Text style={s.muted}>New code in {secondsLeft}s</Text>
          ) : (
            <>
              <View style={s.ringWrap}>
                <Svg width={110} height={110} viewBox="0 0 110 110">
                  <Circle cx={55} cy={55} r={R} stroke={colors.border} strokeWidth={6} fill="none" />
                  <Circle
                    cx={55} cy={55} r={R}
                    stroke={ACCENT} strokeWidth={6} fill="none"
                    strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                    transform="rotate(-90 55 55)"
                  />
                </Svg>
              </View>
              <Text style={s.muted}>New code in {secondsLeft}s</Text>
            </>
          )}
          <TouchableOpacity style={[s.button, { marginTop: 12 }]} onPress={copyCode} accessibilityRole="button" accessibilityLabel="Copy code">
            <Copy color={colors.onAccent} size={16} />
            <Text style={s.buttonText}>{copied ? 'Copied' : 'Copy code'}</Text>
          </TouchableOpacity>
          <Text style={[s.muted, { textAlign: 'center', marginTop: 12 }]}>
            Long-press the lock emblem on the phone, then type this code.
          </Text>
        </View>
      )}
    </View>
  );
}

function Enrol({ brand, onWirelessEnrol }: { brand: string; onWirelessEnrol: () => void }) {
  const [steps, setSteps] = useState<string[]>([]);
  const [hint, setHint] = useState('');
  const [profileName, setProfileName] = useState('');
  useEffect(() => {
    // The walkthrough targets the CUSTOMER phone brand chosen in the form
    // (empty brand falls back to the generic near-stock checklist).
    const profile = getOemProfile(brand, brand);
    setSteps(profile.setupSteps);
    setHint(profile.wirelessDebugGateHint);
    setProfileName(profile.displayName);
  }, [brand]);

  return (
    <ScrollView style={s.page}>
      <Text style={s.title}>Enrol a phone</Text>
      <Text style={s.muted}>Walkthrough for: {profileName || 'Unknown brand'}</Text>
      <Text style={s.muted}>
        1. Take the customer's consent at the counter and create a setup code on their customer card. 2. Factory-reset the customer phone, skip every account, set no PIN.
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
      <TouchableOpacity style={s.button} onPress={() => { if (API_URL) void Linking.openURL(`${API_URL}/qr`); }} accessibilityRole="button" accessibilityLabel="Open portal QR page">
        <QrCode color={colors.onAccent} size={16} />
        <Text style={s.buttonText}>Open portal QR page</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.outlineBtn, { marginTop: 12 }]}
        onPress={onWirelessEnrol}
        accessibilityRole="button"
        accessibilityLabel="Wireless enrol"
      >
        <Settings2 size={14} color={ACCENT} />
        <Text style={s.outlineBtnText}>Wireless enrol</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/**
 * Wireless self-pair enrolment: the staff types the host, pair port, connect
 * port and 6-digit code from the customer phone (pairing dialog + wireless
 * debugging screen), then the bundled adb client runs pair → connect →
 * pm grant → device owner → readback → debug off → disconnect. Every step
 * reports { ok, output } honestly; a failed step stops the chain and shows
 * the exact adb output.
 */
function WirelessEnrol({ onClose }: { onClose: () => void }) {
  const [host, setHost] = useState('');
  const [pairPort, setPairPort] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<{ label: string; status: 'pending' | 'running' | 'ok' | 'failed'; output: string }[]>([
    { label: 'Prepare adb', status: 'pending', output: '' },
    { label: 'Pair', status: 'pending', output: '' },
    { label: 'Connect', status: 'pending', output: '' },
    { label: 'Grant permissions', status: 'pending', output: '' },
    { label: 'Set device owner', status: 'pending', output: '' },
    { label: 'Turn off debugging', status: 'pending', output: '' },
    { label: 'Disconnect', status: 'pending', output: '' },
  ]);

  const setStep = (i: number, status: 'pending' | 'running' | 'ok' | 'failed', output: string) => {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status, output } : s)));
  };

  async function run() {
    if (busy) return;
    if (!host.trim() || !pairPort.trim() || !connectPort.trim() || !code.trim()) {
      setErr('Type the host, pair port, connect port and pairing code first.');
      return;
    }
    setBusy(true);
    setErr(null);
    const pkg = 'com.emidost.customer';
    const admin = 'com.emidost.devicemanagement.EmidostDeviceAdminReceiver';
    try {
      setStep(0, 'running', '');
      let r = await DeviceMgmt.adbPrepare();
      if (!r.ok) { setStep(0, 'failed', r.error ?? r.output); return; }
      setStep(0, 'ok', r.output);

      setStep(1, 'running', '');
      r = await DeviceMgmt.adbPair(host.trim(), pairPort.trim(), code.trim());
      if (!r.ok) { setStep(1, 'failed', r.error ?? r.output); return; }
      setStep(1, 'ok', r.output);

      setStep(2, 'running', '');
      r = await DeviceMgmt.adbConnect(host.trim(), connectPort.trim());
      if (!r.ok) { setStep(2, 'failed', r.error ?? r.output); return; }
      setStep(2, 'ok', r.output);

      setStep(3, 'running', '');
      r = await DeviceMgmt.adbGrantRuntimePermissions(pkg);
      setStep(3, r.ok ? 'ok' : 'failed', r.output);
      // Refused grants are skipped, not fatal; the chain continues.

      setStep(4, 'running', '');
      r = await DeviceMgmt.adbSetDeviceOwner(pkg, admin);
      if (!r.ok) { setStep(4, 'failed', r.error ?? r.output); return; }
      setStep(4, 'ok', r.output);

      setStep(5, 'running', '');
      r = await DeviceMgmt.adbDisableDebugging();
      setStep(5, r.ok ? 'ok' : 'failed', r.error || r.output);
    } finally {
      if (host.trim() && connectPort.trim()) {
        try {
          const d = await DeviceMgmt.adbDisconnect(host.trim(), connectPort.trim());
          setStep(6, d.ok ? 'ok' : 'failed', d.output);
        } catch {
          setStep(6, 'failed', 'disconnect failed');
        }
      } else {
        setStep(6, 'pending', '');
      }
      setBusy(false);
    }
  }

  return (
    <View style={s.page}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Back to enrol" style={s.backBtn}>
          <ArrowLeft color={ACCENT} size={18} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Wireless enrol</Text>
      </View>
      <Text style={s.muted}>Type the three numbers from the customer phone: the pair port and code from the pairing dialog, and the connect port from the Wireless debugging screen.</Text>
      <TextInput style={s.input} placeholder="Host (192.168.1.5)" value={host} onChangeText={setHost} autoCapitalize="none" autoCorrect={false} />
      <TextInput style={s.input} placeholder="Pair port (37001)" value={pairPort} onChangeText={setPairPort} keyboardType="numeric" />
      <TextInput style={s.input} placeholder="Connect port (40051)" value={connectPort} onChangeText={setConnectPort} keyboardType="numeric" />
      <TextInput style={s.input} placeholder="6-digit pairing code" value={code} onChangeText={setCode} keyboardType="numeric" maxLength={6} />
      {err && <Text style={s.error}>{err}</Text>}
      <TouchableOpacity style={s.button} onPress={run} disabled={busy} accessibilityRole="button" accessibilityLabel="Start wireless enrol">
        <Play color={colors.onAccent} size={16} />
        <Text style={s.buttonText}>{busy ? 'Running…' : 'Start'}</Text>
      </TouchableOpacity>

      <View style={s.card}>
        {steps.map((st, i) => (
          <View key={st.label} style={{ marginTop: i === 0 ? 0 : 8 }}>
            <Text style={[s.stepLabel, st.status === 'failed' && { color: colors.danger }, st.status === 'ok' && { color: colors.success }]}>
              {st.label}{st.status === 'running' ? '…' : ''} {st.status === 'ok' ? 'ok' : st.status === 'failed' ? 'failed' : ''}
            </Text>
            {!!st.output && <Text style={s.stepOutput}>{st.output}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  page: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontWeight: '700', fontSize: 16, flex: 1 },
  headerMeta: { color: colors.textMid, fontSize: 12 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 2 },
  tabActive: { backgroundColor: colors.tealSoft },
  tabLabel: { fontSize: 11, color: colors.textMid, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 10 },
  cardTitle: { fontWeight: '700', fontSize: 15 },
  muted: { color: colors.textMid, fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMid },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, fontSize: 15, marginTop: 4, backgroundColor: colors.surface },
  error: { color: colors.danger, marginTop: 8 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderRadius: 8, padding: 14, marginTop: 12 },
  buttonText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, marginTop: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textHi },

  // Offline unlock code screen.
  outlineBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ACCENT, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14 },
  outlineBtnText: { color: ACCENT, fontWeight: '600', fontSize: 14 },
  backText: { color: ACCENT, fontSize: 15, fontWeight: '600' },
  codeLabel: { fontSize: 12, fontWeight: '600', color: colors.textMid },
  bigCode: { fontSize: 56, fontWeight: '700', color: ACCENT, fontVariant: ['tabular-nums'], letterSpacing: 2, marginTop: 8 },
  ringWrap: { marginTop: 12 },

  // Wireless enrol steps.
  stepLabel: { fontSize: 13, fontWeight: '600', color: colors.textHi },
  stepOutput: { fontSize: 12, color: colors.textMid, marginTop: 2, fontFamily: 'monospace' },

  // Premium layout helpers.
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingRight: 8 },
  photoPreview: { width: 112, height: 112, borderRadius: 56, borderWidth: 1, borderColor: colors.border, alignSelf: 'center', marginTop: 12 },

  // Brand mark.
  brandMark: { width: 64, height: 64, borderRadius: 16, marginBottom: 12 },
  brandMarkSm: { width: 28, height: 28, borderRadius: 8 },
});
