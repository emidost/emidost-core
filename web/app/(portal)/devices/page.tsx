'use client';

import { useEffect, useState } from 'react';
import { Lock, LockOpen, Smartphone, QrCode, RotateCw, KeyRound, Image, Signal } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';
import type { Device } from '@emidost/shared';

export default function DevicesPage() {
  const [rows, setRows] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = browserClient();

  useEffect(() => {
    void (async () => {
      // Explicit columns (owner board): keep pin_verify / token hash / SIM
      // baselines out of the browser payload even for the owner.
      const { data, error: err } = await supabase.from('devices')
        .select('id, customer_id, retailer_id, installation_id, manufacturer, model, os_version, mode, is_locked, hidden_state, last_heartbeat_at, last_location, last_location_at, sim_info, created_at')
        .order('created_at', { ascending: false });
      if (err) setError(err.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  async function send(
    deviceId: string,
    command: 'LOCK' | 'UNLOCK' | 'REBOOT' | 'RELEASE' | 'SET_DEVICE_PIN' | 'SET_WALLPAPER' | 'GET_SIM',
    payload?: Record<string, unknown>,
  ) {
    const res = await fetch('/api/retailer/devices/command-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, command_type: command, ...(payload ? { payload } : {}) }),
    });
    if (!res.ok) setError(`${command} failed`);
    else window.location.reload();
  }

  function setPin(deviceId: string) {
    const pin = window.prompt('New phone PIN (4 to 16 digits)');
    if (pin == null) return;
    if (!/^\d{4,16}$/.test(pin.trim())) { setError('PIN must be 4 to 16 digits'); return; }
    void send(deviceId, 'SET_DEVICE_PIN', { pin: pin.trim() });
  }

  return (
    <main className="page" id="main" tabIndex={-1}>
      <h1 className="page-title band-title"><Smartphone size={20} aria-hidden="true" /> Devices</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="card">
        <table className="table-actions">
          <thead>
            <tr><th>Model</th><th>OS</th><th>Mode</th><th>Lock</th><th>Last heartbeat</th><th></th></tr>
          </thead>
          <tbody>
            {loading && (
              <>
                <tr><td colSpan={2}><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td /></tr>
                <tr><td colSpan={2}><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td><span className="skeleton-cell" /></td><td /></tr>
              </>
            )}
            {!loading && rows.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.manufacturer} {d.model}
                  {d.sim_info ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      SIM: {d.sim_info.carrier || 'unknown'} {d.sim_info.phoneNumber || 'number n/a'}
                    </div>
                  ) : null}
                </td>
                <td>{d.os_version}</td>
                <td>
                  <span className={`chip ${d.mode === 'device_owner' ? 'ok' : 'muted'}`}>{d.mode}</span>
                </td>
                <td>
                  <span className={`chip ${d.is_locked ? 'danger' : 'info'}`}>
                    {d.is_locked ? 'Locked' : 'Unlocked'}
                  </span>
                </td>
                <td>{d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleString() : 'Never'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => send(d.id, d.is_locked ? 'UNLOCK' : 'LOCK')}>
                    {d.is_locked ? <LockOpen size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
                    {d.is_locked ? 'Unlock' : 'Lock'}
                  </button>{' '}
                  <button className="btn sm" onClick={() => send(d.id, 'REBOOT')} title="Refused while the phone is locked">
                    <RotateCw size={14} aria-hidden="true" /> Reboot
                  </button>{' '}
                  <button className="btn sm" onClick={() => setPin(d.id)} title="Set the exact lock-screen PIN">
                    <KeyRound size={14} aria-hidden="true" /> PIN
                  </button>{' '}
                  <button className="btn sm" onClick={() => send(d.id, 'SET_WALLPAPER', { mode: 'reminder' })} title="Set a reminder wallpaper">
                    <Image size={14} aria-hidden="true" /> Wallpaper
                  </button>{' '}
                  <button className="btn sm" onClick={() => send(d.id, 'SET_WALLPAPER', { mode: 'clear' })}>Clear</button>{' '}
                  <button className="btn sm" onClick={() => send(d.id, 'GET_SIM')} title="Ask the phone for its SIM info">
                    <Signal size={14} aria-hidden="true" /> SIM
                  </button>{' '}
                  <button className="btn sm" onClick={() => send(d.id, 'RELEASE')} title="Free the phone from management (owner)">
                    <LockOpen size={14} aria-hidden="true" /> Release
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={6}>
                  <div className="empty">
                    <Smartphone className="empty-icon" size={28} aria-hidden="true" />
                    <p>No devices yet. Enrol a phone to see it here.</p>
                    <a className="btn sm" href="/qr"><QrCode size={14} aria-hidden="true" /> Open enrolment QR</a>
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
