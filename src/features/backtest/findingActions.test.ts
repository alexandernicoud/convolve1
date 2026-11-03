import { test } from "node:test";
import assert from "node:assert/strict";
import { findingActionLink } from "./findingActions";

const trained = { runId: "bt1", trainerRunId: "tr 1", modelId: null, datasetId: "ds1" };
const uploaded = { runId: "bt1", trainerRunId: null, modelId: "m1", datasetId: "ds1" };

test("improve links carry the model and the originating backtest", () => {
  const a = findingActionLink({ kind: "improve", label: "Improve" }, trained);
  assert.equal(a?.to, "/tools/improve?model=trained%3Atr%201&from=backtest%3Abt1");
  assert.equal(findingActionLink({ kind: "improve", label: "Improve" }, uploaded), null, "uploaded models cannot be retrained");
});

test("analysis, backtester and labeling links preload what the page reads", () => {
  assert.equal(findingActionLink({ kind: "analyze", label: "A" }, uploaded)?.to, "/tools/analysis?model=uploaded%3Am1");
  assert.equal(findingActionLink({ kind: "rerun_validation_threshold", label: "R" }, trained)?.to, "/tools/backtester?modelRunId=tr%201&datasetId=ds1");
  assert.equal(findingActionLink({ kind: "new_test_set", label: "N" }, uploaded)?.to, "/tools/backtester?modelId=m1");
  assert.equal(findingActionLink({ kind: "labeling", label: "L" }, trained)?.to, "/products/labeling-optimizer/technical");
});

test("unknown or missing actions produce no link", () => {
  assert.equal(findingActionLink(undefined, trained), null);
  assert.equal(findingActionLink({ kind: "something_new", label: "X" }, trained), null);
});
