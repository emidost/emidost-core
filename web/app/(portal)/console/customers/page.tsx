'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserPlus, Users, Smartphone } from 'lucide-react';
import type { Customer } from '@emidost/shared';

export default function ConsoleCustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/retailer/customers');
      const body = await res.json().catch(() => []);
      if (!res.ok) setError(body?.error ?? 'Could not load customers');
      else setRows((body as Customer[]) ?? []);
    })();
  }, []);

  return (
    <main className="page">
      <h1 className="page-title"><Users size={20} /> Customers</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div style={{ marginBottom: 12 }}>
        <Link className="btn primary" href="/console/customers/new">
          <UserPlus size={14} /> New customer
        </Link>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Phone</th><th>Phone model</th><th>EMI</th><th>Plan</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.phone}</td>
                <td><Smartphone size={12} aria-hidden="true" /> {c.brand} {c.model}</td>
                <td>Rs {Number(c.emi_amount).toFixed(0)} x {c.emi_months}</td>
                <td>
                  <span className={`chip ${c.lock_mode === 'notify_only' ? 'muted' : 'ok'}`}>
                    {c.lock_mode === 'notify_only' ? 'Reminders only' : 'Lock on missed'}
                  </span>
                </td>
                <td>
                  <span className={`chip ${c.status === 'RUNNING' ? 'ok' : c.status === 'COMPLETE' || c.status === 'SETTLED' ? 'info' : 'danger'}`}>
                    {c.status}
                  </span>
                </td>
                <td>
                  <Link className="btn sm" href={`/console/customers/${c.id}`}>Payments</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={7}>
                  <div className="empty">
                    <Users className="empty-icon" size={28} aria-hidden="true" />
                    <p>No customers yet. Add the first financed customer.</p>
                    <Link className="btn sm" href="/console/customers/new"><UserPlus size={14} /> New customer</Link>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
