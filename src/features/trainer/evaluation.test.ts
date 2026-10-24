import { test } from "node:test";
import assert from "node:assert/strict";
import type { PartitionMetrics, TrainingSession } from "@/lib/api";
import { findings, histogramShares, metricRows, selectionName, stoppingText, versusBaseline } from "./evaluation";
import { architecturePreview } from "./architecture";

// Shape of eval_metrics.binary_metrics(): the GAP run of the benchmark, which predicted label 1 everywhere.
const constantModel: PartitionMetrics = {
  n: 388,
  label_counts: { "0": 226, "1": 162 },
  predicted_counts: { "0": 0, "1": 388 },
  confusion_matrix: { labels: [0, 1], rows_true_cols_pred: [[0, 226], [0, 162]] },
  accuracy: 0.4175,
  balanced_accuracy: 0.5,
  precision: 0.4175,
  recall: 1,
  f1: 0.589,
  roc_auc: 0.5076,
  pr_auc: 0.4267,
  pr_auc_no_skill: 0.4175,
  log_loss: 0.7798,
  brier: 0.2919,
  undefined: {},
  baseline: { source: "training labels", majority_label: 1, tie: false, accuracy: 0.4175, balanced_accuracy: 0.5, prior_label_1: 0.548, log_loss: 0.7137, brier: 0.2602 },
};

test("metric rows pair each metric with the constant baseline", () => {
  const rows = Object.fromEntries(metricRows(constantModel).map((r) => [r.key, r]));
  assert.equal(rows.accuracy.baseline, 0.4175);
  assert.equal(rows.roc_auc.baseline, 0.5);
  assert.equal(rows.pr_auc.baseline, 0.4175);
  assert.equal(rows.log_loss.lowerIsBetter, true);
  assert.equal(rows.precision.baseline, null);
  assert.equal(versusBaseline(rows.accuracy), "equal");
  assert.equal(versusBaseline(rows.log_loss), "worse");
  assert.equal(versusBaseline(rows.roc_auc), "better");
  assert.equal(versusBaseline(rows.f1), null);
});

test("findings call out a constant predictor and do not credit it with skill", () => {
  const f = findings(constantModel);
  assert.match(f[0], /predicted label 1 for every chart/);
  assert.match(f[0], /majority baseline/);
  assert.ok(f.some((s) => /is not above/.test(s)));
  assert.ok(f.some((s) => /not lower than the constant baseline/.test(s)));
});

test("accuracy above 50% but below the baseline is reported as not above it", () => {
  const m: PartitionMetrics = {
    ...constantModel,
    predicted_counts: { "0": 100, "1": 288 },
    accuracy: 0.55,
    baseline: { ...constantModel.baseline, accuracy: 0.6, majority_label: 0 },
  };
  const s = findings(m).find((x) => x.startsWith("Accuracy"))!;
  assert.match(s, /not above the 60\.0%/);
  assert.match(s, /even though it is above 50%/);
});

test("accuracy above the baseline without balanced accuracy above 50% is not credited", () => {
  // UI run: validation label 1 fell to 42% from 55% in training; the model predicted more label 0.
  const m: PartitionMetrics = {
    n: 388,
    label_counts: { "0": 226, "1": 162 },
    predicted_counts: { "0": 264, "1": 124 },
    accuracy: 0.521,
    balanced_accuracy: 0.491,
    baseline: { majority_label: 1, accuracy: 0.418, balanced_accuracy: 0.5, prior_label_1: 0.548 },
  };
  const s = findings(m).find((x) => x.startsWith("Accuracy"))!;
  assert.match(s, /balanced accuracy is 49\.1%/);
  assert.match(s, /Label 1 is 41\.8% of this partition against 54\.8%/);

  const skilled = findings({ ...m, balanced_accuracy: 0.56 }).find((x) => x.startsWith("Accuracy"))!;
  assert.doesNotMatch(skilled, /constant guess/);
});

test("absent classes: undefined metrics carry their reason and no comparison", () => {
  const m: PartitionMetrics = {
    n: 10,
    label_counts: { "0": 10, "1": 0 },
    predicted_counts: { "0": 7, "1": 3 },
    accuracy: 0.7,
    roc_auc: null,
    balanced_accuracy: null,
    undefined: { roc_auc: "only one class present", balanced_accuracy: "only one class present" },
    baseline: { majority_label: 0, accuracy: 1, balanced_accuracy: null },
  };
  const auc = metricRows(m).find((r) => r.key === "roc_auc")!;
  assert.equal(auc.model, null);
  assert.equal(auc.baseline, null);
  assert.equal(auc.undefinedReason, "only one class present");
  assert.equal(versusBaseline(auc), null);
});

test("a lower log loss is not read as skill on its own", () => {
  // Benchmark compact run: lower log loss than the training-prior baseline, but ROC-AUC below 0.5.
  const m: PartitionMetrics = { ...constantModel, predicted_counts: { "0": 236, "1": 152 }, log_loss: 0.6949, roc_auc: 0.469 };
  const s = findings(m).find((x) => x.startsWith("Log loss"))!;
  assert.match(s, /lower than the constant baseline/);
  assert.match(s, /ROC-AUC separates the two/);
  assert.doesNotMatch(s, /information|skill/);
});

test("a reserved, unscored test partition yields no findings", () => {
  assert.deepEqual(findings({ n: 436, status: "reserved_not_evaluated" }), []);
});

test("histogram shares are per true label", () => {
  const bins = histogramShares({ edges: [0, 0.5, 1], label_0: [3, 1], label_1: [0, 2] });
  assert.deepEqual(bins, [
    { from: 0, to: 0.5, label0: 0.75, label1: 0 },
    { from: 0.5, to: 1, label0: 0.25, label1: 1 },
  ]);
});

test("selection and stopping wording", () => {
  assert.equal(selectionName(null), "validation loss");
  assert.equal(selectionName({ selection_metric: { name: "val_auc", mode: "max" } }), "validation ROC-AUC");
  const s = { stopping: { reason: "early_stopping", detail: "No improvement of val_auc by more than 0 for 5 epochs" } } as unknown as TrainingSession;
  assert.equal(stoppingText(s), "Early stopping: No improvement of validation auc by more than 0 for 5 epochs.");
  const withOptions = {
    stopping: { reason: "early_stopping", monitor: "val_balanced_accuracy", detail: "x" },
    options: { early_stopping: { enabled: true, patience: 5, min_delta: 0 } },
  } as unknown as TrainingSession;
  assert.equal(stoppingText(withOptions), "Early stopping: 5 epochs without a better validation balanced accuracy.");
  const legacy = { summary: { stopped_early: false } } as unknown as TrainingSession;
  assert.equal(stoppingText(legacy), "Ran to the configured maximum epochs.");
});

test("builder architectures preview their stages and size-independent parameter count", () => {
  const entry = { id: "convolve-resnet18-v1", label: "ResNet18-style", family: "builder", stages: ["a", "b"], parameters_224: 11186625, min_input: 64 };
  const p = architecturePreview("convolve-resnet18-v1", 128, 128, entry);
  assert.deepEqual(p.stages, ["a", "b"]);
  assert.equal(p.totalParams, 11186625);
  assert.equal(architecturePreview("convolve-resnet18-v1", 48, 48, entry).totalParams, null);
  assert.equal(architecturePreview("convolve-cnn-compact-v1", 224, 224).family, "Compact");
});
