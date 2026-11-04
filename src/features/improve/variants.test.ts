import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrainingSession } from "@/lib/api";
import { baselineFromSession, buildVariant, experimentPayload, nextReplicate, ORDER, selectionStatus } from "./variants";

function session(over: Partial<TrainingSession> = {}): TrainingSession {
  return {
    run_id: "r1",
    stage: "completed",
    model_name: "COST1.keras",
    dataset: { id: "ds1", generator_run_id: "g1", image_count: 4000 },
    config: { use_standard_config: true, image_size: [224, 224], batch_size: 16, epochs: 30, val_split: 0.2, random_seed: 7, trainer_protocol: 2, validation_method: "chronological", label_horizon_bars: 4, label_horizon_source: "generator_config" },
    trainer_protocol: 2,
    options: {
      validation_method: "chronological",
      optimizer: { name: "adam", learning_rate: 0.001 },
      lr_schedule: { name: "constant" },
      regularization: { dropout: null, l2: 0 },
      early_stopping: { enabled: true, patience: 5, min_delta: 0 },
      selection_metric: "val_loss",
      class_weighting: "none",
      augmentation: [],
      transfer: { mode: "scratch" },
      test_fraction: 0,
      purge_chart_windows: true,
      embargo_bars: 0,
    },
    epochs_completed: 12,
    history: [],
    ...over,
  } as TrainingSession;
}

test("the baseline reproduces the recorded run and leaves defaults out", () => {
  const b = baselineFromSession(session());
  assert.deepEqual(b.problems, []);
  assert.equal(b.request.dataset_id, "ds1");
  assert.equal(b.request.random_seed, 7);
  assert.equal(b.request.val_split, 0.2);
  assert.equal(b.request.architecture, undefined, "v1 is the server default");
  assert.equal(b.request.regularization, undefined);
  assert.equal(b.request.label_horizon_bars, undefined, "generator horizon is resolved again by the server");
  assert.equal(b.pricing.dataset_images, 4000);
});

test("every variant changes only its own factor", () => {
  const base = baselineFromSession(session()).request;
  for (const key of ORDER) {
    const v = buildVariant(key, base);
    if (!v.available) continue;
    const { model_name: _a, ...rest } = v.request;
    const { model_name: _b, ...baseRest } = base;
    assert.equal(rest.dataset_id, baseRest.dataset_id, key);
    assert.equal(rest.val_split, baseRest.val_split, key);
    assert.equal(rest.validation_method, baseRest.validation_method, key);
    if (key !== "seed") assert.equal(rest.random_seed, baseRest.random_seed, key);
    if (key !== "epochs") assert.equal(rest.epochs, baseRest.epochs, key);
    assert.ok(v.changed.length >= 1, `${key} reports what changed`);
    assert.notEqual(v.request.model_name, base.model_name);
  }
  assert.deepEqual(buildVariant("smaller", base).changed, ["Architecture: convolve-cnn-v1 → convolve-cnn-compact-v1"]);
  assert.equal(buildVariant("gap", base).request.architecture, "convolve-cnn-gap-v1");
  assert.equal(buildVariant("dense", base).request.architecture, "convolve-cnn-dense32-v1");
  assert.deepEqual(buildVariant("regularize", base).request.regularization, { dropout: 0.3, l2: 1e-4 });
  assert.equal(buildVariant("lr_down", base).request.optimizer?.learning_rate, 0.000333);
});

test("variants that do not apply say why instead of silently changing something else", () => {
  const compact = { ...baselineFromSession(session()).request, architecture: "convolve-cnn-compact-v1" };
  assert.equal(buildVariant("smaller", compact).available, false);
  assert.equal(buildVariant("dense", compact).available, false);
  const adamw = { ...baselineFromSession(session()).request, optimizer: { name: "adamw" as const, learning_rate: 1e-3, weight_decay: 1e-4 } };
  assert.equal(buildVariant("l2", adamw).available, false);
  assert.equal(buildVariant("regularize", adamw).request.regularization?.l2, undefined);
});

test("legacy and folder-trained runs are flagged, and the experiment payload carries the origin", () => {
  const legacy = baselineFromSession(session({ trainer_protocol: 1, dataset: {} }));
  assert.equal(legacy.problems.length, 1);
  assert.equal(legacy.notes.length, 1);
  const v = buildVariant("seed", baselineFromSession(session()).request);
  assert.deepEqual(experimentPayload(v, "r1", "backtest:b1"), {
    parent_run_id: "r1",
    anchor_run_id: "r1",
    variant_key: "seed",
    replicate: 0,
    preset: "seed",
    origin: "backtest:b1",
    changed: ["Seed: 7 → 8"],
  });
});

test("replicates repeat a variant with new seeds and never collide with the original seed", () => {
  const base = baselineFromSession(session()).request;
  assert.equal(buildVariant("seed", base, undefined, 0).request.random_seed, 8);
  assert.equal(buildVariant("seed", base, undefined, 2).request.random_seed, 10);
  const rep = buildVariant("smaller", base, undefined, 1);
  assert.equal(rep.request.random_seed, 8);
  assert.equal(rep.request.architecture, "convolve-cnn-compact-v1");
  assert.match(rep.request.model_name ?? "", /-smaller-r2\.keras$/);
  assert.equal(buildVariant("smaller", base).request.random_seed, 7);
  // A legacy seed experiment (no variant key) counts as the first seed replicate.
  assert.equal(nextReplicate("seed", [{ variant_key: null, replicate: null, is_replicate: true }]), 1);
  assert.equal(nextReplicate("smaller", [{ variant_key: "smaller", replicate: 0 }, { variant_key: "smaller", replicate: 1 }]), 2);
  assert.equal(nextReplicate("gap", []), 0);
});

test("selection status separates validation-only experiments from test-informed ones", () => {
  assert.equal(selectionStatus({ experiment: null }).id, "original");
  const informed = selectionStatus({
    experiment: { version: 1, parent_run_id: "r1", selection: "test_results", created_at: 0, selection_history: [{ kind: "backtest", first_decision: "2024-01-02", last_decision: "2025-06-30" }] },
  });
  assert.equal(informed.id, "test_results");
  assert.match(informed.detail, /2024-01-02 to 2025-06-30/);
});
