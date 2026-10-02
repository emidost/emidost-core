import { redirect } from 'next/navigation';
import { serverClient, serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  let { data: profile } = await supabase
    .from('profiles').select('role, is_suspended, retailer_id').eq('id', user.id).maybeSingle();
  if (!profile) redirect('/login');

  // Claims self-heal: RLS (0005) reads role/retailer_id from the JWT
  // app_metadata claim, but accounts created outside the admin script (or
  // before the claims were written) lack it and would see zeros everywhere.
  // Backfill merge-safe (provider/providers preserved for GoTrue linking),
  // then fall through to the normal redirect; the fix takes effect for RLS on
  // the next token refresh, and route-level checks read the profile row live.
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const needsOwnerClaim = profile.role === 'owner' && meta.role !== 'owner';
  const needsStaffClaim =
    profile.role === 'retailer_staff' &&
    (meta.role !== 'retailer_staff' || meta.retailer_id !== profile.retailer_id);
  if (needsOwnerClaim || needsStaffClaim) {
    const svc = serviceClient();
    const { error } = await svc.auth.admin.updateUserById(user.id, {
      app_metadata: {
        provider: 'email', providers: ['email'],
        role: profile.role,
        ...(profile.role === 'retailer_staff' && profile.retailer_id
          ? { retailer_id: profile.retailer_id }
          : {}),
      },
    });
    if (error) {
      console.error(`[auth-self-heal] app_metadata backfill failed for ${user.id}: ${error.message}`);
    } else {
      console.log(`[auth-self-heal] backfilled app_metadata claims for ${user.id} (role=${profile.role})`);
    }
    // Re-read the profile row (unchanged; the DB row is the live source).
    const { data: reRead } = await supabase
      .from('profiles').select('role, is_suspended, retailer_id').eq('id', user.id).maybeSingle();
    profile = reRead ?? profile;
  }

  if (profile.is_suspended) redirect('/login?reason=suspended');
  redirect(profile.role === 'owner' ? '/dashboard' : '/console');
}
