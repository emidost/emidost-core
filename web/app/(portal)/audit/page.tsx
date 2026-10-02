'use client';

import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';
import type { AuditRow } from '@emidost/shared';

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = browserClient();

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
      if (err) setError(err.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <main className="page" id="main" tabIndex={-1}>
      <h1 className="page-title band-title"><ScrollText size={20} aria-hidden="true" /> Audit</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            {loading && (
              <>
                <tr><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td></tr>
                <tr><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td></tr>
                <tr><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td></tr>
              </>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.actor_id ?? 'system'}</td>
                <td>{r.event}</td>
                <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(r.detail)}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={4}>
                  <div className="empty">
                    <ScrollText className="empty-icon" size={28} aria-hidden="true" />
                    <p>No activity yet. Every action lands here.</p>
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
