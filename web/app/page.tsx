import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles').select('role, is_suspended').eq('id', user.id).maybeSingle();
  if (!profile) redirect('/login');
  if (profile.is_suspended) redirect('/login?reason=suspended');
  redirect(profile.role === 'owner' ? '/dashboard' : '/console');
}
