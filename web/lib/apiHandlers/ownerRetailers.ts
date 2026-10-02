import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const { data, error } = await serviceClient()
    .from('retailers').select('id, name, phone, credits_balance, lock_allowances, is_suspended, created_at')
    .order('created_at');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const { profile, client } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => null);
  const name: string | undefined = body?.name;
  const phone: string | undefined = body?.phone;
  const loginId: string | undefined = body?.login_id;
  const password: string | undefined = body?.password;
  if (!name || !phone || !loginId || !password || password.length < 8) {
    return bad('Name, phone, login ID and a password of at least 8 characters are required');
  }

  // Create the auth user with the SERVICE client (the request's anon client
  // cannot call auth.admin). Then the retailer row, then the staff profile.
  const svc = serviceClient();
  const { data: authUser, error: authErr } = await svc.auth.admin.createUser({
    email: loginId,
    password,
    email_confirm: true,
  });
  if (authErr || !authUser.user) return Response.json({ error: authErr?.message ?? 'auth error' }, { status: 400 });

  const { data: retailer, error: rErr } = await svc
    .from('retailers').insert({ name, phone, owner_id: profile.id })
    .select('id, name, phone, credits_balance, lock_allowances, is_suspended').single();
  if (rErr || !retailer) {
    // Best-effort rollback, now observable: a failed cleanup leaves an orphan
    // auth user the owner can see and retry.
    await svc.auth.admin.deleteUser(authUser.user.id).catch((e) => console.error('[retailer-create] rollback deleteUser failed', e));
    return Response.json({ error: rErr?.message ?? 'retailer insert failed' }, { status: 500 });
  }

  // Upsert the staff profile (the new auth schema ships no handle_new_user
  // trigger, so an UPDATE would match zero rows).
  const { error: profErr } = await svc.from('profiles').upsert({
    id: authUser.user.id, role: 'retailer_staff', retailer_id: retailer.id,
    full_name: name, phone, is_suspended: false,
  });
  if (profErr) {
    await svc.from('retailers').delete().eq('id', retailer.id);
    await svc.auth.admin.deleteUser(authUser.user.id).catch((e) => console.error('[retailer-create] rollback deleteUser failed', e));
    return Response.json({ error: profErr.message }, { status: 500 });
  }

  // RLS (0005) reads role/retailer_id from the JWT app_metadata claim. Without
  // this the staff console's direct Supabase reads return nothing. Merge-safe:
  // provider/providers are included so GoTrue account linking keeps working.
  const { error: claimErr } = await svc.auth.admin.updateUserById(authUser.user.id, {
    app_metadata: {
      role: 'retailer_staff', retailer_id: retailer.id,
      provider: 'email', providers: ['email'],
    },
  });
  if (claimErr) {
    await svc.from('retailers').delete().eq('id', retailer.id);
    await svc.auth.admin.deleteUser(authUser.user.id).catch((e) => console.error('[retailer-create] rollback deleteUser failed', e));
    return Response.json({ error: claimErr.message }, { status: 500 });
  }

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: retailer.id,
    event: 'RETAILER_CREATED', detail: { name, phone, login_id: loginId },
  });
  return Response.json(retailer, { status: 201 });
}
