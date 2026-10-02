import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Shared auth read for API routes: verifies the session token and returns the
 * user + live DB profile (role, retailer_id, suspension). Callers must re-check
 * role and suspension per request; a stale JWT claim is never trusted.
 */
export async function requireActor(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
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
