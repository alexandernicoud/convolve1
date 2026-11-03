import assert from "node:assert/strict";
import test from "node:test";
import { datasetHealth, lookbackBars, type HealthInput } from "./health";
import type { ChartEstimate } from "./plan";

const est = (over: Partial<ChartEstimate> = {}): ChartEstimate => ({
  ok: true,
  per_class: 1000,
  symbols: 1,
  requested_total: 2000,
  balance_mode: "match_minority",
  raw_bars: 3000,
  invalid_bars: 0,
  decision_bars: 2900,
  valid_windows: 2893,
  incomplete_horizon: 7,
  invalid_windows: 0,
  label1_found: 1000,
  label0_found: 1500,
  skipped_class_full: 0,
  kept_label0: 1000,
  kept_label1: 1000,
  removed_for_balance: 0,
  final_label0: 1000,
  final_label1: 1000,
  final_total: 2000,
  fulfilled: true,
  earliest_observation: "2016-01-04",
  limit: null,
  end_date: "2024-01-02",
  start_date: null,
  floor_date: null,
  extend: false,
  failed_symbols: [],
  ...over,
});

const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  estimate: est(),
  timeframe: "1d",
  horizonBars: 7,
  timespanUnit: "months",
  timespanCount: 6,
  balanceMode: "match_minority",
  volumeMode: "by_charts",
  symbols: ["AAPL"],
  todayIso: "2026-11-02",
  ...over,
});

const byId = (list: ReturnType<typeof datasetHealth>) => Object.fromEntries(list.map((f) => [f.id, f]));

test("healthy settings produce no problems and report the measured label rate", () => {
  const f = byId(datasetHealth(input()));
  assert.equal(f.size.severity, "ok");
  assert.equal(f["label-rate"].severity, "ok");
  assert.match(f["label-rate"].title, /40% label 1/);
  assert.equal(f["test-room"].severity, "ok");
  assert.ok(!Object.values(f).some((x) => x.severity === "problem"));
  assert.equal(f.horizon.severity, "info", "excluded newest windows are explained, not flagged");
});

test("an unachievable size is a problem with a link to the setting that fixes it", () => {
  const f = byId(datasetHealth(input({ estimate: est({ fulfilled: false, final_total: 600, limit: { code: "history", message: "History ran out." } }) })));
  assert.equal(f.size.severity, "problem");
  assert.equal(f.size.action?.target, "chartsPerLabel");
  const p = byId(datasetHealth(input({ volumeMode: "by_period", estimate: est({ fulfilled: false, final_total: 1500 }) })));
  assert.equal(p.size.severity, "warning");
  assert.equal(p.size.action?.target, "trainingStart");
});

test("rare labels, keep-all imbalance and failed symbols are reported", () => {
  const f = byId(
    datasetHealth(
      input({
        balanceMode: "keep_all",
        estimate: est({ label1_found: 250, label0_found: 2400, final_label1: 250, final_label0: 1750, failed_symbols: ["XXXX"] }),
      }),
    ),
  );
  assert.equal(f["label-rate"].severity, "warning");
  assert.match(f["label-rate"].title, /Label 1/);
  assert.equal(f.imbalance.action?.target, "balance");
  assert.equal(f.failed.severity, "problem");
});

test("validation size and the remaining test period follow the dataset dates", () => {
  const f = byId(datasetHealth(input({ estimate: est({ earliest_observation: "2023-06-01", final_total: 400 }), todayIso: "2024-03-01" })));
  assert.equal(f.split.severity, "warning");
  assert.equal(f["test-room"].severity, "warning");
  assert.equal(f["test-room"].action?.target, "referenceEnd");
});

test("overlap with a recorded test set of the same stock is flagged as leakage", () => {
  const sets = [
    { name: "AAPL 2023", symbols: ["AAPL"], start: "2023-01-01", end: "2023-12-31" },
    { name: "MSFT 2023", symbols: ["MSFT"], start: "2023-01-01", end: "2023-12-31" },
  ];
  const f = byId(datasetHealth(input({ testSets: sets })));
  assert.equal(f.leakage.severity, "problem");
  assert.match(f.leakage.detail, /AAPL 2023/);
  assert.doesNotMatch(f.leakage.detail, /MSFT/);
  const clean = byId(datasetHealth(input({ testSets: [{ name: "AAPL 2025", symbols: ["AAPL"], start: "2024-06-01", end: "2025-06-01" }] })));
  assert.equal(clean.leakage.severity, "ok");
});

test("lookback bars convert the chart window to bars of the timeframe", () => {
  assert.equal(lookbackBars("1d", "months", 6), 130);
  assert.equal(lookbackBars("1wk", "months", 12), 52);
  assert.equal(lookbackBars("1mo", "months", 24), 24);
});
