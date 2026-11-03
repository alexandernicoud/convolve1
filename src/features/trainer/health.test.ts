import assert from "node:assert/strict";
import test from "node:test";
import type { TrainingSession } from "@/lib/api";
import { aucStdError, classRecalls, modelHealth } from "./health";

const epochs = (rows: [number, number, number, number][]) =>
  rows.map(([loss, accuracy, val_loss, val_accuracy], i) => ({ epoch: i + 1, loss, accuracy, val_loss, val_accuracy }));

const session = (over: Partial<TrainingSession> = {}): TrainingSession =>
  ({
    run_id: "r1",
    stage: "completed",
    dataset: {},
    config: { use_standard_config: true },
    epochs_completed: 6,
    epochs_total: 20,
    best_epoch: 3,
    history: epochs([
      [0.69, 0.52, 0.69, 0.51],
      [0.66, 0.6, 0.67, 0.58],
      [0.62, 0.64, 0.66, 0.6],
      [0.58, 0.67, 0.665, 0.6],
      [0.55, 0.69, 0.67, 0.59],
      [0.53, 0.7, 0.68, 0.59],
    ]),
    train_label_counts: { "0": 500, "1": 500 },
    evaluation: {
      validation: {
        n: 400,
        accuracy: 0.6,
        balanced_accuracy: 0.6,
        roc_auc: 0.66,
        pr_auc: 0.62,
        pr_auc_no_skill: 0.5,
        brier: 0.23,
        log_loss: 0.65,
        mean_probability: 0.5,
        label_counts: { "0": 200, "1": 200 },
        predicted_counts: { "0": 210, "1": 190 },
        confusion_matrix: { labels: [0, 1], rows_true_cols_pred: [[125, 75], [85, 115]] },
        baseline: { accuracy: 0.5, brier: 0.25, log_loss: 0.693 },
      },
    },
    architecture: {
      family: "cnn",
      loss: "bce",
      total_params: 100_000,
      layers: [
        { name: "conv1", shape: null, params: 20_000, type: "Conv2D" },
        { name: "dense", shape: null, params: 80_000, type: "Dense" },
      ],
    },
    train_samples: 1000,
    ...over,
  }) as TrainingSession;

const byId = (s: TrainingSession) => Object.fromEntries(modelHealth(s, "r1").map((f) => [f.id, f]));

test("a modest healthy run reports ranking skill with an interval and no problems", () => {
  const f = byId(session());
  assert.equal(f.auc.severity, "ok");
  assert.match(f.auc.detail, /95% interval/);
  assert.equal(f.calibration.severity, "ok");
  assert.ok(!Object.values(f).some((x) => x.severity === "problem"));
  assert.equal(f.channels.evidence, "inconclusive", "inactive channels are not claimed from training records");
});

test("a large train/validation gap with rising validation loss is strong evidence of overfitting", () => {
  const f = byId(
    session({
      best_epoch: 2,
      history: epochs([
        [0.69, 0.55, 0.68, 0.55],
        [0.6, 0.7, 0.66, 0.65],
        [0.45, 0.8, 0.7, 0.57],
        [0.3, 0.88, 0.76, 0.56],
        [0.2, 0.93, 0.82, 0.55],
      ]),
    }),
  );
  assert.equal(f.overfit.severity, "warning", "only the rising validation loss signal is present");
  const late = byId(
    session({
      best_epoch: 5,
      summary: { saved_weights_epoch: 5 },
      history: epochs([
        [0.69, 0.55, 0.68, 0.55],
        [0.6, 0.7, 0.66, 0.58],
        [0.45, 0.8, 0.7, 0.57],
        [0.3, 0.88, 0.76, 0.56],
        [0.2, 0.93, 0.82, 0.55],
      ]),
    }),
  );
  assert.equal(late.overfit.severity, "problem");
  assert.equal(late.overfit.evidence, "strong");
  assert.match(late.overfit.action!.to!, /preset=regularize/);
});

test("constant predictions and no ranking skill are labelled with the right evidence", () => {
  const f = byId(
    session({
      evaluation: {
        validation: {
          n: 400,
          accuracy: 0.55,
          roc_auc: 0.51,
          label_counts: { "0": 220, "1": 180 },
          predicted_counts: { "0": 400, "1": 0 },
          confusion_matrix: { labels: [0, 1], rows_true_cols_pred: [[220, 0], [180, 0]] },
          brier: 0.26,
          baseline: { accuracy: 0.55, brier: 0.25 },
        },
      },
    }),
  );
  assert.equal(f.constant.evidence, "confirmed");
  assert.equal(f.auc.evidence, "inconclusive");
  assert.equal(f["per-class"].evidence, "confirmed");
  assert.equal(f.calibration.title, "Probabilities are no better than the base rate");
});

test("a dominant dense layer suggests the GAP comparison", () => {
  const f = byId(session({ architecture: { family: "cnn", loss: "bce", total_params: 1_000_000, layers: [{ name: "conv", shape: null, params: 50_000 }, { name: "dense_1", shape: null, params: 950_000, type: "Dense" }] } }));
  assert.equal(f.params.severity, "warning");
  assert.match(f.params.action!.to!, /preset=gap/);
});

test("AUC standard error and class recalls", () => {
  const se = aucStdError(0.7, 100, 100)!;
  assert.ok(se > 0.03 && se < 0.05);
  const r = classRecalls({ n: 10, confusion_matrix: { labels: [0, 1], rows_true_cols_pred: [[8, 2], [5, 5]] } });
  assert.equal(r.r0, 0.8);
  assert.equal(r.r1, 0.5);
});
