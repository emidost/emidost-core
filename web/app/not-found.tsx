import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="page" id="main" tabIndex={-1} style={{ maxWidth: 480, textAlign: 'center', paddingTop: '16vh' }}>
      <Image src="/mark.png" alt="emidost" width={56} height={56} style={{ borderRadius: 14 }} />
      <h1 className="page-title" style={{ justifyContent: 'center', marginTop: 16 }}>This page does not exist</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 20px' }}>
        <SearchX size={14} aria-hidden="true" /> The link may be old or mistyped. Your data is safe.
      </p>
      <Link className="btn primary" href="/">
        <ArrowLeft size={14} aria-hidden="true" /> Back to the portal
      </Link>
    </main>
  );
}
