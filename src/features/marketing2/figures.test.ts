import { test } from "node:test";
import assert from "node:assert/strict";
import run from "./data/training.json";
import { SYSTEM, forwardMacs, optimizerCells, runFigures, sci, trainingSetups } from "./figures";

test("forward multiply-adds of the original CNN match the backend's 0.944 GFLOPs", () => {
  // 222²·32·27 + 109²·64·288 + 52²·128·576 + 86,528·128 + 128·1
  assert.equal(forwardMacs(run.arch), 42_581_376 + 218_990_592 + 199_360_512 + 11_075_584 + 128);
  const f = runFigures(run, [224, 224, 3], 16);
  assert.equal(Number((f.forwardFlops / 1e9).toFixed(3)), 0.944);
});

test("training counts follow from the run record", () => {
  const f = runFigures(run, [224, 224, 3], 16);
  assert.equal(f.inputValues, 150_528);
  assert.equal(f.params, 11_169_089);
  assert.equal(f.stepsPerEpoch, 146); // ceil(2,323 / 16)
  assert.equal(f.optimizerSteps, 1_460); // 10 epochs
  assert.equal(f.imagePasses, 23_230);
  assert.equal(f.weightUpdates, 1_460 * 11_169_089);
  assert.equal(sci(f.weightUpdates), "1.6 × 10¹⁰");
  assert.equal(sci(f.trainingFlopsEstimate), "6.6 × 10¹³"); // 3 × 0.944 GFLOPs × 23,230
});

test("platform figures follow from the configuration", () => {
  assert.equal(optimizerCells(), 125_000); // 25 × 25 × 200
  assert.equal(SYSTEM.maxChartSize ** 2 * 3, 786_432);
});

test("training setups count only the Trainer's discrete choices", () => {
  const { total, factors } = trainingSetups();
  assert.deepEqual(factors.map(([, n]) => n), [9, 3, 4, 5, 2, 4]);
  assert.equal(total, 4_320); // same product is asserted against trainer_options.py in the backend
});

test("the Optimizer figure replays every rule over every bar of the recorded run", () => {
  assert.equal(optimizerCells() * SYSTEM.optimizerRun.bars, 31_125_000);
  assert.equal(sci(optimizerCells() * SYSTEM.optimizerRun.bars), "3.1 × 10⁷");
});
