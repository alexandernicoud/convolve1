import test from "node:test";
import assert from "node:assert/strict";
import {
  errorList,
  fieldErrorsFromServer,
  revealPlan,
  submitIfValid,
  suggestDatasetName,
  validateGenerator,
  type GeneratorFormState,
} from "./validation";

const OK: GeneratorFormState = {
  symbols: ["AAPL"],
  chartsPerLabel: 500,
  volumeMode: "by_charts",
  trainingStartIso: "2019-01-01",
  referenceEndIso: "2024-10-25",
  datasetName: "AAPL · 1D · TP 2% / SL 1%",
  horizonBars: 7,
  takeProfitFraction: 0.02,
  stopLossFraction: 0.01,
  useRawEndOffset: false,
  endOffset: 0,
  todayIso: "2026-10-25",
};

test("a complete form has no errors", () => {
  assert.deepEqual(validateGenerator(OK), {});
});

test("missing dataset name inside the collapsed section opens it and gets focus", () => {
  const errors = validateGenerator({ ...OK, datasetName: "   " });
  assert.equal(errors.datasetName, "Dataset name is required.");
  assert.deepEqual(revealPlan(errors), { open: ["chartSettings"], focus: "datasetName" });
});

test("errors are listed in screen order and the first one is focused", () => {
  const errors = validateGenerator({ ...OK, symbols: [], datasetName: "", stopLossFraction: 1, useRawEndOffset: true, endOffset: -1 });
  assert.deepEqual(errorList(errors).map((e) => e.field), ["symbols", "datasetName", "stopLoss", "endOffset"]);
  const plan = revealPlan(errors);
  assert.equal(plan.focus, "symbols");
  assert.deepEqual(plan.open.sort(), ["advanced", "chartSettings"]);
});

test("errors disappear as soon as the field becomes valid", () => {
  const bad = validateGenerator({ ...OK, datasetName: "" });
  assert.ok(bad.datasetName);
  assert.equal(validateGenerator({ ...OK, datasetName: "Q3 set" }).datasetName, undefined);
});

test("numeric and date rules match the backend", () => {
  const e = validateGenerator({
    ...OK,
    chartsPerLabel: NaN,
    horizonBars: 2.5,
    takeProfitFraction: 0,
    volumeMode: "by_period",
    trainingStartIso: "2025-01-01",
    referenceEndIso: "2024-10-25",
  });
  assert.equal(e.chartsPerLabel, "Charts per class is required.");
  assert.match(e.horizonBars!, /whole number/);
  assert.match(e.takeProfit!, /above 0 %/);
  assert.equal(e.trainingStart, "Training start must be before the dataset end.");
  assert.equal(validateGenerator({ ...OK, referenceEndIso: "2027-01-01" }).referenceEnd, "Dataset end cannot be in the future.");
  assert.equal(validateGenerator({ ...OK, referenceEndIso: "" }).referenceEnd, "Dataset end is required.");
  assert.equal(validateGenerator({ ...OK, chartsPerLabel: 20001 }).chartsPerLabel !== undefined, true);
});

test("no generation is started while the form is invalid", async () => {
  let calls = 0;
  const start = () => {
    calls += 1;
  };
  assert.equal(await submitIfValid(validateGenerator({ ...OK, datasetName: "" }), start), false);
  assert.equal(calls, 0);
  assert.equal(await submitIfValid(validateGenerator(OK), start), true);
  assert.equal(calls, 1);
});

test("backend 422 messages map back to fields", () => {
  const msg = '422 Validation error: Value error, datasetName: Dataset name is required.; stopLoss: Stop loss must be above 0 % and below 100 %.';
  assert.deepEqual(fieldErrorsFromServer(msg), {
    datasetName: "Dataset name is required.",
    stopLoss: "Stop loss must be above 0 % and below 100 %.",
  });
});

test("suggested dataset name", () => {
  assert.equal(suggestDatasetName(["AAPL", "MSFT"], "1d", 0.02, 0.01), "AAPL, MSFT · 1D · TP 2% / SL 1%");
  assert.equal(suggestDatasetName(["A", "B", "C", "D"], "1wk", 0.035, 0.0175), "A, B, C +1 · 1W · TP 3.5% / SL 1.75%");
});
