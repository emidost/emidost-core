'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ReceiptText, BadgeIndianRupee, Wallet, LockOpen, RefreshCw, IndianRupee,
} from 'lucide-react';

type Sale = {
  id: string;
  retailer_id: string;
  units: number;
  unit_price: number;
  total_amount: number;
  amount_paid: number;
  credits_granted: number;
  payment_mode: string;
  note: string | null;
  invoice_no: string | null;
  created_at: string;
  retailers: { name: string }[] | null;
};

type Summary = {
  sales_count: number;
  units_sold: number;
  revenue_total: number;
  collected: number;
  outstanding: number;
};

type Retailer = { id: string; name: string; credits_balance: number; lock_allowances: number };

const MODES = ['cash', 'upi', 'bank', 'card', 'credit'];

export default function SalesPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Sale[]>([]);
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({
    retailer_id: '', units: '10', unit_price: '', amount_paid: '', credits_granted: '',
    payment_mode: 'cash', note: '',
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const [s, l, r] = await Promise.all([
      fetch('/api/owner/sales/summary').then((x) => x.json()),
      fetch('/api/owner/sales?limit=200').then((x) => x.json()),
      fetch('/api/owner/retailers').then((x) => x.json()),
    ]);
    setSummary((s as Summary) ?? null);
    setRows((l as Sale[]) ?? []);
    setRetailers((r as Retailer[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const filtered = filter ? rows.filter((r) => r.retailer_id === filter) : rows;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    if (!form.retailer_id) { setErr('Choose a retailer'); setBusy(false); return; }
    const res = await fetch(`/api/owner/retailers/${form.retailer_id}/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        units: parseInt(form.units, 10),
        unit_price: parseFloat(form.unit_price),
        amount_paid: form.amount_paid === '' ? undefined : parseFloat(form.amount_paid),
        credits_granted: form.credits_granted === '' ? undefined : parseInt(form.credits_granted, 10),
        payment_mode: form.payment_mode,
        note: form.note === '' ? undefined : form.note,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setErr(body.error ?? 'Sale failed');
    else {
      setMsg(`Sale recorded. ${body.units} locks granted to the retailer.`);
      setForm({ ...form, unit_price: '', amount_paid: '', note: '' });
      void load();
    }
    setBusy(false);
  }

  return (
    <main className="page" id="main" tabIndex={-1}>
      <h1 className="page-title band-title"><ReceiptText size={20} aria-hidden="true" /> Sales</h1>
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}

      <section className="dash-band" style={{ padding: 20 }}>
        <div className="stat-grid" aria-label="Sales totals">
          {loading ? (
            <>
              <div className="stat-card"><span className="skeleton-cell" style={{ width: 96 }} /></div>
              <div className="stat-card"><span className="skeleton-cell" style={{ width: 96 }} /></div>
              <div className="stat-card"><span className="skeleton-cell" style={{ width: 96 }} /></div>
              <div className="stat-card"><span className="skeleton-cell" style={{ width: 96 }} /></div>
            </>
          ) : (
            <>
              <div className="stat-card">
                <span className="stat-icon tone-indigo"><LockOpen size={20} aria-hidden="true" /></span>
                <div className="stat-num">{summary?.units_sold ?? 0}</div>
                <div className="stat-label">Locks sold</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon tone-teal"><IndianRupee size={20} aria-hidden="true" /></span>
                <div className="stat-num">Rs {summary?.revenue_total ?? 0}</div>
                <div className="stat-label">Revenue</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon tone-teal"><BadgeIndianRupee size={20} aria-hidden="true" /></span>
                <div className="stat-num">Rs {summary?.collected ?? 0}</div>
                <div className="stat-label">Collected</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon tone-amber"><Wallet size={20} aria-hidden="true" /></span>
                <div className="stat-num">Rs {summary?.outstanding ?? 0}</div>
                <div className="stat-label">Outstanding</div>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}><ReceiptText size={16} aria-hidden="true" /> Record a sale</h2>
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Retailer</label>
            <select className="input" value={form.retailer_id} onChange={(e) => setForm({ ...form, retailer_id: e.target.value })} required>
              <option value="">Choose a retailer</option>
              {retailers.map((r) => <option key={r.id} value={r.id}>{r.name} (credits {r.credits_balance} · locks {r.lock_allowances})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Payment mode</label>
            <select className="input" value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Units (locks sold)</label>
            <input className="input" type="number" min={1} value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} required />
          </div>
          <div>
            <label className="label">Price per lock (Rs)</label>
            <input className="input" type="number" min={0} step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} required />
          </div>
          <div>
            <label className="label">Amount paid (Rs, up to the total)</label>
            <input className="input" type="number" min={0} step="0.01" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} />
          </div>
          <div>
            <label className="label">Device credits granted (default = units)</label>
            <input className="input" type="number" min={0} value={form.credits_granted} onChange={(e) => setForm({ ...form, credits_granted: e.target.value })} placeholder="Same as units" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="label">Note</label>
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional note" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn primary" disabled={busy}>
              {busy ? <RefreshCw size={14} aria-hidden="true" /> : <ReceiptText size={14} aria-hidden="true" />}
              {busy ? 'Recording…' : 'Record sale'}
            </button>
          </div>
        </form>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '12px 0 0' }}>
          Recording grants the locks and device credits to the retailer and writes the invoice to the ledger.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}><ReceiptText size={16} aria-hidden="true" /> Sales history</h2>
          <select className="input" style={{ maxWidth: 260 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by retailer">
            <option value="">All retailers</option>
            {retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <table className="table-actions">
          <thead><tr><th>Date</th><th>Invoice</th><th>Retailer</th><th>Units</th><th>Unit price</th><th>Total</th><th>Paid</th><th>Balance</th><th>Mode</th></tr></thead>
          <tbody>
            {loading && (
              <>
                <tr><td colSpan={9}><span className="skeleton-cell" /></td></tr>
                <tr><td colSpan={9}><span className="skeleton-cell" /></td></tr>
              </>
            )}
            {!loading && filtered.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.created_at).toLocaleDateString()}</td>
                <td>{s.invoice_no ?? '-'}</td>
                <td>{s.retailers?.[0]?.name ?? 'Unknown'}</td>
                <td>{s.units}</td>
                <td>Rs {Number(s.unit_price).toFixed(2)}</td>
                <td>Rs {Number(s.total_amount).toFixed(2)}</td>
                <td>Rs {Number(s.amount_paid).toFixed(2)}</td>
                <td>Rs {(Number(s.total_amount) - Number(s.amount_paid)).toFixed(2)}</td>
                <td><span className="chip muted">{s.payment_mode}</span></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={9}>
                  <div className="empty">
                    <ReceiptText className="empty-icon" size={28} aria-hidden="true" />
                    <p>No sales yet. Record the first sale above.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 8 }}>
        <Link href="/retailers">Manage retailer credits and allowances</Link> · each sale writes an invoice to the credit ledger.
      </p>
    </main>
  );
}
