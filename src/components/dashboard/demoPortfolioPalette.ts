/**
 * Dashboard **demo** only — neutral greys (matches main dashboard vibe, no violet/pink accents).
 */
export const DEMO_ACCENT = {
  purple: "#8c8c8c",
  pink: "#6f6f6f",
  whiteLine: "#d6d6d6",
  barUp: "#a0a0a0",
  barDown: "rgba(130, 130, 130, 0.32)",
} as const;

export const DEMO_PORTFOLIO_LINE_COLORS = [
  DEMO_ACCENT.whiteLine,
  DEMO_ACCENT.purple,
  DEMO_ACCENT.pink,
] as const;

export const DEMO_PORTFOLIO = {
  primary: DEMO_ACCENT.purple,
  secondary: DEMO_ACCENT.pink,
  tertiary: DEMO_ACCENT.whiteLine,
} as const;

export const demoLinkClass = "text-white/65 transition-colors hover:text-white/95";
