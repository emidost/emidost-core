import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'emidost',
  description: 'Financed phone management for owners and retailers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
