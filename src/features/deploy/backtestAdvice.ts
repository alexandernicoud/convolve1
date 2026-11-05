import type { ReviewRun } from "@/lib/api";

export type BacktestAdvice = {
  /** none: no backtest of this model; exploratory: backtests exist but none is an independent test. */
  status: "none" | "exploratory" | "independent";
  /** The backtest whose threshold is offered: the chosen one, else the latest independent one. */
  source: ReviewRun | null;
  threshold: number | null;
  thresholdLocked: boolean;
};

const independent = (r: ReviewRun) => r.backtest?.methodology?.evaluation_class === "independent_test";
const thresholdOf = (r: ReviewRun | null | undefined): number | null => {
  const t = r?.backtest?.assumptions?.confidence_threshold;
  return typeof t === "number" && Number.isFinite(t) ? t : null;
};

export function backtestAdvice(modelBacktests: ReviewRun[], chosenId: string): BacktestAdvice {
  const status = !modelBacktests.length ? "none" : modelBacktests.some(independent) ? "independent" : "exploratory";
  const chosen = chosenId ? modelBacktests.find((r) => r.id === chosenId) ?? null : null;
  const latestIndependent =
    [...modelBacktests].filter((r) => independent(r) && thresholdOf(r) != null).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  const source = chosen && thresholdOf(chosen) != null ? chosen : latestIndependent;
  return {
    status,
    source,
    threshold: thresholdOf(source),
    thresholdLocked: source?.backtest?.methodology?.threshold_source === "validation_locked",
  };
}

export function backtestTitle(r: ReviewRun): string {
  const when = new Date(r.created_at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${r.backtest?.symbol ?? "Backtest"} · ${when} · id ${r.id.slice(-6)}`;
}

/** What changing the threshold away from the backtested value means, or null when they match. */
export function thresholdChangeNote(current: number, backtested: number | null): string | null {
  if (backtested == null || Math.abs(current - backtested) < 0.005) return null;
  const direction =
    current < backtested
      ? "A lower threshold trades more often, on weaker signals."
      : "A higher threshold trades less often, only on the model's strongest signals.";
  return `The backtest measured ${backtested.toFixed(2)}; its results do not describe ${current.toFixed(2)}. ${direction} The paper bot becomes the first test of this setting.`;
}
