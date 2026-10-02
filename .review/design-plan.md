# Premium redesign plan (lead decision, 2026-10-03)

Tools: biswodip-design-review skill (12-step pipeline) + taste-skill +
no-ai-slop + agent-reach (installed at .biswodip/upstream/agent-reach, used for
real-content fetching). User requirements: premium UI for portal + all apps +
landing, NO pure white or pure black backgrounds, proper icons everywhere,
no-ai-slop copy on every string, easier app options, fresh design (no "AI
feel"), push both repos.

## Design language (one direction, from the product)

- Surfaces: "Ink" #0F141C (deep navy-charcoal, never #000) for dark/locked;
  "Paper" #F4F1EA (warm ivory, never #FFF) for light/free. Cards: #161D29 on
  ink, #FBF9F4 on paper. Hairline borders at 12-15% ink/white.
- Role accents stay (they ARE the product identity): indigo #4F46E5 owner,
  teal #0D9488 retailer, amber #D97706 customer. No new gradients beyond the
  documented signature animations.
- Premium = restraint: larger display type, more whitespace, 1px hairlines,
  icons on every control (Lucide, aria-labels), 40px+ touch targets in apps.
- Motion: transform/opacity only, reduced-motion respected; only the honest
  product-fact animations stay (lock engage, capped unlock confetti, SIM
  shake, heartbeat ripple, landing locked→paid cycle).
- Copy: no-ai-slop (banned-word list, no em dashes in UI copy, sentence case,
  verb-first buttons, concrete numbers). Every string ships through it.
- Every interactive element gets real loading/empty/error/success states.
- Imagery rule: only product facts. Landing uses CSS-drawn phone mockups of
  the REAL lock screen and portal, not stock photos or fake people.

## Scopes (disjoint)

- claude: web/ portal (globals.css, all pages, components, copy, states,
  accessibility, contrast).
- codex: apps/customer, apps/retailer, apps/owner + packages/shared
  (designTokens.ts, copy.ts, inline strings), icons, quick actions.
- lead: landing D:\emidost2 full redesign (single page.tsx + globals.css),
  agent-reach usage, verification, commits + pushes to BOTH repos
  (emidost-core + emidost landing).

## Gates

All tsc surfaces + 13/13 tests + next build (web + landing) green after the
wave; design-review exit gate checks recorded in checksum.md.
