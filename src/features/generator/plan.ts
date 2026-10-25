import { isoDateString, parseIsoDate, shiftCalendarByTimespan, startOfLocalDay } from "@/lib/generatorDates";
import { tradingDaysBefore } from "@/lib/tradingCalendar";

export type Timeframe = "1d" | "1wk" | "1mo";
export type BalanceMode = "match_minority" | "keep_all";
export type VolumeMode = "by_charts" | "by_period";

/** Same calendar date `years` earlier; 29 February falls back to the 28th. */
export function yearsBeforeIso(today: Date, years: number): string {
  const y = today.getFullYear() - years;
  const m = today.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return isoDateString(new Date(y, m, Math.min(today.getDate(), lastDay)));
}

/** Default training end: two calendar years before today, leaving room for a test phase. */
export function defaultTrainingEndIso(today: Date = new Date()): string {
  return yearsBeforeIso(startOfLocalDay(today), 2);
}

export function defaultTrainingStartIso(today: Date = new Date()): string {
  return yearsBeforeIso(startOfLocalDay(today), 5);
}

export type InitialWindow = { volumeMode: VolumeMode; trainingStartIso: string; referenceEndIso: string };

/** Starting window: defaults, unless an Optimizer transfer carries an explicit research period. */
export function initialWindow(
  today: Date,
  transfer?: { researchStart?: string | null; researchEnd?: string | null } | null,
): InitialWindow {
  if (transfer?.researchStart && transfer?.researchEnd) {
    return { volumeMode: "by_period", trainingStartIso: transfer.researchStart, referenceEndIso: transfer.researchEnd };
  }
  return { volumeMode: "by_charts", trainingStartIso: defaultTrainingStartIso(today), referenceEndIso: defaultTrainingEndIso(today) };
}

/** Response of `POST /api/training-chart-generator/estimate` (subset used by the UI). */
export interface ChartEstimate {
  ok: boolean;
  message?: string;
  source?: "market_data";
  per_class: number;
  symbols: number;
  requested_total: number;
  balance_mode: BalanceMode;
  raw_bars: number;
  invalid_bars: number;
  decision_bars: number;
  valid_windows: number;
  incomplete_horizon: number;
  invalid_windows: number;
  label1_found: number;
  label0_found: number;
  skipped_class_full: number;
  kept_label0: number;
  kept_label1: number;
  removed_for_balance: number;
  final_label0: number;
  final_label1: number;
  final_total: number;
  fulfilled: boolean;
  earliest_observation: string | null;
  limit: { code: string; message: string } | null;
  end_date: string;
  start_date: string | null;
  floor_date: string | null;
  extend: boolean;
  failed_symbols: string[];
  window_per_class?: number;
  with_extension?: { final_total: number; fulfilled: boolean; earliest_observation: string | null; limit: { code: string; message: string } | null };
  per_symbol?: { symbol: string; raw_bars: number; first_bar: string | null; stop_reason: string }[];
}

const BARS_PER_STEP: Record<Timeframe, (end: Date, n: number) => Date> = {
  "1d": (end, n) => tradingDaysBefore(end, n),
  "1wk": (end, n) => new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7 * n),
  "1mo": (end, n) => new Date(end.getFullYear(), end.getMonth() - n, end.getDate()),
};

/**
 * Without market data: the latest start that could possibly hold the target. Each bar yields at
 * most one chart, so both classes need at least `2 × per class` decision bars, plus the last
 * `horizon` bars whose outcome runs past the end, plus one chart lookback. Real counts are lower
 * whenever a class is rarer than 50 %.
 */
export function fallbackStartIso(p: {
  perClass: number;
  timeframe: Timeframe;
  horizonBars: number;
  lookbackUnit: string;
  lookbackCount: number;
  endIso: string;
}): string | null {
  const end = parseIsoDate(p.endIso);
  if (!end || !(p.perClass >= 1)) return null;
  const bars = 2 * Math.floor(p.perClass) + Math.max(0, Math.floor(p.horizonBars));
  const firstDecision = BARS_PER_STEP[p.timeframe](end, bars);
  return isoDateString(shiftCalendarByTimespan(firstDecision, p.lookbackUnit, p.lookbackCount));
}

export type TimelineEstimate = {
  startIso: string;
  endIso: string;
  totalCharts: number;
  requestedTotal: number;
  status: "enough" | "short" | "approx" | "loading";
  note: string;
};

/** What the timeline shows: the period the run will read and whether the target fits. */
export function timelineEstimate(args: {
  estimate: ChartEstimate | null;
  loading: boolean;
  volumeMode: VolumeMode;
  trainingStartIso: string;
  endIso: string;
  requestedTotal: number;
  fallbackStart: string | null;
}): TimelineEstimate | null {
  const { estimate: e, loading, volumeMode, trainingStartIso, endIso, requestedTotal, fallbackStart } = args;
  if (e?.ok) {
    const start = e.earliest_observation ?? (volumeMode === "by_period" ? trainingStartIso : fallbackStart) ?? endIso;
    const enough = e.fulfilled;
    const note = enough
      ? `Enough history · data from ${start}`
      : `Not enough history · at most ${e.final_total.toLocaleString()} of ${e.requested_total.toLocaleString()} charts`;
    return { startIso: start, endIso, totalCharts: e.final_total, requestedTotal: e.requested_total, status: loading ? "loading" : enough ? "enough" : "short", note };
  }
  const start = volumeMode === "by_period" ? trainingStartIso : fallbackStart;
  if (!start) return null;
  return {
    startIso: start,
    endIso,
    totalCharts: requestedTotal,
    requestedTotal,
    status: loading ? "loading" : "approx",
    note: loading ? "Checking market data…" : "Trading-calendar estimate (no market data yet)",
  };
}

/** Plain-language breakdown rows for the estimate details. */
export function estimateRows(e: ChartEstimate): { label: string; value: number }[] {
  return [
    { label: "Bars downloaded (within the permitted period)", value: e.raw_bars },
    { label: "Bars with missing or invalid prices", value: e.invalid_bars },
    { label: "Chart windows checked", value: e.decision_bars },
    { label: "Windows with a complete outcome", value: e.valid_windows },
    { label: "Outcome horizon runs past the dataset end", value: e.incomplete_horizon },
    { label: "Windows with missing prices", value: e.invalid_windows },
    { label: "Label 1 found (take profit first)", value: e.label1_found },
    { label: "Label 0 found", value: e.label0_found },
    { label: "Skipped because that class was already full", value: e.skipped_class_full },
    { label: "Removed when balancing 50 / 50", value: e.removed_for_balance },
    { label: "Final charts", value: e.final_total },
  ];
}
