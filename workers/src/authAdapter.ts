import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from './shims/next-server';

export interface Actor {
  profile: { id: string; role: string; retailer_id: string | null; is_suspended: boolean | null; phone: string | null } | null;
  user: { id: string } | null;
  client: SupabaseClient;
}

/**
 * Bearer-token auth for Workers: the portal/apps send the supabase access
 * token in Authorization. The profile is read LIVE (RLS) so suspension and
 * role changes apply on the next request.
 */
export async function requireActor(req: NextRequest): Promise<Actor> {
  const url = process.env.SUPABASE_URL ?? '';
  const anon = process.env.SUPABASE_ANON_KEY ?? '';
  const authz = req.headers.get('authorization') ?? '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  const client = createClient(url, anon, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!token) return { profile: null, user: null, client };
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { profile: null, user: null, client };
  const { data: profile } = await client
    .from('profiles')
    .select('id, role, retailer_id, is_suspended, phone')
    .eq('id', data.user.id)
    .maybeSingle();
  return { profile: profile ?? null, user: data.user, client };
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
