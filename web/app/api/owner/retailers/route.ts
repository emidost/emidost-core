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
  return Response.json(data);
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
    await svc.auth.admin.deleteUser(authUser.user.id).catch(() => {});
    return Response.json({ error: rErr?.message ?? 'retailer insert failed' }, { status: 500 });
  }

  await svc.from('profiles')
    .update({ retailer_id: retailer.id, role: 'retailer_staff', full_name: name, phone })
    .eq('id', authUser.user.id);
  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: retailer.id,
    event: 'RETAILER_CREATED', detail: { name, phone, login_id: loginId },
  });
  return Response.json(retailer, { status: 201 });
}
