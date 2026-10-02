'use client';

import { useState } from 'react';
import { LogIn, ShieldCheck, RefreshCw } from 'lucide-react';
import { browserClient } from '@/lib/supabaseClient';

export default function LoginPage() {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = browserClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: id, password });
    setBusy(false);
    if (err) setError(err.message);
    else window.location.href = '/';
  }

  return (
    <main style={{ maxWidth: 360, margin: '12vh auto', padding: 16 }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <ShieldCheck size={22} color="var(--owner)" aria-hidden="true" />
          <h1 style={{ margin: 0, fontSize: 18 }}>emidost</h1>
        </div>
        <form onSubmit={submit}>
          <label className="label" htmlFor="id">Login ID</label>
          <input id="id" className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" />
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <button className="btn primary" style={{ width: '100%', marginTop: 16, justifyContent: 'center' }} disabled={busy}>
            {busy ? <RefreshCw size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
