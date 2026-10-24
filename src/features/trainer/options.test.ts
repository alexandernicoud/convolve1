import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OPTIONS,
  OPTIMIZER_DEFAULTS,
  SCHEDULE_DEFAULTS,
  changedSections,
  describeOptions,
  optionsProblem,
  optionsRequest,
  type AdvancedOptions,
} from "./options";
import type { TrainerArchitecture } from "@/lib/api";

const arch = (over: Partial<TrainerArchitecture> = {}): TrainerArchitecture => ({
  id: "v1",
  label: "Original (v1)",
  description: "",
  experimental: false,
  default: true,
  parameters_224: 1,
  forward_gflops_224: 1,
  ...over,
});

const opts = (over: Partial<AdvancedOptions> = {}): AdvancedOptions => ({ ...DEFAULT_OPTIONS, ...over });

test("defaults send no option fields, so the server's defaults apply", () => {
  assert.deepEqual(optionsRequest(DEFAULT_OPTIONS), {});
  assert.equal(changedSections(DEFAULT_OPTIONS, 7).size, 0);
  assert.equal(optionsProblem(DEFAULT_OPTIONS, arch()), null);
});

test("new runs default to chronological validation with no test period", () => {
  assert.equal(DEFAULT_OPTIONS.validation_method, "chronological");
  assert.equal(DEFAULT_OPTIONS.test_fraction, 0);
  assert.equal(DEFAULT_OPTIONS.evaluate_test, false);
  assert.equal(DEFAULT_OPTIONS.purge_chart_windows, true);
  assert.deepEqual(DEFAULT_OPTIONS.augmentation, []);
});

test("random validation is sent explicitly and marks the validation section changed", () => {
  const o = opts({ validation_method: "random" });
  assert.deepEqual(optionsRequest(o), { validation_method: "random" });
  assert.ok(changedSections(o, 7).has("validation"));
});

test("evaluate_test is only sent with a reserved test period", () => {
  assert.deepEqual(optionsRequest(opts({ evaluate_test: true })), {});
  assert.deepEqual(optionsRequest(opts({ test_fraction: 0.15 })), { test_fraction: 0.15 });
  assert.deepEqual(optionsRequest(opts({ test_fraction: 0.15, evaluate_test: true })), { test_fraction: 0.15, evaluate_test: true });
});

test("a label horizon is sent with its bar size; the bar size alone is not", () => {
  assert.deepEqual(optionsRequest(opts({ label_timeframe: "1wk" })), {});
  assert.deepEqual(optionsRequest(opts({ label_horizon_bars: 4, label_timeframe: "1wk" })), { label_horizon_bars: 4, label_timeframe: "1wk" });
});

test("optimizer defaults are omitted but any change sends the full optimizer", () => {
  assert.deepEqual(optionsRequest(opts({ optimizer: { ...OPTIMIZER_DEFAULTS.adam } })), {});
  assert.deepEqual(optionsRequest(opts({ optimizer: { name: "adam", learning_rate: 3e-4 } })), {
    optimizer: { name: "adam", learning_rate: 3e-4 },
  });
  const sgd = optionsRequest(opts({ optimizer: OPTIMIZER_DEFAULTS.sgd }));
  assert.deepEqual(sgd.optimizer, OPTIMIZER_DEFAULTS.sgd);
});

test("schedule, regularization, early stopping, imbalance, augmentation and transfer", () => {
  const req = optionsRequest(
    opts({
      lr_schedule: SCHEDULE_DEFAULTS.cosine,
      dropout: 0.3,
      l2: 1e-4,
      early_stopping: { enabled: true, patience: 8, min_delta: 0 },
      selection_metric: "val_auc",
      class_weighting: "balanced",
      augmentation: ["vertical_shift", "pixel_noise"],
      transfer: { mode: "frozen", trainable_layers: 20 },
    }),
  );
  assert.deepEqual(req, {
    lr_schedule: { name: "cosine", alpha: 0 },
    regularization: { dropout: 0.3, l2: 1e-4 },
    early_stopping: { enabled: true, patience: 8, min_delta: 0 },
    selection_metric: "val_auc",
    class_weighting: "balanced",
    augmentation: ["pixel_noise", "vertical_shift"],
    transfer: { mode: "frozen" },
  });
});

test("fine-tuning sends the number of trainable layers", () => {
  assert.deepEqual(optionsRequest(opts({ transfer: { mode: "fine_tune", trainable_layers: 30 } })).transfer, {
    mode: "fine_tune",
    trainable_layers: 30,
  });
});

test("client checks mirror the server's rejections", () => {
  assert.match(optionsProblem(opts({ optimizer: OPTIMIZER_DEFAULTS.adamw, l2: 1e-4 }))!, /AdamW/);
  assert.equal(optionsProblem(opts({ optimizer: { ...OPTIMIZER_DEFAULTS.adamw, weight_decay: 0 }, l2: 1e-4 })), null);
  assert.match(optionsProblem(opts({ transfer: { mode: "frozen", trainable_layers: 20 } }), arch())!, /pretrained/);
  assert.equal(
    optionsProblem(opts({ transfer: { mode: "frozen", trainable_layers: 20 } }), arch({ supports_transfer: true })),
    null,
  );
  assert.match(optionsProblem(opts({ test_fraction: 0.5 }))!, /test share/);
  assert.match(optionsProblem(opts({ optimizer: { name: "adam", learning_rate: 0 } }))!, /learning rate/);
  assert.match(optionsProblem(opts({ dropout: 0.9 }))!, /Dropout/);
});

test("seed changes mark reproducibility; review lists the reserved test period", () => {
  assert.ok(changedSections(DEFAULT_OPTIONS, 11).has("reproducibility"));
  const lines = describeOptions(opts({ test_fraction: 0.15 }), 7);
  assert.ok(lines.some((l) => l.includes("15% reserved") && l.includes("not evaluated")));
  assert.ok(lines.includes("Seed 7"));
});
