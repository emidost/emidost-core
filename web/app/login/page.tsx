'use client';

import { useState } from 'react';
import Image from 'next/image';
import { LogIn, RefreshCw } from 'lucide-react';
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
    <main className="login-main" id="main" tabIndex={-1}>
      <div className="card login-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image src="/mark.png" alt="emidost" width={64} height={64} priority style={{ borderRadius: 16 }} />
          <h1 style={{ margin: '14px 0 0', fontSize: 24, letterSpacing: '-0.02em', lineHeight: 1.2 }}>emidost</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>Owner and retailer portal</p>
        </div>
        <form onSubmit={submit}>
          <label className="label" htmlFor="id">Login ID</label>
          <input id="id" className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" />
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <button className="btn primary" style={{ width: '100%', marginTop: 20, justifyContent: 'center' }} disabled={busy}>
            {busy ? <RefreshCw size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
