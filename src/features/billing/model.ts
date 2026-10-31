/** Pure helpers for subscriptions, credit packs and refunds (no React, no fetch). */

export type BillingMode = "off" | "sandbox" | "live";

export type Money = { amount_minor: number; currency: string; interval?: string; approved?: boolean; proposed_range_minor?: [number, number] };

export type Tier = {
  id: string;
  name: string;
  rank: number;
  availability: "available" | "hidden" | string;
  price: Money;
  monthly_credits: number;
  summary: string;
  features: string[];
  quotas: { backtests_per_period?: number | null; active_deployments?: number | null };
  limits: Record<string, number | string[] | null>;
  highlights: string[];
};

export type Pack = { id: string; name: string; credits: number; price: Money };

export type BillingCatalog = {
  version: string;
  mode: BillingMode;
  currency: string;
  tiers: Tier[];
  packs: Pack[];
  refunds: { voluntary_rate_bps: number; withdrawal_days: number };
  subscription: { credits_expire_at_period_end: boolean; past_due_grace_days: number };
  features: Record<string, string>;
  blocked_countries: string[];
};

export type SubscriptionState = {
  active: boolean;
  status: "active" | "canceled" | "past_due" | "expired" | "incomplete" | "none" | string;
  tier_id: string | null;
  subscribed_tier_id: string | null;
  pending_tier_id: string | null;
  period_start: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
  country: string | null;
  read_only: boolean;
  /** A free month (ambassador reward): not paid, never renews, nothing to cancel. */
  complimentary?: boolean;
};

export type Balances = {
  subscription: number;
  grant: number;
  purchase: number;
  legacy: number;
  total: number;
  reserved: number;
  subscription_expires_at: string | null;
};

export type Quota = { limit: number | null; used: number };

export type BillingState = {
  mode: BillingMode;
  provider: string | null;
  blocked_countries: string[];
  subscription: SubscriptionState;
  balances: Balances;
  entitlements: { features: string[]; limits: Record<string, unknown>; quotas: Record<string, Quota> };
  purchases: {
    id: string;
    item_id: string | null;
    credits_total: number;
    credits_remaining: number;
    credits_refunded: number;
    amount_minor: number | null;
    currency: string | null;
    created_at: string | null;
  }[];
};

export type RefundLine = {
  lot_id: string;
  item_id: string | null;
  purchased_at: string | null;
  credits_total: number;
  credits_unused: number;
  amount_paid_minor: number;
  currency: string;
  unused_value_minor: number;
  rate_bps: number;
  basis: "voluntary" | "statutory_withdrawal" | "statutory_override";
  refund_minor: number;
  retained_minor: number;
  capped: boolean;
  formula: string;
};

export type RefundQuote = {
  lots: RefundLine[];
  totals: { currency: string; refund_minor: number; retained_minor: number; unused_value_minor: number; credits: number }[];
  reserved_credits: number;
  voluntary_rate_bps: number;
  subscription: { active: boolean; tier_id: string | null; access_until: string | null };
};

export type RefundRecord = {
  id: string;
  request_id: string;
  status: "pending" | "succeeded" | "failed";
  credits: number;
  unused_value_minor: number;
  rate_bps: number;
  amount_minor: number;
  currency: string;
  basis: RefundLine["basis"];
  attempts: number;
  failure_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type BillingHistory = {
  payments: {
    id: string;
    kind: "subscription" | "topup";
    item_id: string;
    amount_minor: number;
    currency: string;
    refunded_minor: number;
    status: string;
    created_at: string | null;
  }[];
  refunds: RefundRecord[];
};

/** Error bodies the server returns when billing refuses an action. */
export type BillingBlock =
  | { code: "subscription_required"; message: string }
  | { code: "feature_locked"; message: string; feature: string; required_tier: string | null; required_tier_name: string | null }
  | {
      code: "quota_exceeded";
      message: string;
      quota: string;
      limit: number;
      used: number;
      upgrade_tier: string | null;
      upgrade_tier_name: string | null;
    }
  | { code: "country_restricted"; message: string };

const BLOCK_CODES = new Set(["subscription_required", "feature_locked", "quota_exceeded", "country_restricted"]);

export function asBillingBlock(detail: unknown): BillingBlock | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as { code?: unknown; message?: unknown };
  return typeof d.code === "string" && BLOCK_CODES.has(d.code) && typeof d.message === "string" ? (detail as BillingBlock) : null;
}

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
}

/** Integer minor units to a localized amount; never rounds (the server already did). */
export function formatMinor(amountMinor: number, currency: string, locale?: string): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(amountMinor / 10 ** exp);
}

export function formatTierPrice(price: Money, locale?: string): string {
  const n = formatMinor(price.amount_minor, price.currency, locale);
  return price.interval ? `${n} / ${price.interval}` : n;
}

export function percent(bps: number): string {
  return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export const BASIS_LABELS: Record<RefundLine["basis"], string> = {
  voluntary: "Voluntary refund",
  statutory_withdrawal: "Statutory withdrawal (full refund)",
  statutory_override: "Full refund required by law",
};

export const REFUND_STATUS_LABELS: Record<RefundRecord["status"], string> = {
  pending: "Processing",
  succeeded: "Refunded",
  failed: "Failed, credits restored",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  canceled: "Ends at period end",
  past_due: "Payment failed",
  expired: "Ended",
  incomplete: "Payment incomplete",
  none: "No subscription",
};

/** Reasons in the credit ledger added by billing. */
export const BILLING_REASON_LABELS: Record<string, string> = {
  subscription: "Monthly credits",
  purchase: "Credit pack",
  expiry: "Monthly credits expired",
  credit_refund: "Purchased credits refunded",
  credit_refund_reversal: "Refund failed, credits restored",
  chargeback: "Payment disputed",
  payment_refund: "Payment refunded",
  referral_reversal: "Invite reward withdrawn",
};

export function quotaLabel(name: string): string {
  return name === "backtests_per_period" ? "Backtests this period" : name === "active_deployments" ? "Active paper deployments" : name;
}

export function describeQuota(q: Quota): string {
  return q.limit == null ? `${q.used} (no limit)` : `${q.used} of ${q.limit}`;
}

export type TierLine = { label: string; included: boolean };

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The same rows, in the same order, for every tier, so plans compare line by line. */
export function tierLines(t: Tier): TierLine[] {
  const has = (f: string) => t.features.includes(f);
  const lim = (k: string) => t.limits?.[k];
  const symbols = lim("generator_max_symbols");
  const days = lim("optimizer_max_history_days");
  const backtests = t.quotas.backtests_per_period;
  const deployments = t.quotas.active_deployments;
  return [
    { label: `${plural(t.monthly_credits, "credit", "credits")} every month`, included: true },
    {
      label: typeof symbols === "number" ? `Dataset generation, up to ${plural(symbols, "asset", "assets")} per run` : "Dataset generation, any number of assets",
      included: true,
    },
    {
      label: has("optimizer.full") || typeof days !== "number" ? "Full Labeling Optimizer" : `Labeling Optimizer, up to ${Math.round(days / 365)} years of history`,
      included: true,
    },
    { label: Array.isArray(lim("architectures")) ? "Standard and compact CNNs" : "Every supported CNN architecture", included: true },
    { label: "Model statistics after every run", included: true },
    { label: "Grad-CAM and saliency on single charts", included: has("lab.basic") },
    { label: "Advanced training options", included: has("trainer.advanced") },
    { label: "Transfer learning from pretrained weights", included: has("trainer.transfer") },
    { label: "Feature maps, interventions and representation analysis", included: has("lab.advanced") },
    { label: "Detailed evaluations, model comparisons and exports", included: has("reports.advanced") },
    { label: backtests == null ? "Unlimited backtests" : `${plural(backtests, "backtest", "backtests")} per billing period`, included: true },
    {
      label: deployments == null ? "Unlimited paper deployments" : `${plural(deployments, "active paper deployment", "active paper deployments")}`,
      included: true,
    },
    { label: "Buy extra credits at any time", included: true },
  ];
}

export function tierById(catalog: Pick<BillingCatalog, "tiers"> | null | undefined, id: string | null | undefined): Tier | null {
  return catalog?.tiers.find((t) => t.id === id) ?? null;
}

/** Where a pricing button sends a signed-in visitor; signup returns there afterwards. */
export function planPath(tierId: string): string {
  return `/account?tab=plan&plan=${encodeURIComponent(tierId)}`;
}

export function signupForPlan(tierId: string): string {
  return `/signup?next=${encodeURIComponent(planPath(tierId))}`;
}

export const REFUND_HEADLINE = (rateBps: number) =>
  `Cancel anytime and get a ${percent(rateBps)} refund of unused purchased credits. No questions asked!`;

export const REFUND_CLARIFIER = (rateBps: number) =>
  `The refund is ${percent(rateBps)} of the amount you originally paid for the purchased top-up credits you have not used. ` +
  "Credits included in a subscription and promotional credits are not refundable. Your mandatory consumer rights are not affected.";

/** A checkout handed to the payment page, remembered so the return can be confirmed. */
const ITEM_NAMES: Record<string, string> = {
  starter: "Starter",
  research: "Research",
  professional: "Professional",
  extra: "Extra",
  research_pack: "Research Pack",
  lab_pack: "Lab Pack",
};

export function itemName(id: string | null | undefined): string {
  if (!id) return "Credit pack";
  return ITEM_NAMES[id] ?? id;
}

export type PendingCheckout = { kind: "subscription" | "topup"; item_id: string; purchase_before: number; at: number };

export const PENDING_CHECKOUT_KEY = "convolve.checkout";

/** True once the server reflects the payment (the provider's confirmation can lag the redirect). */
export function checkoutConfirmed(p: PendingCheckout, s: Pick<BillingState, "subscription" | "balances">): boolean {
  if (p.kind === "subscription") return s.subscription.active && !s.subscription.complimentary && s.subscription.tier_id === p.item_id;
  return s.balances.purchase > p.purchase_before;
}

/** What "Cancel and refund" will do, in plain sentences for the confirmation dialog. */
export function cancellationConsequences(quote: RefundQuote, state: Pick<BillingState, "subscription">): string[] {
  const out: string[] = [];
  const until = state.subscription.period_end;
  if (state.subscription.active && !state.subscription.cancel_at_period_end) {
    out.push(
      `Your subscription will not renew. You keep access${until ? ` until ${new Date(until).toLocaleDateString()}` : " until the paid period ends"}; nothing ends early.`,
    );
  } else if (state.subscription.active) {
    out.push("Renewal is already stopped. You keep access until the paid period ends.");
  }
  out.push("Paper-trading bots keep running until the period ends, then stop. They are not deleted.");
  out.push("Monthly subscription credits are not refundable and expire at the end of the period.");
  if (quote.reserved_credits > 0) {
    out.push(
      `${quote.reserved_credits} credits are held by runs that are still queued or running and cannot be refunded. If a run fails, its credits return to your balance as credits.`,
    );
  }
  out.push("Your models, datasets and results stay available to view after the subscription ends.");
  return out;
}

/** Country list for checkout: ISO code and display name, blocked countries flagged. */
export function countryOptions(blocked: string[], locale?: string): { code: string; name: string; blocked: boolean }[] {
  const codes = [
    "AT", "AU", "BE", "BG", "CA", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT",
    "JP", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "NZ", "PL", "PT", "RO", "SE", "SG", "SI", "SK", "US",
  ];
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" });
  } catch {
    names = null;
  }
  const set = new Set(blocked.map((c) => c.toUpperCase()));
  return codes
    .map((code) => ({ code, name: names?.of(code) ?? code, blocked: set.has(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const WITHDRAWAL_COUNTRIES = new Set(
  "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK IS LI NO GB".split(" "),
);
