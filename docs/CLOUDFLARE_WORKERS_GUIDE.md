# Cloudflare Workers — setup guide and migration plan

STATUS (2026-10-02; updated 2026-10-03): DONE, optional.
- API Worker LIVE: https://emidost-api.financebuddy144.workers.dev (smoke-tested:
  health 200, register 400, heartbeat 401). It reuses web/lib/apiHandlers
  verbatim, so it picks up every web fix on the next `wrangler deploy`.
- Landing LIVE: https://emidost-landing.pages.dev
- Portal stays on Vercel (dashboard UI only); a custom domain will be bought
  later for the landing and mapped in Cloudflare (Pages -> Custom domains).
- Apps: the canonical default today is the Vercel API
  (`EXPO_PUBLIC_API_URL=https://emidost-pd8s.vercel.app`, verified live
  2026-10-03, matches CONTEXT.md + BUILD_AND_DEPLOY_STEPS.md). The Worker is the
  optional zero-cost swap: set
  `EXPO_PUBLIC_API_URL=https://emidost-api.financebuddy144.workers.dev` and
  redeploy the Worker first so both hosts run the same handlers.

Why: Cloudflare Workers free tier is commercial-safe and gives 100,000
requests/day. Our 2-hour device poll (12 req/device/day) means 2,000 phones ≈
24,000 requests/day, which fits with headroom. Vercel Hobby is non-commercial,
so this move makes the API legitimate for the business at zero cost.

## Part 1 — Setup guide (one time)

1. Create a Cloudflare account (free). Add your domain if you want
   `api.emidost.in`; otherwise use the workers.dev subdomain.
2. Install wrangler: `npm i -D wrangler` in `workers/`.
3. `workers/wrangler.toml`:
   ```toml
   name = "emidost-api"
   main = "src/index.ts"
   compatibility_date = "2026-10-02"
   ```
4. Secrets (never in code):
   `wrangler secret put SUPABASE_URL`
   `wrangler secret put SUPABASE_ANON_KEY`
   `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
   `wrangler secret put TOTP_ENC_KEY`
5. Deploy: `npx wrangler deploy`.
6. Landing page → Cloudflare Pages (unlimited free static): Pages → import the
   `emidost/emidost` repo → build command `npm run build` → output `.next` is
   NOT supported on Pages; use the static export instead (see Part 2 note) or
   keep the landing on Vercel/Netlify.
7. Point the apps at the Worker: set `EXPO_PUBLIC_API_URL` to the Worker URL
   (`https://emidost-api.<your-subdomain>.workers.dev`) in all three app `.env`
   files + the EAS global env.

## Part 2 — Implementation plan (what changes where)

### 2.1 New folder: `workers/`
- `package.json` (typescript, wrangler, hono or a hand-rolled router; supabase-js).
- `src/index.ts`: one fetch handler with the SAME dispatch table as
  `web/app/api/[[...slug]]/route.ts` (route path → handler). Port the table
  verbatim; the URL paths stay identical, so the apps and portal need no
  route changes.
- `src/adapters.ts`: a `WorkerRequest` shim exposing the pieces the handlers
  use: `nextUrl.searchParams` (parse from `request.url`), `headers`, `json()`.
  `requireActor` changes from cookie-based to **Bearer JWT**: the portal sends
  `Authorization: Bearer <supabase access_token>`; the Worker verifies via
  `supabase.auth.getUser(token)` and then reads `profiles` live (same
  suspension re-check as today).

### 2.2 Reuse without rewriting
- All of `web/lib/apiHandlers/*.ts` move (or are imported) into the Worker
  bundle unchanged except: `NextRequest` → the shim, and `requireActor`
  (cookie → bearer). The business logic (RLS checks, settled guards, atomic
  token consumption, allowance debit, TOTP, rate limit call) stays identical.
- `web/lib/rateLimit.ts` (in-memory) is NOT shared across Worker isolates.
  Replace with the Worker-native solution in this order:
  1. Cloudflare WAF rate-limit rule on the API route (free plan allows one
     rule; per-IP, coarse) for abuse protection.
  2. Later, Upstash Redis free (`@upstash/ratelimit`) for per-key sliding
     windows — one extra HTTP call per request on write paths only.

### 2.3 Portal changes (small)
- The portal keeps its Next.js UI (it is a dashboard, fine on Vercel or
  Netlify). Its fetches gain an `Authorization: Bearer` header from the
  supabase session (one helper: `getToken()` already exists in
  `packages/shared`'s client).
- `NEXT_PUBLIC_API_URL`-style env points the portal's serverless proxy at the
  Worker; or the portal calls the Worker directly from the browser.

### 2.4 Landing on Cloudflare Pages
- The landing is client-rendered; export it statically (`output: 'export'` in
  `next.config.js` of `emidost2`) → Pages serves it free and unlimited.

## Part 3 — Cutover checklist

1. Deploy the Worker; run the route-parity smoke test (hit every route once:
   health, retailers, devices, heartbeat with a test token, register, ack).
2. Point ONE test device's `EXPO_PUBLIC_API_URL` at the Worker; verify lock/
   unlock/location over 24 h.
3. Switch the portal's API base to the Worker; verify the owner + retailer
   consoles.
4. Update the three app `.env` files + EAS global env to the Worker URL;
   rebuild the APKs (customer first, per the standing rule).
5. Keep Vercel/Netlify for the portal UI only; delete the API from Vercel so
   the function-invocation budget goes to zero.

## Part 4 — What stays exactly as it is

- Supabase (auth, DB, RLS) — untouched. All SQL (0000_all_in_one.sql) applies
  regardless of the API host.
- Device behavior: local enforcement, SMS channel, 2-hour poll, burst windows,
  on-demand location — untouched.
- All route URLs — unchanged, so nothing else in the system needs to know the
  API moved.

## Risks

- Worker CPU limit (10 ms free) — our handlers are mostly I/O waits, fine, but
  benchmark the heartbeat under load.
- supabase-js on Workers: works; pin the version and test auth.getUser(token).
- Cold starts: negligible for 24k/day.
- Rollback: the apps read the URL from env — flip `EXPO_PUBLIC_API_URL` back to
  the Vercel/Netlify endpoint and redeploy the app to roll back (keep both
  deployed during the pilot).
