'use client';

import { useState } from 'react';
import { CalendarDays, Hash, IndianRupee, Smartphone, UserPlus } from 'lucide-react';

const BRANDS = ['Samsung', 'Xiaomi', 'Redmi', 'POCO', 'vivo', 'iQOO', 'OPPO', 'OnePlus', 'realme', 'HONOR', 'Google Pixel', 'Motorola', 'Nothing', 'CMF', 'Lava', 'HMD', 'TECNO', 'Infinix', 'itel', 'Other'];

export default function NewCustomerPage() {
  const [form, setForm] = useState({
    name: '', phone: '', imei: '', brand: 'Samsung', model: '',
    emi_months: '12', emi_amount: '', emi_due_day: '1',
    lock_mode: 'lock' as 'lock' | 'notify_only',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setErr(null);
    const res = await fetch('/api/retailer/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        emi_months: parseInt(form.emi_months, 10),
        emi_amount: parseFloat(form.emi_amount),
        emi_due_day: parseInt(form.emi_due_day, 10),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setErr(body.error ?? 'Save failed');
    else setMsg(`Customer ${body.name} added. Record consent next, then start enrolment.`);
  }

  return (
    <main className="page" style={{ maxWidth: 640 }}>
      <h1 className="page-title"><UserPlus size={20} /> New customer</h1>
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      <form className="card" onSubmit={submit}>
        <label className="label"><Smartphone size={12} /> Name</label>
        <input className="input" value={form.name} onChange={set('name')} required />
        <label className="label">Phone number</label>
        <input className="input" value={form.phone} onChange={set('phone')} required />
        <label className="label"><Hash size={12} /> IMEI</label>
        <input className="input" value={form.imei} onChange={set('imei')} required />
        <label className="label">Brand</label>
        <select className="input" value={form.brand} onChange={set('brand')}>
          {BRANDS.map((b) => <option key={b}>{b}</option>)}
        </select>
        <label className="label">Model</label>
        <input className="input" value={form.model} onChange={set('model')} required />
        <label className="label"><CalendarDays size={12} /> EMI months</label>
        <input className="input" type="number" min={1} value={form.emi_months} onChange={set('emi_months')} />
        <label className="label"><IndianRupee size={12} /> EMI amount (per month)</label>
        <input className="input" type="number" min={0} step="0.01" value={form.emi_amount} onChange={set('emi_amount')} />
        <label className="label">Due day of month (1-31)</label>
        <input className="input" type="number" min={1} max={31} value={form.emi_due_day} onChange={set('emi_due_day')} />
        <label className="label" style={{ marginTop: 14 }}>Phone lock plan</label>
        <label className="choice" style={{ borderColor: form.lock_mode === 'lock' ? 'var(--teal)' : 'var(--line)' }}>
          <input type="radio" name="lock_mode" checked={form.lock_mode === 'lock'} onChange={() => setForm((f) => ({ ...f, lock_mode: 'lock' }))} />
          <span><strong>Lock on missed payment</strong><br />Locks the phone when overdue or 5 days offline.</span>
        </label>
        <label className="choice" style={{ borderColor: form.lock_mode === 'notify_only' ? 'var(--teal)' : 'var(--line)' }}>
          <input type="radio" name="lock_mode" checked={form.lock_mode === 'notify_only'} onChange={() => setForm((f) => ({ ...f, lock_mode: 'notify_only' }))} />
          <span><strong>Never lock, only reminders</strong><br />Due and overdue notices only. The phone never locks.</span>
        </label>
        <button className="btn teal" style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>Add customer</button>
      </form>
    </main>
  );
}
