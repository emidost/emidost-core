import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/**
 * Shared auth read for API routes: verifies the session (cookie for the
 * portal, Bearer token for the apps/Worker parity) and returns the user +
 * live DB profile (role, retailer_id, suspension). Callers must re-check
 * role and suspension per request; a stale JWT claim is never trusted.
 */
export async function requireActor(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const authz = req.headers.get('authorization') ?? '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (bearer) {
    // App / Worker-style auth: verify the access token, read the profile live.
    // The bearer token is attached to EVERY request on this client (same as the
    // Worker adapter): without it the profile read runs as anon and RLS returns
    // no row, which made every app request 401.
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data, error } = await client.auth.getUser(bearer);
    if (error || !data.user) return { profile: null, user: null, client };
    const { data: profile } = await client
      .from('profiles')
      .select('id, role, retailer_id, is_suspended, phone')
      .eq('id', data.user.id)
      .maybeSingle();
    return { profile: profile ?? null, user: data.user, client };
  }

  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: () => {},
    },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { profile: null, user: null, client };
  const { data: profile } = await client
    .from('profiles')
    .select('id, role, retailer_id, is_suspended, phone')
    .eq('id', user.id)
    .maybeSingle();
  return { profile: profile ?? null, user, client };
}

export function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

export function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
