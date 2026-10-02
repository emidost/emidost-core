'use client';

import { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Download, QrCode, RefreshCw } from 'lucide-react';

export const dynamic = 'force-dynamic';

const ADMIN_COMPONENT = 'com.emidost.customer/com.emidost.devicemanagement.EmidostDeviceAdminReceiver';
const LS_KEY = 'emidost-provisioning-v1';

function hexToChecksum(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 64) throw new Error('SHA-256 must be 64 hex characters');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function QrPage() {
  const [apkUrl, setApkUrl] = useState(
    'https://github.com/emidost/emidost/releases/latest/download/emidost-customer.apk',
  );
  const [sha256, setSha256] = useState('');
  const [png, setPng] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const provisioning = useMemo(() => {
    if (!apkUrl || !sha256) return null;
    try {
      return {
        'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': ADMIN_COMPONENT,
        'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': hexToChecksum(sha256),
        'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': apkUrl,
        'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
        'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': false,
      };
    } catch {
      return null;
    }
  }, [apkUrl, sha256]);

  async function generate() {
    setError(null);
    if (!provisioning) { setError('Enter the APK URL and the signing SHA-256.'); return; }
    const data = await QRCode.toDataURL(JSON.stringify(provisioning), { errorCorrectionLevel: 'M', margin: 2, width: 720 });
    setPng(data);
  }

  return (
    <main className="page" style={{ maxWidth: 640 }}>
      <h1 className="page-title"><QrCode size={20} /> Enrolment QR (one QR, every customer)</h1>
      <div className="card">
        <label className="label">Customer APK URL (public https, GitHub release)</label>
        <input className="input" value={apkUrl} onChange={(e) => setApkUrl(e.target.value)} placeholder="https://github.com/…/releases/download/v1/customer.apk" />
        <label className="label">Signing-cert SHA-256 (from eas credentials)</label>
        <input className="input" value={sha256} onChange={(e) => setSha256(e.target.value)} placeholder="64 hex chars" />
        <button className="btn primary" onClick={generate} disabled={fetching}>
          {fetching ? <RefreshCw size={14} /> : <QrCode size={14} />} Generate QR
        </button>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      </div>
      {png && (
        <div className="card" style={{ marginTop: 12, textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={png} alt="Provisioning QR" style={{ width: 256, height: 256, margin: '0 auto' }} />
          <br />
          <a className="btn" href={png} download="emidost-provisioning-qr.png"><Download size={14} /> Download PNG</a>
          <ol style={{ textAlign: 'left', fontSize: 13, color: 'var(--muted)' }}>
            <li>Factory-reset the phone. At the first setup screen, tap the same spot 6 times.</li>
            <li>Scan this QR. The phone downloads the app and enrols it as Device Owner.</li>
            <li>No Google account and no lock PIN may exist before scanning.</li>
          </ol>
        </div>
      )}
    </main>
  );
}
