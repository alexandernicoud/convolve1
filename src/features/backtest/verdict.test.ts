import assert from "node:assert/strict";
import test from "node:test";
import type { IncrementalValue, PairedComparison } from "./api";
import { pairedHeadline, pairedReadings } from "./verdict";
import { labelMethodName, outcomeConventionName } from "@/features/research/conventions";

const pc = (ci: [number, number] | null): PairedComparison => ({
  method: "cmbb",
  n_periods: 500,
  block_length: 10,
  n_boot: 1000,
  mean_diff_annualized: ci ? (ci[0] + ci[1]) / 2 : null,
  ci95_annualized: ci,
  p_diff_le_0: null,
  total_return_diff: null,
});

const inc = (ae: [number, number] | null, pa: [number, number] | null): IncrementalValue =>
  ({
    version: 1,
    method: "m",
    same_as_cnn: "",
    cnn: { total_return: 0 },
    candidates: { cnn: 10, eligible: 20 },
    paired: { always_eligible: pc(ae), passive: pc(pa) },
    verdict: { id: "inconclusive", label: "Inconclusive", reasons: [] },
  }) as IncrementalValue;

test("underperformance with an interval below zero is stated even when the verdict is capped", () => {
  const h = pairedHeadline(inc([-0.05, 0.02], [-0.12, -0.03]), false)!;
  assert.equal(h.tone, "negative");
  assert.match(h.text, /underperformed the exposure-matched passive mix/);
  assert.doesNotMatch(h.text, /every eligible/);
});

test("outperformance is not called an edge outside an independent test", () => {
  assert.equal(pairedHeadline(inc([0.01, 0.08], null), false)!.tone, "neutral");
  assert.equal(pairedHeadline(inc([0.01, 0.08], null), true)!.tone, "positive");
});

test("intervals crossing zero say the strategies cannot be told apart", () => {
  const h = pairedHeadline(inc([-0.04, 0.03], [-0.02, 0.05]), true)!;
  assert.equal(h.tone, "neutral");
  assert.match(h.text, /cannot tell/);
  assert.deepEqual(pairedReadings(inc([-0.04, 0.03], null)).map((r) => r.direction), ["unclear", "unclear"]);
});

test("convention ids get readable names and unknown ids pass through", () => {
  assert.match(labelMethodName("tp_first_else_zero_v2"), /target is hit before the stop/);
  assert.match(outcomeConventionName("next_open_tp_sl_v1"), /next open/);
  assert.equal(labelMethodName("custom_x"), "custom_x");
  assert.equal(labelMethodName(undefined), "—");
});
