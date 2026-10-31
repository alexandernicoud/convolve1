/** Free public beta: limits served by /api/plans, the founding member offer and run refusals. */

export type BetaLimits = {
  free_beta: true;
  max_symbols: number;
  max_charts_per_label: number;
  max_image_dimension: number;
  max_optimizer_years: number;
  max_active_runs: number;
  max_queued_runs: number;
  max_runs_per_day: number;
  max_active_inprocess_runs?: number;
  max_active_training_jobs: number;
  max_epochs: number;
  max_training_images: number;
};

export type FoundingOffer = {
  open: boolean;
  percent: number;
  applies_to: string[];
  ends_at: string | null;
};

export type FoundingDiscountState = {
  status: "available" | "redeemed" | "not_eligible";
  reason: string | null;
  percent: number;
  applies_to: string[];
  first_invoice_only: boolean;
  redeemed_at: string | null;
};

/** `{}` from the server means the beta is off. */
export function asBetaLimits(raw: unknown): BetaLimits | null {
  if (!raw || typeof raw !== "object") return null;
  return (raw as { free_beta?: unknown }).free_beta === true ? (raw as BetaLimits) : null;
}

export type BetaTool = "generator" | "trainer" | "optimizer" | "backtester" | "analysis";

export function betaToolForPath(pathname: string): BetaTool | null {
  if (pathname.startsWith("/tools/generator")) return "generator";
  if (pathname.startsWith("/tools/trainer")) return "trainer";
  if (pathname.startsWith("/tools/backtester")) return "backtester";
  if (pathname.startsWith("/tools/analysis") || pathname.startsWith("/products/trainer/analysis")) return "analysis";
  if (pathname.startsWith("/products/labeling-optimizer")) return "optimizer";
  return null;
}

const n = (v: number) => v.toLocaleString("en-US");

/** The limits that apply to one tool. A limit of 0 is "not limited" and is left out. */
export function betaLimitLines(beta: BetaLimits, tool: BetaTool): string[] {
  const out: string[] = [];
  const add = (value: number | undefined, text: string) => {
    if (value && value > 0) out.push(text);
  };
  if (tool === "generator") {
    add(beta.max_symbols, `up to ${n(beta.max_symbols)} symbols`);
    add(beta.max_charts_per_label, `${n(beta.max_charts_per_label)} charts per label and symbol`);
    add(beta.max_image_dimension, `images up to ${n(beta.max_image_dimension)} px`);
  } else if (tool === "optimizer") {
    add(beta.max_optimizer_years, `periods up to ${n(beta.max_optimizer_years)} years`);
  } else if (tool === "trainer") {
    add(beta.max_epochs, `up to ${n(beta.max_epochs)} epochs`);
    add(beta.max_training_images, `${n(beta.max_training_images)} training images`);
    add(beta.max_active_training_jobs, `${n(beta.max_active_training_jobs)} training run${beta.max_active_training_jobs === 1 ? "" : "s"} at a time`);
  } else {
    add(beta.max_active_inprocess_runs, `${n(beta.max_active_inprocess_runs ?? 0)} run${beta.max_active_inprocess_runs === 1 ? "" : "s"} at a time`);
  }
  if (tool === "generator" || tool === "optimizer") {
    add(beta.max_active_runs, `${n(beta.max_active_runs)} running and ${n(beta.max_queued_runs)} queued per account`);
  }
  add(beta.max_runs_per_day, `${n(beta.max_runs_per_day)} runs per day across all tools`);
  return out;
}

export type RunRefusal = {
  title: string;
  message: string;
  /** Opens the questionnaire instead of a plain close. */
  feedback?: boolean;
  /** Where to look at the run that is already queued or running. */
  runId?: string;
  /** Points to the contact page (market-data test group). */
  contact?: boolean;
};

export const MARKET_DATA_MESSAGE =
  "Tools that download market prices are open to an invited test group while market-data licensing is finalised. Training on your saved datasets and analysing your models remain available.";

/** Market-data tools are limited to an invited test group (server: MARKET_DATA_ACCESS=cohort). */
export type MarketDataState = { access: "open" | "cohort"; tools: string[] };

export function asMarketData(raw: unknown): MarketDataState | null {
  if (!raw || typeof raw !== "object") return null;
  const access = (raw as { access?: unknown }).access;
  if (access !== "open" && access !== "cohort") return null;
  const tools = (raw as { tools?: unknown }).tools;
  return { access, tools: Array.isArray(tools) ? tools.filter((t): t is string => typeof t === "string") : [] };
}

/** Tool pages whose runs download market prices. */
export function usesMarketData(tool: BetaTool | null): boolean {
  return tool === "generator" || tool === "optimizer" || tool === "backtester";
}

const TITLES: Record<string, string> = {
  feedback_required: "Help shape Convolve",
  beta_limit: "Beyond the beta limits",
  daily_limit: "Daily limit reached",
  queue_full: "Queue limit reached",
  too_many_active: "A run is already in progress",
  busy: "Workers are busy",
  duplicate_submission: "Already running",
};

/** Dialog content for a refused run start; null when the response is not a refusal we explain. */
export function runRefusal(status: number, detail: unknown): RunRefusal | null {
  const d = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
  const code = typeof d.code === "string" ? d.code : "";
  const message = typeof d.message === "string" ? d.message : typeof detail === "string" ? detail : "";
  if (status === 403) {
    if (code === "market_data_restricted") {
      return { title: "Market data: invited test group", message: message || MARKET_DATA_MESSAGE, contact: true };
    }
    if (code !== "feedback_required") return null;
    return {
      title: TITLES.feedback_required,
      message:
        "You've now had a chance to try Convolve. Before your next experiment, tell us what works, what doesn't, and what you'd improve.",
      feedback: true,
    };
  }
  if (status === 422 && code !== "beta_limit") return null;
  if (status === 409 && code !== "duplicate_submission") return null;
  if (status !== 409 && status !== 422 && status !== 429 && status !== 503) return null;
  const fallback: Record<number, [string, string]> = {
    409: ["Already running", "An identical run is already queued or running, so it was not started again."],
    422: [TITLES.beta_limit, "This configuration is larger than the free beta allows."],
    429: ["Limit reached", "You have reached a beta usage limit. Please try again later."],
    503: [TITLES.busy, "All research workers are busy. Please try again in a few minutes."],
  };
  const [title, text] = fallback[status];
  return {
    title: TITLES[code] ?? title,
    message: message || text,
    runId: typeof d.run_id === "string" ? d.run_id : undefined,
  };
}
