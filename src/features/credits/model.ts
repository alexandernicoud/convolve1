/** Pure helpers for the server-side credit system (no React, no fetch). */

export type CreditsMode = "off" | "enforce";

/** Price of the tool's default configuration, plus the policy's formula and bounds. */
export type RunCost = { tool: string; label: string; credits: number; min?: number; max?: number; formula?: string };

/** Server price for one configuration (``app/pricing.py``). */
export type PriceQuote = {
  tool: string;
  credits: number;
  /** "fixed": exact. "estimated": an input (e.g. dataset size) was unknown; priced exactly on submit. */
  kind: "fixed" | "estimated";
  version: string;
  label: string;
  formula: string;
  lines: { label: string; value: string | number }[];
  bounds: [number, number];
  clamped: boolean;
  confirm: boolean;
};

export type QuoteResponse = {
  tool: string;
  cost: number;
  mode: CreditsMode;
  balance: number | null;
  sufficient: boolean;
  confirm: boolean;
  pricing: PriceQuote;
};

/** Endpoints that start a priced run; the confirmed price and a request key ride along. */
const RUN_START_PATHS = [
  /^\/api\/labeling-optimizer\/run$/,
  /^\/api\/training-chart-generator\/run$/,
  /^\/trainer\/runs$/,
  /^\/trainer\/runs\/[^/]+\/analysis$/,
  /^\/trainer\/analysis\/standalone$/,
  /^\/runs\/backtester\/start$/,
  /^\/api\/backtests\/run$/,
  /^\/runs\/testdata\/start$/,
];

export function isRunStartPath(path: string): boolean {
  const bare = path.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  return RUN_START_PATHS.some((re) => re.test(bare));
}

/** Badge shown next to a price. Charging off is always stated, never implied. */
export function estimateBadge(mode: CreditsMode | null, quote: Pick<PriceQuote, "kind" | "credits"> | null): string {
  if (!quote || quote.credits <= 0) return "No charge";
  if (mode !== "enforce") return "Not charged in beta";
  return quote.kind === "fixed" ? "Fixed price" : "Estimate";
}

/**
 * Whether to ask before starting. Charging on: large runs or runs using most of the balance.
 * Charging off: only very large runs, so the user sees the compute size before committing.
 */
export function needsRunConfirmation(q: Pick<QuoteResponse, "mode" | "confirm" | "pricing">): boolean {
  return q.mode === "enforce" ? q.confirm : Boolean(q.pricing?.confirm);
}

export type PlanPrice = { amount: number; currency: string | null; interval: string | null } | null;
export type PlanCredits = { amount: number; cadence: "one_time" | "monthly" } | null;

export type Plan = {
  id: string;
  name: string;
  availability: "available" | "coming_soon" | "contact";
  summary: string;
  price: PlanPrice;
  credits: PlanCredits;
  features: string[];
};

export type PlanCatalogue = {
  charging_enabled: boolean;
  pricing_version?: string;
  plans: Plan[];
  default_plan_id: string;
  run_costs: RunCost[];
  billing_available: boolean;
};

export type LedgerEntry = {
  id: string;
  created_at: string | null;
  reason: "grant" | "allocation" | "charge" | "refund" | "adjustment" | string;
  delta: number;
  balance_after: number;
  tool: string | null;
  tool_label: string | null;
  run_id: string | null;
  note: string | null;
};

export type PlanState = {
  plan_id: string;
  name: string;
  status: string;
  source: string;
  current_period_start: string | null;
  current_period_end: string | null;
  credits: PlanCredits;
};

export type CreditSummary = {
  mode: CreditsMode;
  balance: number;
  plan: PlanState;
  totals: { allocated: number; consumed: number; charged: number; refunded: number };
  by_tool: { tool: string; label: string; credits: number; runs: number }[];
  daily: { date: string; credits: number }[];
  transactions: LedgerEntry[];
};

/** Tools the server does not charge (e.g. paper-bot deployment) cost 0. */
export function costFor(costs: Record<string, number>, tool: string): number {
  return costs[tool] ?? 0;
}

export function costMap(runCosts: RunCost[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of runCosts ?? []) out[c.tool] = c.credits;
  return out;
}

/** Blocks only when the server enforces credits and the known balance is short. */
export function shouldBlock(mode: CreditsMode | null, balance: number | null, cost: number): boolean {
  return mode === "enforce" && balance != null && cost > 0 && balance < cost;
}

export function describeCost(mode: CreditsMode | null, cost: number): string {
  if (cost <= 0) return "No credit charge";
  const unit = `${cost} credit${cost === 1 ? "" : "s"}`;
  return mode === "enforce" ? unit : `${unit} · not charged yet`;
}

/**
 * Price shown on a run button. Only ever a server quote: while it loads or when it is
 * unavailable the label says so instead of showing a number.
 */
export function runButtonCost(quote: Pick<QuoteResponse, "cost" | "pricing"> | null, loading: boolean): string {
  if (loading) return "calculating cost…";
  if (!quote) return "cost unavailable";
  if (quote.cost <= 0) return "no charge";
  return `${quote.pricing.kind === "estimated" ? "est. " : ""}${creditsUnit(quote.cost)}`;
}

export function creditsUnit(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}

export const REASON_LABELS: Record<string, string> = {
  grant: "Starter allocation",
  allocation: "Plan allocation",
  charge: "Run",
  refund: "Refund",
  adjustment: "Adjustment",
};

export function formatPrice(price: PlanPrice): string | null {
  if (!price) return null;
  if (price.amount === 0) return "Free";
  if (!price.currency) return null;
  const n = new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency, maximumFractionDigits: 2 }).format(
    price.amount,
  );
  return price.interval ? `${n} / ${price.interval}` : n;
}

export function describePlanCredits(credits: PlanCredits): string | null {
  if (!credits) return null;
  return credits.cadence === "monthly" ? `${credits.amount} credits every month` : `${credits.amount} credits to start`;
}
