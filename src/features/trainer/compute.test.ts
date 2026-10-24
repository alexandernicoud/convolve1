import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrainingSession } from "@/lib/api";
import { fmtSci, layerTableMacs, runCompute } from "./compute";

/** The standard network's layer table at 224 × 224, as backend/app/services/trainer_session.standard_architecture builds it. */
const STANDARD_LAYERS = [
  { name: "Input", shape: [224, 224, 3], params: 0 },
  { name: "Conv2D 3×3 · 32", shape: [222, 222, 32], params: 896 },
  { name: "MaxPool 2×2", shape: [111, 111, 32], params: 0 },
  { name: "Conv2D 3×3 · 64", shape: [109, 109, 64], params: 18496 },
  { name: "MaxPool 2×2", shape: [54, 54, 64], params: 0 },
  { name: "Conv2D 3×3 · 128", shape: [52, 52, 128], params: 73856 },
  { name: "MaxPool 2×2", shape: [26, 26, 128], params: 0 },
  { name: "Flatten", shape: [86528], params: 0 },
  { name: "Dense · 128", shape: [128], params: 86528 * 128 + 128 },
  { name: "Dense · 1", shape: [1], params: 129 },
];
const TOTAL = STANDARD_LAYERS.reduce((a, l) => a + l.params, 0);

const session = (over: Partial<TrainingSession>): TrainingSession =>
  ({
    run_id: "r",
    stage: "training",
    history: [],
    epochs_completed: 0,
    config: { use_standard_config: true, image_size: [224, 224], batch_size: 16 },
    train_samples: 2323,
    architecture: { family: "Convolve standard CNN", layers: STANDARD_LAYERS, total_params: TOTAL, loss: "binary_crossentropy" },
    ...over,
  }) as TrainingSession;

test("layer-table multiply-adds match the backend's counted 0.944 GFLOPs for the standard CNN", () => {
  assert.equal(TOTAL, 11_169_089);
  assert.equal(layerTableMacs(STANDARD_LAYERS), 472_008_192);
  assert.equal(layerTableMacs([{ name: "Flatten", shape: [8], params: 0 }]), null);
});

test("counts after completed epochs only", () => {
  const c = runCompute(session({ epochs_completed: 10, stage: "completed" }));
  assert.equal(c.stepsPerEpoch, 146);
  assert.equal(c.optimizerSteps, 1460);
  assert.equal(c.imagesProcessed, 23_230);
  assert.equal(c.trainableParameters, 11_169_089);
  assert.equal(c.parameterUpdates, 1460 * 11_169_089);
  assert.equal(c.forwardFlops, 944_016_384);
  assert.equal(c.forwardFlopsSource, "layer table");
  assert.equal(c.trainingFlopsEstimate, 3 * 944_016_384 * 23_230);
  assert.deepEqual(c.inputShape, [224, 224, 3]);
  assert.equal(c.includesLiveBatch, false);
});

test("the live batch report adds the running epoch, capped at the training set", () => {
  const live = { epoch_in_progress: 3, epochs: 30, batch: 40, batches: 146, images_per_second: 50 };
  const c = runCompute(session({ epochs_completed: 2, live_epoch: live }));
  assert.equal(c.optimizerSteps, 2 * 146 + 40);
  assert.equal(c.imagesProcessed, 2 * 2323 + 40 * 16);
  assert.equal(c.includesLiveBatch, true);
  const last = runCompute(session({ epochs_completed: 2, live_epoch: { ...live, batch: 146, validating: true } }));
  assert.equal(last.imagesProcessed, 3 * 2323);
  // A stale report from an epoch that has since finished is not counted twice.
  const stale = runCompute(session({ epochs_completed: 3, live_epoch: live }));
  assert.equal(stale.optimizerSteps, 3 * 146);
});

test("nothing is derived without the numbers it needs", () => {
  const c = runCompute(session({ train_samples: null, config: { use_standard_config: false }, architecture: null }));
  assert.equal(c.imagesProcessed, null);
  assert.equal(c.optimizerSteps, null);
  assert.equal(c.parameters, null);
  assert.equal(c.parameterUpdates, null);
  assert.equal(c.forwardFlops, null);
  assert.equal(c.trainingFlopsEstimate, null);
  assert.equal(c.learningRate, null);
});

test("graph architectures and frozen layers wait for the measured model summary", () => {
  const graph = session({ architecture: { family: "ResNet-18", stages: ["stem"], layers: null, total_params: null, loss: "binary_crossentropy" } });
  assert.equal(runCompute(graph).trainableParameters, null);
  assert.equal(runCompute(graph).forwardFlops, null);
  const frozen = session({ options: { transfer: { mode: "frozen" } } });
  assert.equal(runCompute(frozen).trainableParameters, null);
  assert.equal(runCompute(frozen).parameters, TOTAL);
  const measured = runCompute({ ...graph, model: { parameters: 11_200_000, trainable_parameters: 11_190_000, forward_gflops: 3.6 } } as TrainingSession);
  assert.equal(measured.trainableParameters, 11_190_000);
  assert.equal(measured.forwardFlops, 3.6e9);
  assert.equal(measured.forwardFlopsSource, "measured");
});

test("learning rate: recorded per epoch, else configured, else the Keras default for older runs", () => {
  const recorded = runCompute(session({ history: [{ epoch: 4, loss: 1, accuracy: 0.5, val_loss: 1, val_accuracy: 0.5, learning_rate: 5e-4 }] }));
  assert.deepEqual(recorded.learningRate, { value: 5e-4, source: "epoch 4" });
  assert.deepEqual(runCompute(session({ trainer_protocol: 2, options: { optimizer: { name: "sgd", learning_rate: 0.01 } } })).learningRate, { value: 0.01, source: "configured" });
  assert.deepEqual(runCompute(session({})).learningRate, { value: 1e-3, source: "Keras Adam default" });
});

test("fmtSci", () => {
  assert.equal(fmtSci(16_306_869_940), "1.6 × 10¹⁰");
  assert.equal(fmtSci(6.6e13), "6.6 × 10¹³");
  assert.equal(fmtSci(1e-4), "10⁻⁴");
  assert.equal(fmtSci(5e-4), "5 × 10⁻⁴");
  assert.equal(fmtSci(23_230), "23,230");
  assert.equal(fmtSci(null), "—");
});
