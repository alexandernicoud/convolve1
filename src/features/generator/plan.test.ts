import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultTrainingEndIso,
  estimateRows,
  fallbackStartIso,
  initialWindow,
  timelineEstimate,
  yearsBeforeIso,
  type ChartEstimate,
} from "./plan";
import { countTradingDays } from "@/lib/tradingCalendar";
import { parseIsoDate } from "@/lib/generatorDates";

test("default training end is two calendar years before today", () => {
  assert.equal(defaultTrainingEndIso(new Date(2026, 9, 25)), "2024-10-25");
  assert.equal(defaultTrainingEndIso(new Date(2026, 0, 1)), "2024-01-01");
  assert.equal(yearsBeforeIso(new Date(2028, 1, 29), 2), "2026-02-28");
});

test("transferred research period overrides the defaults", () => {
  const today = new Date(2026, 9, 25);
  const plain = initialWindow(today);
  assert.deepEqual(plain, { volumeMode: "by_charts", trainingStartIso: "2021-10-25", referenceEndIso: "2024-10-25" });
  const t = initialWindow(today, { researchStart: "2015-01-02", researchEnd: "2018-11-13" });
  assert.deepEqual(t, { volumeMode: "by_period", trainingStartIso: "2015-01-02", referenceEndIso: "2018-11-13" });
  // An incomplete transfer keeps the defaults rather than guessing a period.
  assert.equal(initialWindow(today, { researchStart: "2015-01-02" }).referenceEndIso, "2024-10-25");
});

test("fallback start counts trading bars and moves with every input", () => {
  const base = { perClass: 100, timeframe: "1d" as "1d" | "1wk" | "1mo", horizonBars: 7, lookbackUnit: "months", lookbackCount: 6, endIso: "2024-10-25" };
  const start = fallbackStartIso(base)!;
  // 2 × 100 decision bars + 7 horizon bars on the NYSE calendar, then one 6-month lookback.
  const firstDecision = new Date(parseIsoDate(start)!);
  firstDecision.setMonth(firstDecision.getMonth() + 6);
  assert.equal(countTradingDays(firstDecision, parseIsoDate("2024-10-25")!), 207);
  const later = (patch: Partial<typeof base>) => fallbackStartIso({ ...base, ...patch })!;
  assert.ok(later({ perClass: 200 }) < start);
  assert.ok(later({ horizonBars: 30 }) < start);
  assert.ok(later({ lookbackCount: 12 }) < start);
  assert.ok(later({ timeframe: "1wk" }) < start);
  assert.ok(later({ endIso: "2024-06-28" }) < start);
  assert.equal(fallbackStartIso({ ...base, perClass: NaN }), null);
});

const EST: ChartEstimate = {
  ok: true, source: "market_data", per_class: 2000, symbols: 1, requested_total: 4000, balance_mode: "match_minority",
  raw_bars: 4130, invalid_bars: 0, decision_bars: 4005, valid_windows: 3998, incomplete_horizon: 7, invalid_windows: 0,
  label1_found: 1450, label0_found: 2548, skipped_class_full: 548, kept_label0: 2000, kept_label1: 1450,
  removed_for_balance: 550, final_label0: 1450, final_label1: 1450, final_total: 2900, fulfilled: false,
  earliest_observation: "2008-04-11", limit: { code: "history_start", message: "SYN: the walk reached the start of the available market history before label 1 (take profit first) reached 2000 charts." },
  end_date: "2024-10-25", start_date: null, floor_date: null, extend: false, failed_symbols: [],
};

test("timeline shows the data-based period and a shortfall", () => {
  const t = timelineEstimate({ estimate: EST, loading: false, volumeMode: "by_charts", trainingStartIso: "2021-10-25", endIso: "2024-10-25", requestedTotal: 4000, fallbackStart: "2016-01-01" })!;
  assert.equal(t.startIso, "2008-04-11");
  assert.equal(t.status, "short");
  assert.match(t.note, /at most 2,900 of 4,000/);
  const ok = timelineEstimate({ estimate: { ...EST, fulfilled: true, final_total: 4000 }, loading: false, volumeMode: "by_charts", trainingStartIso: "", endIso: "2024-10-25", requestedTotal: 4000, fallbackStart: null })!;
  assert.equal(ok.status, "enough");
  const approx = timelineEstimate({ estimate: null, loading: false, volumeMode: "by_charts", trainingStartIso: "", endIso: "2024-10-25", requestedTotal: 4000, fallbackStart: "2016-01-01" })!;
  assert.deepEqual([approx.status, approx.startIso], ["approx", "2016-01-01"]);
  const period = timelineEstimate({ estimate: null, loading: true, volumeMode: "by_period", trainingStartIso: "2019-01-01", endIso: "2024-10-25", requestedTotal: 10, fallbackStart: null })!;
  assert.deepEqual([period.status, period.startIso], ["loading", "2019-01-01"]);
});

test("breakdown rows reconcile requested and generated counts", () => {
  const rows = Object.fromEntries(estimateRows(EST).map((r) => [r.label, r.value]));
  assert.equal(rows["Final charts"], 2900);
  assert.equal(rows["Removed when balancing 50 / 50"], 550);
  assert.equal(rows["Label 1 found (take profit first)"] + rows["Label 0 found"], rows["Windows with a complete outcome"]);
});
