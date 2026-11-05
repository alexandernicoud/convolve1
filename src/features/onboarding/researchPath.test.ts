import assert from "node:assert/strict";
import test from "node:test";
import { nextStep, researchSteps } from "./researchPath";

const counts = (o: Partial<Parameters<typeof researchSteps>[0]> = {}) => ({ datasets: 0, models: 0, analyses: 0, backtests: 0, improveExperiments: 0, ...o });

test("the research path runs Generate → Train → Analyze → Backtest → Improve", () => {
  assert.deepEqual(researchSteps(counts()).map((s) => s.id), ["generate", "train", "analyze", "backtest", "improve"]);
  assert.equal(nextStep(researchSteps(counts()))?.id, "generate");
  assert.equal(nextStep(researchSteps(counts({ datasets: 2 })))?.id, "train");
  assert.equal(nextStep(researchSteps(counts({ datasets: 2, models: 1 })))?.id, "analyze");
});

test("a skipped analysis does not hold the path back once a later step is done", () => {
  assert.equal(nextStep(researchSteps(counts({ datasets: 1, models: 1, backtests: 1 })))?.id, "improve");
  assert.equal(nextStep(researchSteps(counts({ datasets: 1, models: 1, analyses: 1, backtests: 1, improveExperiments: 1 }))), null);
});
