'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Store, UserPlus, Ban, CircleCheck, Pencil, Coins } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';
import type { Retailer } from '@emidost/shared';

export const dynamic = 'force-dynamic';

export default function RetailersPage() {
  const [rows, setRows] = useState<Retailer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supabase = browserClient();

  async function load() {
    const { data, error: err } = await supabase.from('retailers').select('*').order('created_at');
    if (err) setError(err.message);
    else setRows(data ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function toggleSuspend(r: Retailer) {
    const res = await fetch(`/api/owner/retailers/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_suspended: !r.is_suspended }),
    });
    if (!res.ok) setError(`Could not update ${r.name}`);
    else await load();
  }

  return (
    <main className="page">
      <h1 className="page-title"><Store size={20} /> Retailers</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Phone</th><th>Credits</th><th>Lock allowances</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.phone}</td>
                <td>{r.credits_balance}</td>
                <td>{r.lock_allowances}</td>
                <td>
                  <span className={`chip ${r.is_suspended ? 'danger' : 'ok'}`}>
                    {r.is_suspended ? <Ban size={12} /> : <CircleCheck size={12} />}
                    {r.is_suspended ? 'Suspended' : 'Active'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn" href={`/retailers/${r.id}`}><Pencil size={14} /> Edit</Link>{' '}
                  <button className="btn" onClick={() => toggleSuspend(r)}>
                    {r.is_suspended ? <CircleCheck size={14} /> : <Ban size={14} />}
                    {r.is_suspended ? 'Resume' : 'Suspend'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No retailers yet. <UserPlus size={14} /> Add one from the owner app or API.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
        <Coins size={12} /> Credits are device slots. Lock allowances are lock commands the retailer may run.
      </p>
    </main>
  );
}
