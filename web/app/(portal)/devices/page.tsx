'use client';

import { useEffect, useState } from 'react';
import { Lock, LockOpen, Smartphone, Signal } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';
import type { Device } from '@emidost/shared';

export const dynamic = 'force-dynamic';

export default function DevicesPage() {
  const [rows, setRows] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supabase = browserClient();

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
      if (err) setError(err.message);
      else setRows(data ?? []);
    })();
  }, []);

  async function send(deviceId: string, command: 'LOCK' | 'UNLOCK') {
    const res = await fetch('/api/retailer/devices/command-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, command_type: command }),
    });
    if (!res.ok) setError(`${command} failed`);
    else window.location.reload();
  }

  return (
    <main className="page">
      <h1 className="page-title"><Smartphone size={20} /> Devices</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="card">
        <table>
          <thead>
            <tr><th>Model</th><th>OS</th><th>Mode</th><th>Lock</th><th>Last heartbeat</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.manufacturer} {d.model}</td>
                <td>{d.os_version}</td>
                <td>
                  <span className={`chip ${d.mode === 'device_owner' ? 'ok' : 'muted'}`}>{d.mode}</span>
                </td>
                <td>
                  <span className={`chip ${d.is_locked ? 'danger' : 'info'}`}>
                    {d.is_locked ? <Lock size={12} /> : <LockOpen size={12} />}
                    {d.is_locked ? 'Locked' : 'Unlocked'}
                  </span>
                </td>
                <td>{d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleString() : 'Never'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn" onClick={() => send(d.id, d.is_locked ? 'UNLOCK' : 'LOCK')}>
                    {d.is_locked ? <LockOpen size={14} /> : <Lock size={14} />}
                    {d.is_locked ? 'Unlock' : 'Lock'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)' }}><Signal size={14} /> No devices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
