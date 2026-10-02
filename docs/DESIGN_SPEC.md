# Emidost Design Spec — final (merged from the 5-competitor arena + judge)

## 1 · Tokens
- Color roles: bg, surface, surface-hi, border, text-hi, text-mid, text-low, accent-indigo #4F46E5, accent-teal #0D9488, accent-amber #D97706, danger, on-accent. Gradient pairs (indigo→#818CF8, teal→#2DD4BF, amber→#FBBF24) allowed only in rings/hero/progress strokes, never button fills.
- Dark = locked rule: dark surface = locked/restricted; light = free/released. Locked device cards render dark with an amber breathing ring; unlocked/paid render light. Lock screen contrast ≥7:1.
- Type: Inter, single family, 400/500/600/700; tabular-nums for money/IMEI/dates. Web ramp 12/13/14/16/20/24/40 (caption/table/body/H3/H2/H1/hero). Mobile ramp 12/15/17/22/34.
- Spacing/radius/elevation: 4px spacing scale; radius 8 web, 12 mobile, 12–16 landing; elevation none except sticky nav.
- Motion tokens: durations xs 80 / sm 150 / md 240 / lg 400 / xl 600 / settle 900 ms; easings entr cubic-bezier(0,0,0.2,1), exit (0.4,0,1,1), std (0.4,0,0.2,1), emph (0.2,0.8,0.2,1), snap spring 400ms/28; ambient loops 3–6s.
- Source: tokens.ts → CSS vars (web) + RN constants; shared reduced-motion flag.

## 2 · Components
- Buttons (3): primary solid accent fill, secondary outline, destructive solid danger; height 44 web / 48 mobile, radius per surface, press scale 0.98 std ease; 2px indigo focus ring.
- Status chip: colored dot + label text only, no icon inside; filter/action chips = outline style.
- Cards: flat stat card = surface bg + 16px padding, no shadow; device board = mini phone cards obeying dark=locked.
- Table: 40px rows, 13px tabular nums, sticky header, hover row tint (web); skeleton only in tbody.
- Input: 1px border, 44/48px height, 2px indigo focus ring, error = danger border + inline message.
- Empty state: Lucide icon + one sentence + one button; icons replace only universal glyphs, with aria-label.
- Skeleton: table body only; static surface-hi blocks pulsing opacity, no shimmer.

## 3 · Status language
| State | Dot | Icon | One sentence |
|---|---|---|---|
| PENDING | gray | clock | Loan application received; financing decision pending. |
| ENROLLED | indigo | smartphone | Financing approved; awaiting in-store activation. |
| ACTIVE | teal | shield-check | Loan active and payments are on time. |
| GRACE | amber | hourglass | Payment window open; no lock applied yet. |
| OVERDUE | danger | lock | Payment missed; phone locked until payment completes. |
| SUSPENDED | gray | pause-circle | Owner suspension in force; contact retailer. |
| SETTLED | green | check-circle | Loan fully paid; ownership transferred. |
| RELEASED | indigo | unlock | Owner-released (refund/dispute/support); no balance due. |

Server state is the only truth; never cache green.

## 4 · Signature animations
- Lock engage: padlock scale 1→0.96 + shackle close, 240ms std, zero overshoot; card flips to dark 400ms entr; amber breathing ring loop 3s (scale 1→1.04, opacity 0.5→0.2).
- Unlock celebration: single expanding ring 600ms emph + confetti capped at 20 particles, one run; card flips to light, settle 900ms.
- SIM alert: card shake ±4px ×3 over 500ms; ripple ring 1Hz loop, ≤3 loops.
- Payment: checkmark stroke-dash draw 400ms emph; amount ticks up 600ms std, tabular nums.
- Enrolment rail: animate only the delta; new step 16px slide + fade 240ms entr.
- Heartbeat: sync-dot ripple 2000ms loop, transform/opacity only.
- Landing keyframes: lockpulse (hero phone auto-cycle locked→paid, 6s), shieldscan, chipfloat with rotate, conic EMI progress ring (0→100% + tabular %).
- Engine: transform/opacity only; RN useNativeDriver everywhere; prefers-reduced-motion → loops off, durations 0, ≤150ms opacity fades; ≤3 loops/screen.

## 5 · Per-surface directives
- Portal (owner web, DV3/MI2/VD8): KPI chip row (flat cards, tabular nums) + device board mini cards with last-sync; wizard one step per screen, big ✓/✗ + TRY AGAIN, no auto-advance.
- Owner app (DV3/MI3/VD5): compact dashboard, same data truth; lock/unlock commands server-confirmed only.
- Retailer app (DV3/MI3/VD5): enrolment wizard (one step per screen), store-scoped device board, SIM alert + heartbeat states.
- Customer app (DV3/MI3/VD5): lock screen = dark surface, amber breathing ring; 96px amount top (tabular, ≥7:1); PAY NOW (solid amber), CALL RETAILER (outline), 112 (link) all always live; no optimistic green; copy from the string sheet (en/bn/hi).
- Landing (DV6/MI5/VD4): headline "Sell phones on EMI. Get paid on time."; hero phone auto-cycles locked→paid 6s; trust section = 3 real quotes, plain 3 steps, verifiable strip.

## 6 · Copy (source of truth)
Lock screen (en): LOCKED "Pay Rs 2,400 to unlock your phone. The payment was due on 15 June. Call your retailer on 98000 00000 for help." · OVERDUE "Pay Rs 2,400 now. Your payment is 3 days overdue." · UNLOCKED "Payment received on 16 June. Your phone stays unlocked until 15 July." · PAID "Loan complete. Your phone is yours." (bn/hi equivalents in the copy planner's sheet.)
Reminders (en): −3 "Rs 2,400 is due on 15 June." · −1 "Rs 2,400 is due tomorrow, 15 June." · 0 "Rs 2,400 is due today. Pay to keep your phone unlocked." · +1 "Pay Rs 2,400 to unlock your phone. The payment is 1 day overdue." · +3 "Pay Rs 2,400 to unlock your phone. The payment is 3 days overdue." (bn/hi spoken scripts in the sheet.)
Banned → replacement: "Simply tap"→"Tap"; "Seamless sync"→"The dashboard updates within a minute"; "Welcome to wifi"→"Your phone is enrolled"; "Not just a lock, but a safeguard"→"The phone locks on a missed payment"; "Just pay your EMI"→"Pay Rs 2,400 by 15 June"; no em/en dashes, sentence case, verb-first.

## 7 · Forbidden patterns
Generic loaders; motion that hides or delays information; humanizer violations (fake reviews/avatars/quotes); animating layout properties (width/height/top/left); JS-thread animation loops; bouncy springs on dense UI; cached/optimistic green lock states; hidden consent; lock claims not matching server Device Owner state; gradient buttons/glowing orbs; emoji headings; slogan triads + em dashes; gradient icon tiles; shimmer/skeleton walls; icons without text or aria-label; banned copy phrases in any surface or locale.

## 8 · Implementation order
1. tokens.ts → CSS vars + RN constants + reduced-motion hook. 2. Component kit. 3. Status model + chips + server-truth store. 4. Customer lock screen + app (en/bn/hi strings). 5. Portal dashboard + wizard; owner/retailer apps. 6. Landing + trust section. 7. Signature moments + landing keyframes; audit pass (contrast, reduced-motion, loop caps, copy bans, humanizer) then freeze spec.
