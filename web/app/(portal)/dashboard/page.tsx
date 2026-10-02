import Link from 'next/link';
import {
  Store, Smartphone, ShieldAlert, Wallet, UserPlus, QrCode,
  Coins, LockOpen, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { serverClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = serverClient();
  // Nothing writes OVERDUE, so overdue = unpaid and past its due date.
  // Due dates are calendar days in Asia/Calcutta (IST); the server (Vercel)
  // runs UTC, so compute "today" with the IST offset.
  const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
  const today = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const [{ count: retailerCount }, { count: deviceCount }, { count: lockedCount }, { count: overdueCount }, { data: salesRowsRaw }] =
    await Promise.all([
      supabase.from('retailers').select('id', { count: 'exact', head: true }),
      supabase.from('devices').select('id', { count: 'exact', head: true }),
      supabase.from('devices').select('id', { count: 'exact', head: true }).eq('is_locked', true),
      supabase.from('emi_schedules')
        .select('id', { count: 'exact', head: true })
        .in('status', ['PENDING', 'PARTIAL', 'OVERDUE'])
        .lt('due_date', today),
      // Sales aggregates: fetch the small sales set and sum in JS (sales
      // volumes are low; the heavy per-retailer breakdown lives in /sales).
      supabase.from('retailer_sales').select('units, total_amount, amount_paid'),
    ]);
  const salesRows = (salesRowsRaw ?? []) as Array<{ units: number; total_amount: number; amount_paid: number }>;
  let unitsSold = 0;
  let salesCollected = 0;
  let salesTotal = 0;
  for (const r of salesRows) {
    unitsSold += r.units;
    salesCollected += Number(r.amount_paid);
    salesTotal += Number(r.total_amount);
  }
  const salesOutstanding = Math.round((salesTotal - salesCollected) * 100) / 100;

  const stats = [
    { label: 'Retailers', value: retailerCount ?? 0, icon: Store, tone: 'indigo' },
    { label: 'Financed phones', value: deviceCount ?? 0, icon: Smartphone, tone: 'teal' },
    { label: 'Locked now', value: lockedCount ?? 0, icon: ShieldAlert, tone: 'danger' },
    { label: 'Overdue instalments', value: overdueCount ?? 0, icon: Wallet, tone: 'amber' },
  ];

  const steps = [
    { icon: UserPlus, title: 'Add a retailer', text: 'Create their login, phone, and device credits in one form.', href: '/retailers' },
    { icon: QrCode, title: 'Retailers register customers', text: 'They add the customer and EMI plan, then generate the enrolment QR.', href: '/console/customers/new' },
    { icon: Smartphone, title: 'Enrol the phone', text: 'Scan the QR on the new phone. It becomes the device owner and hides itself.', href: '/qr' },
    { icon: LockOpen, title: 'Lock, unlock, collect', text: 'Record payments, unlock on receipt, lock on missed payment, ask location anytime.', href: '/console/devices' },
  ];

  return (
    <main className="page dashboard-page" id="main" tabIndex={-1}>
      <section className="dash-band">
        <header className="dash-hero">
          <div>
            <h1 className="dash-title">Track retailers, phones, and overdue EMIs</h1>
            <p className="dash-sub">
              Retailers, financed phones, locks, and overdue instalments - live from the database.
            </p>
          </div>
          <Link className="btn primary" href="/retailers">
            <UserPlus size={16} aria-hidden="true" /> Add retailer
          </Link>
        </header>

        <div className="stat-grid" aria-label="Portfolio summary">
          {stats.map((s, i) => (
            <div className={`stat-card tone-${s.tone}`} style={{ animationDelay: `${i * 70}ms` }} key={s.label}>
              <span className="stat-icon"><s.icon size={20} aria-hidden="true" /></span>
              <div className="stat-num">{s.value}</div>
              <div className="stat-label">{s.label}</div>
              <span className="stat-sheen" aria-hidden="true" />
            </div>
          ))}
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-h2">How a financed phone goes live</h2>
        <div className="step-grid">
          {steps.map((st, i) => (
            <div className="step-card" style={{ animationDelay: `${200 + i * 90}ms` }} key={st.title}>
              <span className="step-badge">{i + 1}</span>
              <st.icon size={18} className="step-ic" aria-hidden="true" />
              <h3>{st.title}</h3>
              <p>{st.text}</p>
              <Link className="step-link" href={st.href}>
                Open <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-h2">Quick actions</h2>
        <div className="quick-row">
          <Link className="quick-card" href="/retailers">
            <Coins size={16} aria-hidden="true" /> <span><strong>Credits &amp; allowances</strong><br />Top up a retailer's lock budget.</span>
          </Link>
          <Link className="quick-card" href="/console/devices">
            <Smartphone size={16} aria-hidden="true" /> <span><strong>Devices board</strong><br />Lock, unlock, request location.</span>
          </Link>
          <Link className="quick-card" href="/qr">
            <QrCode size={16} aria-hidden="true" /> <span><strong>Provisioning QR</strong><br />The checksum-safe enrolment page.</span>
          </Link>
        </div>
        <p className="dash-note">
          <CheckCircle2 size={13} aria-hidden="true" /> Locking is local on each phone; the network only fetches commands and location. SMS works offline.
        </p>
      </section>
      <section className="dash-section">
        <h2 className="dash-h2">Sales</h2>
        <div className="quick-row">
          <Link className="quick-card" href="/sales">
            <LockOpen size={16} aria-hidden="true" /> <span><strong>{unitsSold} locks sold</strong><br />Total units sold to retailers.</span>
          </Link>
          <Link className="quick-card" href="/sales">
            <Coins size={16} aria-hidden="true" /> <span><strong>Rs {salesCollected} collected</strong><br />Payments received against invoices.</span>
          </Link>
          <Link className="quick-card" href="/sales">
            <Wallet size={16} aria-hidden="true" /> <span><strong>Rs {salesOutstanding} outstanding</strong><br />Record a sale and track every retailer.</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
