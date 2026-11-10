import test from "node:test";
import assert from "node:assert/strict";
import { modelTestCompatibility, parseSymbols } from "./compatibility";

test("symbol lists parse case-insensitively and de-duplicate", () => {
  assert.deepEqual(parseSymbols("aapl, MSFT;aapl"), ["AAPL", "MSFT"]);
  assert.deepEqual(parseSymbols(null), []);
});

test("no test set yet is pending", () => {
  assert.equal(modelTestCompatibility({ modelSymbols: "DIS" }).state, "pending");
});

test("testing on the training dataset is flagged as not independent", () => {
  const r = modelTestCompatibility({ modelDatasetId: "d1", testDatasetId: "d1" });
  assert.equal(r.state, "bad");
});

test("matching symbols and timeframe pass", () => {
  const r = modelTestCompatibility({ modelSymbols: "AAPL,MSFT", modelTimeframe: "1d", testDatasetId: "t", testSymbols: "MSFT", testTimeframe: "1D" });
  assert.equal(r.state, "ok");
});

test("different symbols or timeframe warn without blocking", () => {
  const sym = modelTestCompatibility({ modelSymbols: "DIS", modelTimeframe: "1d", testDatasetId: "t", testSymbols: "COST", testTimeframe: "1d" });
  assert.equal(sym.state, "warn");
  assert.match(sym.detail ?? "", /DIS/);
  const tf = modelTestCompatibility({ modelSymbols: "DIS", modelTimeframe: "1d", testDatasetId: "t", testSymbols: "DIS", testTimeframe: "1h" });
  assert.equal(tf.state, "warn");
  assert.match(tf.detail ?? "", /1h/);
});

test("missing metadata is reported as informational", () => {
  assert.equal(modelTestCompatibility({ testDatasetId: "t", testSymbols: "DIS" }).state, "info");
});
