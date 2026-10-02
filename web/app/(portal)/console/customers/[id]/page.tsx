'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Banknote, CalendarDays, ReceiptText, BellRing, BellOff, RefreshCw } from 'lucide-react';
import type { Customer, EmiSchedule, Payment } from '@emidost/shared';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [schedules, setSchedules] = useState<EmiSchedule[]>([]);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [escalation, setEscalation] = useState(true);
  const [escalationBusy, setEscalationBusy] = useState(false);

  async function load() {
    const [c, p, s] = await Promise.all([
      fetch(`/api/retailer/customers?id=${encodeURIComponent(id)}`).then((r) => r.json()),
      fetch(`/api/retailer/customers/${id}/payments`).then((r) => r.json()),
      fetch(`/api/retailer/customers/${id}/schedules`).then((r) => r.json()),
    ]);
    const raw = (c as Array<Record<string, unknown>>) ?? [];
    setCustomer((raw.find((x) => x.id === id) as unknown as Customer) ?? null);
    const row = raw.find((x) => x.id === id);
    setEscalation(row?.overdue_escalation_enabled !== false);
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

  async function toggleEscalation() {
    setEscalationBusy(true);
    setErr(null);
    const res = await fetch(`/api/retailer/customers/${id}/escalation`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !escalation }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setErr(body.error ?? 'Toggle failed');
    else {
      setEscalation(!escalation);
      setMsg(escalation ? 'Voice alerts and location SMS stopped' : 'Voice alerts and location SMS enabled');
    }
    setEscalationBusy(false);
  }

  return (
    <main className="page console-page" id="main" tabIndex={-1} style={{ maxWidth: 720 }}>
      <h1 className="page-title"><ReceiptText size={20} aria-hidden="true" /> {customer?.name ?? 'Customer'}</h1>
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}

      <div className="card">
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><Banknote size={16} aria-hidden="true" /> Record payment</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="number" min={0} placeholder="Amount (Rs)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn primary" onClick={record}><Banknote size={14} aria-hidden="true" /> Record payment</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BellRing size={16} aria-hidden="true" /> Overdue escalation
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              Stops the 30-minute voice alerts and the location SMS when overdue.
            </p>
          </div>
          <button
            className={`btn sm ${escalation ? '' : 'primary'}`}
            onClick={toggleEscalation}
            disabled={escalationBusy}
            aria-pressed={escalation}
          >
            {escalationBusy
              ? <RefreshCw size={14} aria-hidden="true" />
              : escalation ? <BellOff size={14} aria-hidden="true" /> : <BellRing size={14} aria-hidden="true" />}
            {escalation ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><CalendarDays size={16} aria-hidden="true" /> Schedule</h2>
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
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}><ReceiptText size={16} aria-hidden="true" /> Payments</h2>
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
