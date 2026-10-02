# emidost design pass 2 — codex notes (apps + shared half)

Date: 2026-10-03. Skills used: taste-skill v2 (brief inference, dials, hard rules,
pre-flight), soft-skill (whitespace, hierarchy, concentric radii — its web-only
font/icon bans deliberately NOT applied: the lead's established language keeps
Lucide + role accents as the product identity), emilkowalski review-animations
(ten non-negotiables), mobile-native (touch/reflow rules), headroom (perf).

## Design read + dials

Reading this as: trust-first financial operations app for retailer/owner staff,
plus a locked-phone screen for customers, with a premium-consumer language
already fixed by the lead (Ink/Paper, role accents, Lucide).

- DESIGN_VARIANCE: 4 — predictable, centered, single-column native lists
  (asymmetry would fight one-handed staff use).
- MOTION_INTENSITY: 3 — static UI + the four honest signature animations only;
  no entry/marquee/scroll choreography in a financial app.
- VISUAL_DENSITY: 4 — daily-app spacing, card-per-row lists with meta lines.

Per skill rules applied: shape consistency documented (cards 8, inputs 6-8,
buttons 8-12, pills 999 for chips, lock screen 12/36 concentric); one label per
intent per screen; buttons ≤3 words and never wrapping; full loading/empty/error
states; no pure #000/#fff; em-dash ban re-scanned; reduced-motion gated.

## Per-app changes (before → after)

### apps/retailer
- Customers list: added pull-to-refresh (RefreshControl wired to the existing
  reload), removeClippedSubviews, card-head icon row (UserPlus), empty state now
  says how to populate ("Add one from the New tab"), PaymentRow onDone lifted to
  a useCallback (kills per-render function churn on a list that re-renders on
  every payment/setup action).
- Devices list: same refresh + clipped views; card-head icon (Smartphone);
  quick-action row now has REAL disabled/busy states: one shared busyId disables
  Lock/Unlock ("Working…"), Offline code, and Alert ("Sending…") while a command
  is in flight — no more double-fire on slow networks; empty state gained
  guidance ("Enrol one from the Enrol tab").
- New customer photo card, unlock-code screen, wireless-enrol chain and Enrol
  tab were already pass-1 compliant; left unchanged except the shared styles.

### apps/owner
- Retailers: pull-to-refresh + removeClippedSubviews; suspend now busy-guarded
  (was the only unguarded mutation); Credits/Allowances inline Add/Set buttons
  disabled while busy with "Adding…"/"Setting…" labels; explicit
  accessibilityLabels on Suspend/Credits/Allowances; card-head icon (Store);
  empty state guidance added.
- Audit: pull-to-refresh + clipped views; empty state "Pull to refresh".

### apps/customer (LockedScreen — the priority screen)
- Explicit accessibilityLabels on Call retailer and Call 112 (were relying on
  child text only).
- Customer photo avatar now sits on the Ink surface with a hairline ring
  (transparent PNG regions no longer float on the raw background).
- Hierarchy verdict: amount (96 tabular) > ring emblem > message > amber primary
  (Pay now) > outlined secondary (Call retailer) > text link (Call 112) — kept;
  the pay button gained its PhoneCall icon in pass 1. Breathing ring kept as the
  only ambient loop (signature animation, reduced-motion collapses it to a
  static emblem). Unlock-code entry stays hidden behind the long-press.

### packages/shared
- No token changes this pass; the Ink/Paper ramps, hairlines, and the motion
  token families from pass 1 hold. designTokens.motion already carries the
  duration/easing families used by the animations below.

## Animation review (emilkowalski standards — verdict per signature animation)

1. Lock engage (breathing ring, LockedScreen): Animated.loop, scale 1→1.04 +
   opacity 0.5→0.2, 3000 ms cycle, easing inOut(ease), useNativeDriver:true,
   reduceMotion → static. Verdict: PASS. Justified (persistent locked-state
   indicator), transform/opacity only, native driver, reduced-motion honored.
   Note: the 3 s ambient cycle is exempt from the <300 ms UI rule (state
   indicator, not an interaction).
2. Unlock confetti: NOT implemented in the apps (never built). Verdict:
   HONEST ABSENCE — recorded, not faked; the unlocked transition is instant by
   design ("system responses snap", asymmetric enter/exit rule).
3. SIM shake: NOT implemented in app UI (the sentinel hard-locks natively; no
   UI shake exists). Verdict: HONEST ABSENCE — the lock itself is the feedback.
4. Heartbeat ripple: NOT implemented. Verdict: HONEST ABSENCE. Recommendation
   to the lead: drop these three from any "implemented" claim; the checklist
   should mark them Follow-up or delete the claim (docs are claude's scope).

No new animations were added this pass ("motion claimed, motion shown").

## Perf notes (headroom principles)

- Customer photo: single cached file:// URI, never re-downloaded per render;
  Image decodes once per URI (the temp-file + move pattern keeps the URI stable
  across updates, so no decode loop). Verified in sync.ts.
- FlatLists: removeClippedSubviews added to all four long lists (retailer
  customers/devices, owner retailers/audit); keyExtractor by id everywhere.
- Inline-function churn removed where trivial (Customers onDone useCallback;
  Devices/Retailers/Audit reload useCallback).
- Native poll/timers unchanged (single-flight, jittered) — no JS changes.

## Copy audit

Re-scanned every visible string in the three apps + copy.ts for em/en dashes and
the banned-word list (seamless/simply/just/robust/cutting-edge/effortless etc.):
zero violations outside the COPY_RULES rulebook. New Phase 9-10 strings
(photo card, alert button, wireless-enrol, overdue voice lines) pass sentence
case + verb-first + concrete numbers.

## Remaining honest gaps (unchanged)

Native overlay cover (Kotlin) still uses its legacy hexes; device-side
acceptance walks still pending; the four signature animations above are the
truth in code today: one shipped (ring), three absent.
