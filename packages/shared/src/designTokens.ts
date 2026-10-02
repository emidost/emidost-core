// Emidost design tokens — the single source of truth for color, type, spacing,
// radius and motion. Mirrors docs/DESIGN_SPEC.md sections 1 and 4.
//
// Web consumes these as CSS custom properties (see web/app/globals.css, kept in
// sync by hand). React Native consumes the same values directly as StyleSheet
// constants. The module stays free of DOM-only types so it type-checks under the
// apps' ES2020 lib as well as the web DOM lib.

/**
 * Surface ramps (premium redesign). Ink = dark/locked (never #000);
 * Paper = light/free (never #FFF). Cards sit one step above their ground.
 */
export const ink = {
  bg: '#0F141C',
  card: '#161D29',
  cardHi: '#1D2634',
  hairline: 'rgba(244, 241, 234, 0.14)',
  textHi: '#F4F1EA',
  textMid: '#A6AEBE',
  textLow: '#6C7686',
} as const;

export const paper = {
  bg: '#F4F1EA',
  card: '#FBF9F4',
  hairline: 'rgba(15, 20, 28, 0.12)',
  textHi: '#1A1D21',
  textMid: '#6B7280',
  textLow: '#9CA3AF',
} as const;

/** Light surface roles (portal web, retailer/owner apps, unlocked device cards). */
export const colors = {
  bg: paper.bg,
  surface: paper.card,
  surfaceHi: '#ECE8DE',
  border: paper.hairline,
  textHi: paper.textHi,
  textMid: paper.textMid,
  textLow: paper.textLow,
  accentIndigo: '#4F46E5',
  accentTeal: '#0D9488',
  accentAmber: '#D97706',
  indigoSoft: '#ECEFFB',
  tealSoft: '#E9F5F2',
  amberSoft: '#FBF1E2',
  danger: '#DC2626',
  success: '#16A34A',
  onAccent: '#F4F1EA',
} as const;

/**
 * Dark = locked roles (the Ink ramp). Dark surface means locked or restricted.
 * Used by the customer lock screen and locked device cards.
 */
export const locked = {
  bg: ink.bg,
  surface: ink.card,
  surfaceHi: ink.cardHi,
  border: ink.hairline,
  textHi: ink.textHi,
  textMid: ink.textMid,
  textLow: ink.textLow,
  ring: '#FBBF24',
  amber: '#D97706',
  amberHi: '#F59E0B',
  danger: '#F87171',
} as const;

/**
 * Gradient pairs. Allowed only in rings, hero art and progress strokes.
 * Never used as a button fill (see spec section 7).
 */
export const gradients = {
  indigo: ['#4F46E5', '#818CF8'],
  teal: ['#0D9488', '#2DD4BF'],
  amber: ['#D97706', '#FBBF24'],
} as const;

/** Status dot colors, keyed to the status language in spec section 3. */
export const statusColors = {
  PENDING: colors.textLow,
  ENROLLED: colors.accentIndigo,
  ACTIVE: colors.accentTeal,
  GRACE: colors.accentAmber,
  OVERDUE: colors.danger,
  SUSPENDED: colors.textMid,
  SETTLED: '#16A34A',
  RELEASED: colors.accentIndigo,
} as const;

export type StatusKey = keyof typeof statusColors;

/** Type scale. Inter, single family, weights 400/500/600/700. */
export const typography = {
  family: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  /** Web ramp: caption/table/body/H3/H2/H1/hero. */
  web: { caption: 12, table: 13, body: 14, h3: 16, h2: 20, h1: 24, hero: 40 },
  /** Mobile ramp. */
  mobile: { caption: 12, body: 15, subtitle: 17, title: 22, display: 34 },
  /** Lock-screen amount, spec section 5. */
  lockAmount: 96,
  tabularFeature: 'tabular-nums' as const,
} as const;

/** 4px spacing scale. */
export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64,
} as const;

/** Corner radii per surface. */
export const radius = {
  web: 8,
  mobile: 12,
  landing: 16,
  landingSm: 12,
  pill: 999,
} as const;

/** Elevation is none except the sticky nav. */
export const elevation = {
  none: 'none',
  stickyNav: '0 1px 0 rgba(17, 20, 24, 0.06)',
} as const;

/** Motion durations in milliseconds (spec section 1). */
export const duration = {
  xs: 80,
  sm: 150,
  md: 240,
  lg: 400,
  xl: 600,
  settle: 900,
} as const;

/** Easing curves (spec section 1). */
export const easing = {
  entrance: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  emphasized: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

/** Snap spring (dense UI press feedback). */
export const spring = { stiffness: 400, damping: 28, durationMs: 400 } as const;

/** Ambient loop timings. All loops are transform/opacity only, capped at 3 per screen. */
export const loop = {
  minMs: 3000,
  maxMs: 6000,
  breathingMs: 3000,
  heartbeatMs: 2000,
  rippleMs: 1000,
  lockpulseMs: 6000,
  maxPerScreen: 3,
} as const;

export const motion = { duration, easing, spring, loop } as const;

/**
 * Reduced-motion flag. True when the environment reports a preference to reduce
 * motion. On the web this reads the `prefers-reduced-motion` media query; in
 * other runtimes (React Native, SSR) it returns false and callers should fall
 * back to a platform check (for example AccessibilityInfo on native).
 */
export function prefersReducedMotion(): boolean {
  const g = globalThis as {
    matchMedia?: (query: string) => { matches: boolean };
  };
  if (typeof g.matchMedia === 'function') {
    try {
      return g.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Resolve an animation duration against a reduced-motion preference. Under
 * reduced motion, non-fade durations collapse to 0 and opacity fades are capped
 * at 150ms (spec section 4).
 */
export function resolveDuration(
  ms: number,
  opts: { fade?: boolean; reduced?: boolean } = {},
): number {
  const reduced = opts.reduced ?? prefersReducedMotion();
  if (!reduced) return ms;
  return opts.fade ? Math.min(ms, duration.sm) : 0;
}

/** Pick a value based on the reduced-motion preference. */
export function withReducedMotion<T>(normal: T, reduced: T, prefersReduced = prefersReducedMotion()): T {
  return prefersReduced ? reduced : normal;
}

/** Aggregate token object, convenient for a single import. */
export const designTokens = {
  colors,
  ink,
  paper,
  locked,
  gradients,
  statusColors,
  typography,
  space,
  radius,
  elevation,
  motion,
} as const;

export type DesignTokens = typeof designTokens;
