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
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', login_id: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supabase = browserClient();

  async function load() {
    const { data, error: err } = await supabase.from('retailers').select('*').order('created_at');
    if (err) setError(err.message);
    else setRows(data ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function createRetailer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/owner/retailers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? 'Create failed');
      else {
        setMsg(`${form.name} created. They can sign in with ${form.login_id}.`);
        setForm({ name: '', phone: '', login_id: '', password: '' });
        setShowForm(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

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
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}

      <div className="card" style={{ maxWidth: 560, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 15 }}><UserPlus size={16} /> New retailer account</h2>
          <button className="btn sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'Add retailer'}
          </button>
        </div>
        {showForm && (
          <form onSubmit={createRetailer} style={{ marginTop: 12 }}>
            <label className="label">Shop name</label>
            <input className="input" value={form.name} onChange={set('name')} required />
            <label className="label">Phone (their SMS lock/unlock sender)</label>
            <input className="input" value={form.phone} onChange={set('phone')} required />
            <label className="label">Login ID (email)</label>
            <input className="input" type="email" value={form.login_id} onChange={set('login_id')} required />
            <label className="label">Password (8+ characters)</label>
            <input className="input" type="password" value={form.password} onChange={set('password')} minLength={8} required />
            <button className="btn primary" style={{ marginTop: 12 }} disabled={busy}>
              {busy ? 'Creating…' : 'Create retailer'}
            </button>
          </form>
        )}
        <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 0 }}>
          Retailers sign in with this login and then create customer profiles themselves. Customers never get an account.
        </p>
      </div>

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
                    {r.is_suspended ? 'Suspended' : 'Active'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn sm" href={`/retailers/${r.id}`}><Pencil size={14} aria-hidden="true" /> Edit</Link>{' '}
                  <button className="btn sm" onClick={() => toggleSuspend(r)}>
                    {r.is_suspended ? <CircleCheck size={14} aria-hidden="true" /> : <Ban size={14} aria-hidden="true" />}
                    {r.is_suspended ? 'Resume' : 'Suspend'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={6}>
                  <div className="empty">
                    <UserPlus className="empty-icon" size={28} aria-hidden="true" />
                    <p>No retailers yet. Add one from the owner app or API.</p>
                  </div>
                </td>
              </tr>
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
