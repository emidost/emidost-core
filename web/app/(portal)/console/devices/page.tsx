'use client';

import { useEffect, useState } from 'react';
import { Lock, LockOpen, Smartphone } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';
import type { Device } from '@emidost/shared';

export default function ConsoleDevicesPage() {
  const [rows, setRows] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = browserClient();

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('retailer_id').eq('id', user.id).maybeSingle();
      if (!profile?.retailer_id) return;
      // Explicit columns: pin_verify, device_token_hash, device_pin_hash and
      // SIM baselines must never reach a retailer's browser.
      const { data, error: err } = await supabase.from('devices')
        .select('id, customer_id, retailer_id, installation_id, manufacturer, model, os_version, mode, is_locked, hidden_state, last_heartbeat_at, last_location, last_location_at, created_at')
        .eq('retailer_id', profile.retailer_id);
      if (err) setError(err.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  async function send(deviceId: string, command: 'LOCK' | 'UNLOCK') {
    const res = await fetch(`/api/retailer/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_type: command, payload: {} }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? `${command} failed`);
    else window.location.reload();
  }

  return (
    <main className="page">
      <h1 className="page-title"><Smartphone size={20} aria-hidden="true" /> Devices</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Model</th><th>Mode</th><th>Lock</th><th></th></tr></thead>
          <tbody>
            {loading && (
              <>
                <tr><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td /></tr>
                <tr><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td /></tr>
              </>
            )}
            {!loading && rows.map((d) => (
              <tr key={d.id}>
                <td>{d.manufacturer} {d.model}</td>
                <td><span className={`chip ${d.mode === 'device_owner' ? 'ok' : 'muted'}`}>{d.mode}</span></td>
                <td><span className={`chip ${d.is_locked ? 'danger' : 'info'}`}>{d.is_locked ? 'Locked' : 'Unlocked'}</span></td>
                <td>
                  <button className="btn sm" onClick={() => send(d.id, d.is_locked ? 'UNLOCK' : 'LOCK')}>
                    {d.is_locked ? <LockOpen size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
                    {d.is_locked ? 'Unlock' : 'Lock'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={4}>
                  <div className="empty">
                    <Smartphone className="empty-icon" size={28} aria-hidden="true" />
                    <p>No devices yet. Enrol a phone to see it here.</p>
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
