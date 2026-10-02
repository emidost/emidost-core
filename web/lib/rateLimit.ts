// Lightweight in-memory rate limiter for device-facing endpoints.
// One window per key (IP + installation); production can swap this for a
// shared store (Upstash) without changing call sites.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      // Coarse cleanup: drop the oldest bucket instead of unbounded growth.
      const first = buckets.keys().next().value;
      if (first) buckets.delete(first);
    }
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

export function deviceRateKey(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  const installation = new URL(req.url).searchParams.get('installation_id') ?? '';
  return `${ip}:${installation}`;
}

/**
 * Cross-instance limiter: one atomic hit-counter in Supabase, shared by the
 * Worker and Vercel lambdas. Fails open when the DB is unreachable (the local
 * limiter above still runs first). Uses the service-role key.
 */
let svcClient: any = null;
export async function sharedRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    if (!svcClient) {
      const { createClient } = await import('@supabase/supabase-js');
      svcClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        { auth: { persistSession: false } },
      );
    }
    const { data, error } = await svcClient.rpc('rate_limit_hit', {
      k: `api:${key}`, lim: limit, win_ms: windowMs,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}
