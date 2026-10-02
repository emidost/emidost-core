'use client';

import { useEffect, useState } from 'react';
import { Smartphone, Store, Wallet } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';

export default function ConsolePage() {
  const [counts, setCounts] = useState({ customers: 0, devices: 0, locked: 0 });
  const [retailer, setRetailer] = useState<{ name: string; credits_balance: number; lock_allowances: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = browserClient();

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('retailer_id').eq('id', user.id).maybeSingle();
      const rid = profile?.retailer_id;
      if (!rid) return;
      const { data: r } = await supabase.from('retailers').select('name, credits_balance, lock_allowances').eq('id', rid).maybeSingle();
      setRetailer(r ?? null);
      const [c, d, l] = await Promise.all([
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('retailer_id', rid),
        supabase.from('devices').select('id', { count: 'exact', head: true }).eq('retailer_id', rid),
        supabase.from('devices').select('id', { count: 'exact', head: true }).eq('retailer_id', rid).eq('is_locked', true),
      ]);
      setCounts({ customers: c.count ?? 0, devices: d.count ?? 0, locked: l.count ?? 0 });
      setLoading(false);
    })();
  }, []);

  return (
    <main className="page console-page" id="main" tabIndex={-1}>
      <h1 className="page-title"><Store size={20} aria-hidden="true" /> {retailer?.name ?? 'Console'}</h1>
      <div className="grid cols-3">
        {loading ? (
          <>
            <div className="card stat"><div className="icon" style={{ background: 'var(--retailer)' }}><Wallet size={18} aria-hidden="true" /></div><div style={{ flex: 1 }}><span className="skeleton-cell" style={{ width: 56 }} /><span className="skeleton-cell" style={{ width: 90, marginTop: 6 }} /></div></div>
            <div className="card stat"><div className="icon" style={{ background: 'var(--info)' }}><Smartphone size={18} aria-hidden="true" /></div><div style={{ flex: 1 }}><span className="skeleton-cell" style={{ width: 56 }} /><span className="skeleton-cell" style={{ width: 90, marginTop: 6 }} /></div></div>
            <div className="card stat"><div className="icon" style={{ background: 'var(--danger)' }}><Smartphone size={18} aria-hidden="true" /></div><div style={{ flex: 1 }}><span className="skeleton-cell" style={{ width: 56 }} /><span className="skeleton-cell" style={{ width: 90, marginTop: 6 }} /></div></div>
          </>
        ) : (
          <>
            <div className="card stat"><div className="icon" style={{ background: 'var(--retailer)' }}><Wallet size={18} aria-hidden="true" /></div><div><div className="num">{counts.customers}</div><div className="cap">Customers</div></div></div>
            <div className="card stat"><div className="icon" style={{ background: 'var(--info)' }}><Smartphone size={18} aria-hidden="true" /></div><div><div className="num">{counts.devices}</div><div className="cap">Devices</div></div></div>
            <div className="card stat"><div className="icon" style={{ background: 'var(--danger)' }}><Smartphone size={18} aria-hidden="true" /></div><div><div className="num">{counts.locked}</div><div className="cap">Locked now</div></div></div>
          </>
        )}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ margin: 0 }}>
          {loading
            ? <span className="skeleton-cell" style={{ width: 320 }} />
            : <>Credits (device slots): <b>{retailer?.credits_balance ?? 0}</b> · Lock allowances: <b>{retailer?.lock_allowances ?? 0}</b></>}
        </p>
      </div>
    </main>
  );
}
