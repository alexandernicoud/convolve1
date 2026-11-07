/**
 * Search metadata for public routes. Used at runtime (RouteSeo) and at build time (vite.config.ts
 * writes one HTML file per route with this head, so crawlers get it without running JavaScript).
 * No imports: the Vite config loads this file directly.
 */

export const SITE_URL = "https://www.we-convolve.com";
export const SITE_NAME = "Convolve";
export const OG_IMAGE = `${SITE_URL}/og-image.png`;
export const OG_IMAGE_ALT = "Convolve — chart-based neural nets for markets";

/** Official public profiles that identify Convolve / its operator. Only real profiles — never placeholders. */
export const OFFICIAL_PROFILES = [
  "https://www.linkedin.com/in/alexander-nicoud-11a707398/",
] as const;

export type RouteMeta = {
  path: string;
  title: string;
  description: string;
  /** Static head file name in the build (`/seo/<file>.html`); the home page is index.html itself. */
  file?: string;
  changefreq?: "weekly" | "monthly" | "yearly";
  priority?: number;
};

export const PUBLIC_ROUTES: RouteMeta[] = [
  {
    path: "/",
    title: "Convolve — Build & Backtest AI Trading Models",
    description:
      "Convolve is a research workspace for training neural networks on candlestick charts, inspecting what they learn, and backtesting trading strategies on unseen data.",
    changefreq: "weekly",
    priority: 1,
  },
  {
    path: "/products",
    file: "products",
    title: "Products — Chart Datasets, CNN Training & Backtesting | Convolve",
    description:
      "Generate labelled candlestick chart datasets, train CNN trading models, inspect what they learn with Grad-CAM and filter views, and backtest them on unseen data.",
    changefreq: "weekly",
    priority: 0.9,
  },
  {
    path: "/about",
    file: "about",
    title: "About Convolve — Visual Quantitative Research",
    description:
      "Why Convolve exists: a research platform for training computer-vision models on price charts and making what they learn visible and testable.",
    changefreq: "monthly",
    priority: 0.7,
  },
  {
    path: "/help",
    file: "help",
    title: "Help & Guides — Datasets, Training, Analysis, Backtests | Convolve",
    description:
      "How to generate chart datasets, train CNN models, read Grad-CAM and filter analyses, and backtest strategies in Convolve, with answers to common questions.",
    changefreq: "monthly",
    priority: 0.6,
  },
  {
    path: "/contact",
    file: "contact",
    title: "Contact Convolve",
    description: "Questions about Convolve, research collaborations, partnerships or support: send us a message.",
    changefreq: "yearly",
    priority: 0.5,
  },
  {
    path: "/signup",
    file: "signup",
    title: "Create your account | Convolve",
    description: "Create a Convolve account to build, train and backtest AI trading models on candlestick charts.",
    changefreq: "yearly",
    priority: 0.5,
  },
  { path: "/privacy", file: "privacy", title: "Privacy Policy | Convolve", description: "How Convolve collects, uses and protects personal data, and the rights you have.", changefreq: "yearly", priority: 0.2 },
  { path: "/terms", file: "terms", title: "Terms of Service | Convolve", description: "The terms that govern the use of Convolve.", changefreq: "yearly", priority: 0.2 },
  { path: "/subscription-terms", file: "subscription-terms", title: "Subscription Terms | Convolve", description: "Terms for Convolve subscriptions and credit purchases.", changefreq: "yearly", priority: 0.2 },
  { path: "/refunds", file: "refunds", title: "Refund Policy | Convolve", description: "When and how Convolve refunds subscriptions and credits.", changefreq: "yearly", priority: 0.2 },
  { path: "/risk-disclosure", file: "risk-disclosure", title: "Risk Disclosure | Convolve", description: "Risks of trading and of relying on model research and backtests. Convolve does not give investment advice.", changefreq: "yearly", priority: 0.2 },
  { path: "/cookies", file: "cookies", title: "Cookie Policy | Convolve", description: "Which cookies and local storage Convolve uses and why.", changefreq: "yearly", priority: 0.2 },
  { path: "/legal", file: "legal", title: "Legal Notice | Convolve", description: "Legal notice and operator information for Convolve.", changefreq: "yearly", priority: 0.2 },
];

/** Signed-in areas, auth flows, alternate drafts and placeholders: never indexed. */
export const NOINDEX_PREFIXES = [
  "/dashboard",
  "/account",
  "/tools",
  "/products/",
  "/auth",
  "/credits",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/vision",
  "/home3",
  "/docs",
];

export function routeMeta(pathname: string): RouteMeta | null {
  const bare = pathname.replace(/\/+$/, "") || "/";
  return PUBLIC_ROUTES.find((r) => r.path === bare) ?? null;
}

export function isNoindex(pathname: string): boolean {
  return NOINDEX_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}
