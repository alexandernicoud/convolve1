/** Pure helpers for the server-side credit system (no React, no fetch). */

export type CreditsMode = "off" | "enforce";

export type RunCost = { tool: string; label: string; credits: number };

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
