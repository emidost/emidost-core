'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Banknote, CalendarDays, ReceiptText } from 'lucide-react';
import type { Customer, EmiSchedule, Payment } from '@emidost/shared';

export const dynamic = 'force-dynamic';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [schedules, setSchedules] = useState<EmiSchedule[]>([]);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const [c, p, s] = await Promise.all([
      fetch(`/api/retailer/customers`).then((r) => r.json()),
      fetch(`/api/retailer/customers/${id}/payments`).then((r) => r.json()),
      fetch(`/api/retailer/customers/${id}/schedules`).then((r) => r.json()),
    ]);
    setCustomer(((c as Customer[]) ?? []).find((x) => x.id === id) ?? null);
    setPayments(p as Payment[]);
    setSchedules(s as EmiSchedule[]);
  }

  useEffect(() => { void load(); }, [id]);

  async function record() {
    setErr(null);
    const res = await fetch(`/api/retailer/customers/${id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(amount), method: 'cash' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setErr(body.error ?? 'Payment failed');
    else { setMsg('Payment recorded'); setAmount(''); void load(); }
  }

  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title"><ReceiptText size={20} /> {customer?.name ?? 'Customer'}</h1>
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}

      <div className="card">
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><Banknote size={16} /> Record payment</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="number" min={0} placeholder="Amount (Rs)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn primary" onClick={record}>Record</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><CalendarDays size={16} /> Schedule</h2>
        <table>
          <thead><tr><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <td>{s.due_date}</td>
                <td>Rs {Number(s.amount_due).toFixed(2)}</td>
                <td><span className={`chip ${s.status === 'PAID' ? 'ok' : s.status === 'OVERDUE' ? 'danger' : 'warn'}`}>{s.status}</span></td>
              </tr>
            ))}
            {schedules.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>No schedule yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><ReceiptText size={16} /> Payments</h2>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Receipt</th><th></th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td>Rs {Number(p.amount).toFixed(2)}</td>
                <td>{p.receipt_no ?? p.method}</td>
                <td>{p.reversed_at ? <span className="chip danger">Reversed</span> : null}</td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
