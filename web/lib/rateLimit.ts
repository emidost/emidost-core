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
