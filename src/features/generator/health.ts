/**
 * Dataset Health: checks run on the generator's market-data estimate before anything is
 * generated. Every number comes from the estimate (the same sample walk as the run), the form
 * settings, or the user's recorded test sets. The checks explain and link to settings; they never
 * change them.
 */
import type { ChartEstimate, Timeframe } from "./plan";
import { fmtInt, fmtPct, sortFindings, type Finding } from "@/features/research/findings";

export interface TestSetRef {
  name: string;
  symbols: string[];
  start: string;
  end: string;
}

export interface HealthInput {
  estimate: ChartEstimate;
  timeframe: Timeframe;
  horizonBars: number;
  timespanUnit: string;
  timespanCount: number;
  balanceMode: "match_minority" | "keep_all";
  volumeMode: "by_charts" | "by_period";
  symbols: string[];
  todayIso: string;
  /** Validation share the Trainer uses by default. */
  valShare?: number;
  testSets?: TestSetRef[];
}

const DAYS_PER_BAR: Record<Timeframe, number> = { "1d": 7 / 5, "1wk": 7, "1mo": 30.44 };
const UNIT_DAYS: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };

/** Approximate bars a chart shows, from its calendar window. */
export function lookbackBars(timeframe: Timeframe, unit: string, count: number): number {
  return Math.max(1, Math.round(((UNIT_DAYS[unit] ?? 30.44) * count) / DAYS_PER_BAR[timeframe]));
}

const dayMs = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export function monthsBetween(a: string, b: string): number {
  return (toDay(b) - toDay(a)) / dayMs / 30.44;
}
const months = (m: number) => (m >= 24 ? `${(m / 12).toFixed(1)} years` : `${Math.max(0, Math.round(m))} months`);

export function datasetHealth(inp: HealthInput): Finding[] {
  const e = inp.estimate;
  const out: Finding[] = [];
  const valShare = inp.valShare ?? 0.2;
  const start = e.earliest_observation ?? e.start_date ?? null;

  // Requested versus achievable size, and available history.
  if (!e.fulfilled) {
    const ext = e.with_extension;
    out.push({
      id: "size",
      severity: e.final_total < e.requested_total * 0.5 ? "problem" : "warning",
      title: "Requested size is not achievable",
      detail: `These settings yield ${fmtInt(e.final_total)} of ${fmtInt(e.requested_total)} requested charts.${e.limit ? ` ${e.limit.message}` : ""}`,
      why: "The run stops when history runs out, so the dataset will be smaller than planned and the class you are short of decides the final size.",
      measured: [
        { label: "Requested", value: fmtInt(e.requested_total) },
        { label: "Achievable", value: fmtInt(e.final_total) },
        ...(start ? [{ label: "Earliest bar used", value: start }] : []),
        ...(ext && ext.final_total > e.final_total ? [{ label: "With an earlier start", value: `${fmtInt(ext.final_total)} from ${ext.earliest_observation ?? "—"}` }] : []),
      ],
      action:
        inp.volumeMode === "by_period"
          ? { label: "Move the training start earlier", target: "trainingStart" }
          : { label: "Lower charts per label", target: "chartsPerLabel" },
    });
  } else {
    out.push({
      id: "size",
      severity: "ok",
      title: "Requested size is achievable",
      detail: `${fmtInt(e.final_total)} charts${start ? ` from ${start}` : ""} to ${e.end_date}.`,
    });
  }

  if (e.failed_symbols.length) {
    out.push({
      id: "failed",
      severity: "problem",
      title: `No market data for ${e.failed_symbols.join(", ")}`,
      detail: "These stocks returned no usable prices for the period, so they add no charts.",
      why: "The dataset will not contain the stocks you expect, and per-stock targets shift onto the others.",
      action: { label: "Check the stock symbols", target: "symbols" },
    });
  }

  // Per-stock availability.
  const ps = (e.per_symbol ?? []).filter((s) => s.raw_bars > 0);
  if (ps.length > 1) {
    const max = Math.max(...ps.map((s) => s.raw_bars));
    const short = ps.filter((s) => s.raw_bars < max * 0.6);
    if (short.length) {
      out.push({
        id: "per-stock",
        severity: "warning",
        title: "Stocks have very different amounts of history",
        detail: `${short.map((s) => s.symbol).join(", ")} ${short.length > 1 ? "have" : "has"} less than 60% of the bars of the longest stock.`,
        why: "Shorter stocks contribute only recent periods, so older market conditions are learned from fewer stocks and per-stock results are not comparable.",
        measured: ps.map((s) => ({ label: s.symbol, value: `${fmtInt(s.raw_bars)} bars${s.first_bar ? ` from ${s.first_bar}` : ""}` })),
        action: { label: "Review the stock list", target: "symbols" },
      });
    }
  }

  // Label frequencies and imbalance.
  const found = e.label0_found + e.label1_found;
  if (found > 0) {
    const r1 = e.label1_found / found;
    const rare = Math.min(r1, 1 - r1);
    if (rare < 0.2) {
      const which = r1 < 0.5 ? "Label 1 (take profit first)" : "Label 0";
      out.push({
        id: "label-rate",
        severity: rare < 0.05 ? "problem" : "warning",
        title: `${which} is rare: ${fmtPct(rare, 1)} of checked windows`,
        detail: `Of ${fmtInt(found)} windows with a resolved outcome, ${fmtInt(e.label1_found)} are label 1 and ${fmtInt(e.label0_found)} label 0.`,
        why: "A model can score high accuracy by always predicting the common label. Balancing discards most of the common class; keeping all leaves a skewed training set.",
        measured: [
          { label: "Label 1 found", value: fmtInt(e.label1_found) },
          { label: "Label 0 found", value: fmtInt(e.label0_found) },
        ],
        experiment: "Compare a lower take-profit, a wider stop-loss or a longer horizon in the Labeling Optimizer before generating.",
        action: { label: "Adjust take profit / stop loss", target: "takeProfit" },
      });
    } else {
      out.push({
        id: "label-rate",
        severity: "ok",
        title: `Label frequencies: ${fmtPct(r1, 0)} label 1 / ${fmtPct(1 - r1, 0)} label 0`,
        detail: `Measured over ${fmtInt(found)} windows with a resolved outcome.`,
      });
    }
  }
  if (e.final_total > 0) {
    const s1 = e.final_label1 / e.final_total;
    if (inp.balanceMode === "keep_all" && (s1 < 0.4 || s1 > 0.6)) {
      out.push({
        id: "imbalance",
        severity: "warning",
        title: `Final dataset is imbalanced: ${fmtPct(s1, 0)} label 1`,
        detail: `Keep-all mode keeps ${fmtInt(e.final_label1)} label-1 and ${fmtInt(e.final_label0)} label-0 charts.`,
        why: "Accuracy will mostly reflect the majority class. Judge models by balanced accuracy, PR-AUC and per-class recall, or use balanced class weights in the Trainer.",
        action: { label: "Switch to balanced 50 / 50", target: "balance" },
      });
    } else if (inp.balanceMode === "match_minority" && e.removed_for_balance > 0.3 * (e.kept_label0 + e.kept_label1)) {
      out.push({
        id: "imbalance",
        severity: "info",
        title: `${fmtInt(e.removed_for_balance)} charts are discarded to balance the classes`,
        detail: "Balanced mode trims the larger class to the size of the smaller one.",
        why: "The dataset is smaller than the history allows. Keep-all with balanced class weights in the Trainer uses every chart instead.",
        action: { label: "Review the balance setting", target: "balance" },
      });
    }
  }

  // Incomplete horizons and invalid prices.
  if (e.incomplete_horizon > 0) {
    out.push({
      id: "horizon",
      severity: "info",
      title: `${fmtInt(e.incomplete_horizon)} newest windows are excluded`,
      detail: `Their ${inp.horizonBars}-bar outcome would end after the dataset end (${e.end_date}), so their label is unknown.`,
      why: "This is correct: labelling them would need prices after the end date. Nothing to change.",
    });
  }
  const invalidShare = e.decision_bars > 0 ? e.invalid_windows / e.decision_bars : 0;
  if (invalidShare > 0.01 || (e.raw_bars > 0 && e.invalid_bars / e.raw_bars > 0.01)) {
    out.push({
      id: "invalid",
      severity: "warning",
      title: "Some bars have missing or invalid prices",
      detail: `${fmtInt(e.invalid_bars)} of ${fmtInt(e.raw_bars)} bars are invalid; ${fmtInt(e.invalid_windows)} chart windows are skipped because of them.`,
      why: "Gaps can come from listings, splits or data errors. Skipped windows are not generated; frequent gaps can bias which periods are represented.",
    });
  }

  // Overlapping examples.
  const L = lookbackBars(inp.timeframe, inp.timespanUnit, inp.timespanCount);
  const H = Math.max(1, Math.floor(inp.horizonBars));
  if (e.final_total > 0 && (L > 1 || H > 1)) {
    const independent = Math.max(1, Math.round(e.final_total / H));
    out.push({
      id: "overlap",
      severity: independent < 300 ? "warning" : "info",
      title: "Neighbouring charts overlap",
      detail: `Charts are taken one per bar, so consecutive charts of a stock share about ${fmtPct((L - 1) / L, 0)} of their ~${L}-bar history and ${H - 1} of their ${H} outcome bars. Exact duplicates cannot occur (one chart per stock and bar).`,
      why: `Overlapping examples are not independent: roughly ${fmtInt(independent)} non-overlapping outcomes carry the information of ${fmtInt(e.final_total)} charts. Keep purging on in the Trainer so validation charts never share bars with training charts.`,
      measured: [
        { label: "Chart history", value: `~${L} bars` },
        { label: "Outcome horizon", value: `${H} bars` },
        { label: "Non-overlapping outcomes", value: `~${fmtInt(independent)}` },
      ],
    });
  }

  // Train / validation / test compatibility.
  if (start) {
    const span = monthsBetween(start, e.end_date);
    const valMonths = span * valShare;
    const valCharts = Math.round(e.final_total * valShare);
    const halfWidth = valCharts > 0 ? 1.96 * Math.sqrt(0.25 / valCharts) : 1;
    const thin = valMonths < 6 || valCharts < 200;
    out.push({
      id: "split",
      severity: thin ? "warning" : "ok",
      title: thin ? "Validation period will be short" : "Validation period has a usable size",
      detail: `With the Trainer's default chronological ${fmtPct(valShare)} validation share, validation covers about the last ${months(valMonths)} (~${fmtInt(valCharts)} charts) of a ${months(span)} dataset.`,
      why: thin
        ? `Validation accuracy on ~${fmtInt(valCharts)} charts is only precise to about ±${fmtPct(halfWidth, 1)}, and a short period may cover a single market regime.`
        : `Validation accuracy is precise to about ±${fmtPct(halfWidth, 1)} (95%).`,
      measured: [
        { label: "Dataset span", value: months(span) },
        { label: "Validation span", value: months(valMonths) },
        { label: "Validation charts", value: `~${fmtInt(valCharts)}` },
      ],
      ...(thin ? { action: inp.volumeMode === "by_period" ? { label: "Lengthen the training period", target: "trainingStart" } : { label: "Raise charts per label", target: "chartsPerLabel" } } : {}),
    });
  }
  const room = monthsBetween(e.end_date, inp.todayIso);
  out.push({
    id: "test-room",
    severity: room < 6 ? "warning" : "ok",
    title: room < 6 ? "Little unseen history remains for an independent test" : `${months(room)} after the dataset end remain for testing`,
    detail: `The dataset ends ${e.end_date}; prices after that date stay unseen by this dataset.`,
    why:
      room < 6
        ? "A backtest needs a period the model never saw. With under six months left, the test will be short and dominated by one regime."
        : "Create test sets only from dates after the dataset end to keep backtests independent.",
    ...(room < 6 ? { action: { label: "Move the dataset end earlier", target: "referenceEnd" } } : {}),
  });

  // Leakage against recorded test sets.
  if (start && inp.testSets?.length) {
    const syms = new Set(inp.symbols.map((s) => s.toUpperCase()));
    const hits = inp.testSets.filter((t) => t.symbols.some((s) => syms.has(s.toUpperCase())) && t.start <= e.end_date && t.end >= start);
    if (hits.length) {
      out.push({
        id: "leakage",
        severity: "problem",
        title: `Training period overlaps ${hits.length} of your test set${hits.length > 1 ? "s" : ""}`,
        detail: hits
          .slice(0, 4)
          .map((t) => `${t.name} (${t.start} → ${t.end})`)
          .join("; "),
        why: "A model trained on this dataset has seen those dates. A backtest on these test sets would no longer be an independent test and its results would be optimistic.",
        action: { label: "Move the dataset end before the test period", target: "referenceEnd" },
      });
    } else {
      out.push({
        id: "leakage",
        severity: "ok",
        title: "No overlap with your recorded test sets",
        detail: `Checked ${inp.testSets.length} test set${inp.testSets.length > 1 ? "s" : ""} for shared stocks and dates.`,
      });
    }
  }

  return sortFindings(out);
}
