import { Store, Smartphone, ShieldAlert, Wallet } from 'lucide-react';
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
    { label: 'Retailers', value: retailerCount ?? 0, icon: Store, color: 'var(--owner)' },
    { label: 'Devices', value: deviceCount ?? 0, icon: Smartphone, color: 'var(--info)' },
    { label: 'Locked now', value: lockedCount ?? 0, icon: ShieldAlert, color: 'var(--danger)' },
    { label: 'Overdue instalments', value: overdueCount ?? 0, icon: Wallet, color: 'var(--warn)' },
  ];

  return (
    <main className="page">
      <h1 className="page-title"><Store size={20} /> Dashboard</h1>
      <div className="grid cols-4">
        {stats.map((s) => (
          <div className="card stat" key={s.label}>
            <div className="icon" style={{ background: s.color }}><s.icon size={18} /></div>
            <div>
              <div className="num">{s.value}</div>
              <div className="cap">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
