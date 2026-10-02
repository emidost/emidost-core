'use client';

import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';
import type { AuditRow } from '@emidost/shared';

export const dynamic = 'force-dynamic';

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supabase = browserClient();

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
      if (err) setError(err.message);
      else setRows(data ?? []);
    })();
  }, []);

  return (
    <main className="page">
      <h1 className="page-title"><ScrollText size={20} /> Audit</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.actor_id ?? 'system'}</td>
                <td>{r.event}</td>
                <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(r.detail)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
