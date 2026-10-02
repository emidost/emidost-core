/**
 * Expo/FCM push acceleration — WAKE-ONLY kick.
 *
 * The push message is a data-only `{ type: 'kick' }` payload with no command
 * content. The phone still fetches the real command through its authenticated
 * heartbeat, so Supabase stays the single source of truth and a forged push
 * can at most trigger one extra poll. Polling + SMS remain the fallback
 * layers; this function is a best-effort accelerator and NEVER throws.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendKick(fcmToken: string): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.EXPO_PUSH_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`;
    }
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      // Data-only message: no title/body, so no notification UI is rendered.
      // ttl 60 s keeps a stale kick from arriving long after the poll covered it.
      body: JSON.stringify([{ to: fcmToken, ttl: 60, priority: 'high', data: { type: 'kick' } }]),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `expo ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'push send failed' };
  } finally {
    clearTimeout(timer);
  }
}
