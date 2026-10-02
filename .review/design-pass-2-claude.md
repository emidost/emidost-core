# Design pass 2 — portal half (claude) — decisions + evidence

## Skill material consumed (new this pass)

- `taste-skill/README.md` + `skills/taste-skill/SKILL.md` (v2): design read →
  three dials (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY), hard rules
  (reduced-motion mandatory, no pure #000/#FFF, transform/opacity only, one
  easing family 150-250ms, full state cycles, contrast checks, CTA wrap ban,
  no em dashes, form contrast, one theme per page).
- `taste-skill/skills/redesign-skill/SKILL.md`: audit-first upgrade protocol
  (typography presence, tabular numbers, hover/active states, skeleton
  loaders, empty/error states, skip-to-content, no dead links, sentence case).
- `emilkowalski-skills/skills/emil-design-eng/SKILL.md`: animation decision
  framework (never animate high-frequency actions; hover/press = feedback;
  specify exact transition properties; active scale for physical push).
- `headroom/`: skimmed — it is a context-compression proxy, not a UI skill;
  no portal-applicable principles beyond "measure before optimizing" (noted,
  not applied to CSS).

## Design read

"Reading this as: trust-first B2B operations dashboard for phone retailers
and the owner, with a premium-restraint language (Ink #0F141C / Paper #F4F1EA
/ Paper-2 #FBF9F4 / Ink-2 #161D29, hairline borders, three product accents),
leaning toward native CSS + the existing class system."

## Taste dials chosen

- DESIGN_VARIANCE: 4 (predictable 8px-grid layouts; one asymmetrical move:
  the Ink dashboard hero band; everything collapses to single column <900px).
- MOTION_INTENSITY: 3 (hover/press feedback + one entrance family only;
  `--dur-interact: 180ms` everywhere; `prefers-reduced-motion` kills all).
- VISUAL_DENSITY: 4 (airy cards, 44px table rows, generous section rhythm).

Font stays Inter: the project's own DESIGN_SPEC §1 mandates it, and the
taste-skill allows Inter for accessibility-first product UI.

## Page-by-page before → after (no screenshots possible)

| Page | Before | After |
|---|---|---|
| globals.css | mixed durations (150/240ms), 20px card padding, 14px grid gaps, row hover on ALL tables | `--dur-interact: 180ms` single interactive duration; cards 24px padding; all grids 16px gaps; row hover only via `.table-actions`; `.skip-link`; `main.page:focus-visible` outline removed for skip target; login/band utilities |
| Login | inline maxWidth 360, `12vh` margin, ShieldCheck row | `.login-main` min-height 100dvh grid-center with a FLAT Ink top band (0–44%) behind the brand area; `.login-card` 384px/32px padding; 24px wordmark; 64px mark; Paper band below (body). Card straddles the band edge with hairline |
| Dashboard | Paper hero + 4 Paper stat cards, all Paper | Ink `.dash-band` (radius 16, hairline) holding the hero (34px title in Paper-1 text) + the 4 stat cards inverted to Ink-2 surface with Paper text; steps + quick actions stay Paper cards below |
| Retailers | Paper title, Paper card rows | Ink `band-title` header band (teal icon accent), Paper-2 card rows unchanged; table marked actionable (hover restored here only) |
| Devices (owner) | same | Ink `band-title` band; actionable table hover |
| Audit | no loading, no empty state | Ink `band-title` band; 3-row skeleton while loading; composed empty state ("No activity yet. Every action lands here."); no row hover (read-only) |
| QR | Paper page, Paper cards | Ink `.qr-band` (radius 16) behind the input card + generated QR card; inputs/buttons/labels adapted to Ink-2 surfaces; error text `#fca5a5` on Ink; QR `<ol>` uses locked-text-mid |
| Console dashboard | no loading state (shows 0s while loading) | skeleton cells in the 3 stat cards + credits line until data lands; console-page inversion applied |
| Console customers / new / detail / devices | Paper bg + Paper-2 cards (same as owner side) | INVERTED: `.console-page` panel = Paper-2 surface with Paper cards inside (the delta's "Paper-2 bg with Paper cards"); detail keeps escalation card; actionable tables hover |
| All pages | no skip target | every `<main>` gains `id="main" tabIndex={-1}`; layout nav gains the visually-hidden `.skip-link` ("Skip to content") |
| 404 | Next default | branded `web/app/not-found.tsx`: mark + "This page does not exist" + verb-first "Back to the portal" |
| DESIGN_SPEC §4 / CONTEXT §7 | claims unlock-confetti, SIM shake, payment tick-up, heartbeat ripple as shipped | rewritten: only the lock-engage breathing ring ships; the rest are spec-only, not implemented (codex's animation verdict) |

## Section-band map (delta, recorded)

- Login: Ink band (0–44%) behind brand/card, Paper below.
- Dashboard: Ink hero band (title + stats), Paper-2 steps/quick cards below.
- Retailers / Devices (owner) / Audit: Paper page, Ink header band, Paper-2 card rows.
- Console ×5: Paper-2 panel with Paper cards (inverted).
- QR: Ink band behind the QR cards.
- Palette locked to Ink #0F141C / Paper #F4F1EA / Paper-2 #FBF9F4 / Ink-2 #161D29; no #fff/#000 anywhere; hairlines on every band; focus/contrast/reduced-motion rules unchanged.

## Accessibility + copy verification this pass

- Skip link added (first tab stop, focus-visible reveals it).
- Focus rings already global; `main.page:focus-visible { outline: none }` so
  the skip target does not paint a ring.
- Contrast: body 14.6:1; text-mid 6.2:1; error-on-Ink uses `#fca5a5` (AA on Ink).
- Banned words / em dashes: grep over web/app returned zero hits (re-checked).
- Buttons: all labels one line, verb-first, 44px targets, icons with aria-hidden + text labels.

## Verification

- `npx tsc --noEmit -p web/tsconfig.json` → exit 0.
- `npx next build` → exit 0 (14 routes + not-found).
- `node --test packages/shared/src/*.test.mjs` untouched this pass (out of scope).
