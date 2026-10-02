'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Coins, Lock, Pencil, Store } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';
import type { Retailer } from '@emidost/shared';

export default function RetailerEditPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<Retailer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [credits, setCredits] = useState('');
  const [allowances, setAllowances] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const supabase = browserClient();

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('retailers').select('*').eq('id', id).maybeSingle();
      if (data) {
        setRow(data);
        setName(data.name);
        setPhone(data.phone);
      }
    })();
  }, [id]);

  async function save() {
    const res = await fetch(`/api/owner/retailers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    if (!res.ok) setErr('Save failed');
    else setMsg('Saved');
  }

  async function giveCredits() {
    const delta = parseInt(credits, 10);
    if (!Number.isFinite(delta)) { setErr('Enter a number'); return; }
    const res = await fetch(`/api/owner/retailers/${id}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta, kind: 'topup' }),
    });
    if (!res.ok) setErr('Credit update failed');
    else { setMsg('Credits updated'); setCredits(''); }
  }

  async function setAllowancesNow() {
    const value = parseInt(allowances, 10);
    if (!Number.isFinite(value)) { setErr('Enter a number'); return; }
    const res = await fetch(`/api/owner/retailers/${id}/allowances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowances: value }),
    });
    if (!res.ok) setErr('Allowance update failed');
    else { setMsg('Allowances updated'); setAllowances(''); }
  }

  return (
    <main className="page" id="main" tabIndex={-1} style={{ maxWidth: 640 }}>
      <h1 className="page-title"><Store size={20} aria-hidden="true" /> {row?.name ?? 'Retailer'}</h1>
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      <div className="card">
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="label">Phone (SMS lock/unlock sender)</label>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="btn primary" style={{ marginTop: 12 }} onClick={save}><Pencil size={14} aria-hidden="true" /> Save changes</button>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><Coins size={16} aria-hidden="true" /> Credits (device slots): {row?.credits_balance ?? 0}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Number to add" value={credits} onChange={(e) => setCredits(e.target.value)} />
          <button className="btn primary" onClick={giveCredits}><Coins size={14} aria-hidden="true" /> Add credits</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><Lock size={16} aria-hidden="true" /> Lock allowances: {row?.lock_allowances ?? 0}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="New total" value={allowances} onChange={(e) => setAllowances(e.target.value)} />
          <button className="btn primary" onClick={setAllowancesNow}><Lock size={14} aria-hidden="true" /> Set allowances</button>
        </div>
      </div>
    </main>
  );
}
