import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  LayoutDashboard, Store, Smartphone, QrCode, ScrollText, Wallet, Users, ReceiptText,
} from 'lucide-react';
import { serverClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles').select('role, is_suspended').eq('id', user.id).maybeSingle();
  if (!profile || profile.is_suspended) redirect('/login');
  const owner = profile.role === 'owner';

  const links = owner
    ? [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/retailers', label: 'Retailers', icon: Store },
        { href: '/sales', label: 'Sales', icon: ReceiptText },
        { href: '/devices', label: 'Devices', icon: Smartphone },
        { href: '/qr', label: 'Enrolment QR', icon: QrCode },
        { href: '/audit', label: 'Audit', icon: ScrollText },
      ]
    : [
        { href: '/console', label: 'Console', icon: LayoutDashboard },
        { href: '/console/customers', label: 'Customers', icon: Users },
        { href: '/console/customers/new', label: 'New customer', icon: Wallet },
        { href: '/console/devices', label: 'Devices', icon: Smartphone },
      ];

  return (
    <div>
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="nav" aria-label="Portal">
        <Link href="/" className="brand" aria-label="emidost home">
          <Image src="/mark.png" alt="" width={32} height={32} style={{ borderRadius: 8 }} />
          <span>emidost</span>
        </Link>
        <span className="nav-sep" aria-hidden="true" />
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            <l.icon size={16} aria-hidden="true" /> {l.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
