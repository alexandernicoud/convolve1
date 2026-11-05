import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewRun } from "@/lib/api";
import { backtestAdvice, thresholdChangeNote } from "./backtestAdvice";

const bt = (id: string, created: number, cls: "independent_test" | "exploratory", thr?: number): ReviewRun =>
  ({
    id,
    tool: "backtester",
    status: "succeeded",
    created_at: created,
    links: {},
    backtest: {
      assumptions: thr == null ? {} : { confidence_threshold: thr },
      methodology: { id: "price_sim_v2", label: "", evaluation_class: cls, threshold_source: "validation_locked" },
    },
  }) as unknown as ReviewRun;

test("no backtests means a warning and nothing to prefill", () => {
  const a = backtestAdvice([], "");
  assert.equal(a.status, "none");
  assert.equal(a.source, null);
  assert.equal(a.threshold, null);
});

test("exploratory-only backtests are flagged and not offered as a source", () => {
  const a = backtestAdvice([bt("x1", 10, "exploratory", 0.55)], "");
  assert.equal(a.status, "exploratory");
  assert.equal(a.source, null);
});

test("the latest independent backtest is offered unless the user picked one", () => {
  const runs = [bt("old", 10, "independent_test", 0.52), bt("new", 20, "independent_test", 0.61), bt("exp", 30, "exploratory", 0.7)];
  const a = backtestAdvice(runs, "");
  assert.equal(a.status, "independent");
  assert.equal(a.source?.id, "new");
  assert.equal(a.threshold, 0.61);
  assert.equal(a.thresholdLocked, true);
  assert.equal(backtestAdvice(runs, "exp").source?.id, "exp", "an explicitly chosen backtest wins");
});

test("changing the threshold explains what the backtest no longer covers", () => {
  assert.equal(thresholdChangeNote(0.61, 0.61), null);
  assert.match(thresholdChangeNote(0.5, 0.61)!, /more often, on weaker signals/);
  assert.match(thresholdChangeNote(0.7, 0.61)!, /less often/);
  assert.equal(thresholdChangeNote(0.7, null), null);
});
