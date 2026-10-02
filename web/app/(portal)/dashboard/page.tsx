import Link from 'next/link';
import {
  Store, Smartphone, ShieldAlert, Wallet, UserPlus, QrCode,
  Coins, LockOpen, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { serverClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = serverClient();
  const [{ count: retailerCount }, { count: deviceCount }, { count: lockedCount }, { count: overdueCount }] =
    await Promise.all([
      supabase.from('retailers').select('id', { count: 'exact', head: true }),
      supabase.from('devices').select('id', { count: 'exact', head: true }),
      supabase.from('devices').select('id', { count: 'exact', head: true }).eq('is_locked', true),
      supabase.from('emi_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'OVERDUE'),
    ]);

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
    <main className="page dashboard-page">
      <header className="dash-hero">
        <div>
          <h1 className="dash-title">Track retailers, phones, and overdue EMIs</h1>
          <p className="dash-sub">
            Retailers, financed phones, locks, and overdue instalments - live from the database.
          </p>
        </div>
        <Link className="btn primary" href="/retailers">
          <UserPlus size={16} /> Add retailer
        </Link>
      </header>

      <section className="stat-grid" aria-label="Portfolio summary">
        {stats.map((s, i) => (
          <div className={`stat-card tone-${s.tone}`} style={{ animationDelay: `${i * 70}ms` }} key={s.label}>
            <span className="stat-icon"><s.icon size={20} /></span>
            <div className="stat-num">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <span className="stat-sheen" aria-hidden="true" />
          </div>
        ))}
      </section>

      <section className="dash-section">
        <h2 className="dash-h2">How a financed phone goes live</h2>
        <div className="step-grid">
          {steps.map((st, i) => (
            <div className="step-card" style={{ animationDelay: `${200 + i * 90}ms` }} key={st.title}>
              <span className="step-badge">{i + 1}</span>
              <st.icon size={18} className="step-ic" />
              <h3>{st.title}</h3>
              <p>{st.text}</p>
              <Link className="step-link" href={st.href}>
                Open <ArrowRight size={13} />
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-h2">Quick actions</h2>
        <div className="quick-row">
          <Link className="quick-card" href="/retailers">
            <Coins size={16} /> <span><strong>Credits &amp; allowances</strong><br />Top up a retailer's lock budget.</span>
          </Link>
          <Link className="quick-card" href="/console/devices">
            <Smartphone size={16} /> <span><strong>Devices board</strong><br />Lock, unlock, request location.</span>
          </Link>
          <Link className="quick-card" href="/qr">
            <QrCode size={16} /> <span><strong>Provisioning QR</strong><br />The checksum-safe enrolment page.</span>
          </Link>
        </div>
        <p className="dash-note">
          <CheckCircle2 size={13} /> Locking is local on each phone; the network only fetches commands and location. SMS works offline.
        </p>
      </section>
    </main>
  );
}
