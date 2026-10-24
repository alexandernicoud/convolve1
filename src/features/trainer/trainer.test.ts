import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrainerProgressResponse, TrainingSession } from "@/lib/api";
import { elapsedSeconds, epochProgress, fmtPhaseSeconds, isTerminal, marketLabel, nextPollDelay, patienceUsed, remainingUpperBound, stageOf, storeStatus, timingRows } from "./lib";
import { architecturePreview, standardArchitecturePreview } from "./architecture";
import { ema } from "@/lib/viz/smoothing";
import { fmtClock, fmtDuration, fmtInt, fmtNum, fmtPct, fmtPp, MISSING, niceScale, paddedDomain, toCsv } from "@/lib/viz/format";

const session = (over: Partial<TrainingSession>): TrainingSession => ({ run_id: "r", stage: "training", history: [], epochs_completed: 0, ...over }) as TrainingSession;

test("stageOf prefers the session stage and falls back to status/phase", () => {
  assert.equal(stageOf({ status: "running", progress: { phase: "training", percent: 0 }, session: session({ stage: "saving" }) } as TrainerProgressResponse), "saving");
  assert.equal(stageOf({ status: "done", progress: { phase: "done", percent: 1 } } as TrainerProgressResponse), "completed");
  assert.equal(stageOf({ status: "running", progress: { phase: "building", percent: 0.1 } } as TrainerProgressResponse), "initializing");
  assert.equal(stageOf({ status: "running", progress: { phase: "loading", percent: 0.1 } } as TrainerProgressResponse), "preparing");
  assert.equal(stageOf(null), "preparing");
});

test("terminal statuses and store mapping", () => {
  assert.ok(isTerminal("done") && isTerminal("failed") && isTerminal("cancelled"));
  assert.ok(!isTerminal("running") && !isTerminal(undefined));
  assert.equal(storeStatus("done"), "succeeded");
  assert.equal(storeStatus("running"), "running");
});

test("epochProgress reports done of the configured maximum", () => {
  assert.deepEqual(epochProgress(session({ epochs_completed: 6, epochs_total: 30 })), { done: 6, total: 30, fraction: 0.2 });
  assert.deepEqual(epochProgress(session({ epochs_completed: 3 })), { done: 3, total: null, fraction: null });
});

test("elapsed uses server start and stops at finish", () => {
  assert.equal(elapsedSeconds(session({ started_at: 100 }), 160), 60);
  assert.equal(elapsedSeconds(session({ started_at: 100, finished_at: 130 }), 999), 30);
  assert.equal(elapsedSeconds(session({}), 160), null);
});

test("remaining time is an upper bound and needs two measured epochs", () => {
  assert.equal(remainingUpperBound(session({ epochs_completed: 1, epochs_total: 30, mean_epoch_seconds: 10 })), null);
  assert.equal(remainingUpperBound(session({ epochs_completed: 10, epochs_total: 30, mean_epoch_seconds: 12 })), 240);
  assert.equal(remainingUpperBound(session({ epochs_completed: 30, epochs_total: 30, mean_epoch_seconds: 12 })), null);
  assert.equal(remainingUpperBound(session({ epochs_completed: 10, epochs_total: 30 })), null);
});

test("timing rows keep measured phases in order with shares and the largest flagged", () => {
  const rows = timingRows({
    phases: [
      { key: "waiting_for_machine", seconds: 15 },
      { key: "dataset_download", seconds: 0.4 },
      { key: "training", seconds: 580 },
      { key: "validation", seconds: 30 },
    ],
    measured_seconds: 625.4,
  });
  assert.deepEqual(rows.map((r) => r.key), ["waiting_for_machine", "dataset_download", "training", "validation"]);
  assert.equal(rows[0].label, "Waiting for a machine");
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
  assert.deepEqual(rows.filter((r) => r.largest).map((r) => r.key), ["training"]);
  assert.deepEqual(timingRows(null), []);
  assert.deepEqual(timingRows({ phases: [], measured_seconds: 0 }), []);
});

test("phase durations keep sub-second phases visible", () => {
  assert.equal(fmtPhaseSeconds(0.003), "< 0.1 s");
  assert.equal(fmtPhaseSeconds(0.42), "0.4 s");
  assert.equal(fmtPhaseSeconds(5.13), "5.1 s");
  assert.equal(fmtPhaseSeconds(52.6), "53 s");
  assert.equal(fmtPhaseSeconds(634.8), "10 min 35 s");
});

test("patience counts epochs since the best validation loss", () => {
  assert.deepEqual(patienceUsed(session({ epochs_completed: 9, best_epoch: 6 })), { since: 3, patience: 5 });
  assert.equal(patienceUsed(session({ epochs_completed: 9 })), null);
});

test("poll delay backs off on failures and slows when hidden", () => {
  assert.equal(nextPollDelay(0, false), 2000);
  assert.equal(nextPollDelay(0, true), 10000);
  assert.equal(nextPollDelay(1, false), 4000);
  assert.equal(nextPollDelay(10, false), 30000);
});

test("market label joins symbols and timeframe", () => {
  assert.equal(marketLabel({ symbols: ["AAPL", "MSFT"], timeframe: "1d" }), "AAPL, MSFT · 1d");
  assert.equal(marketLabel({}), null);
  assert.equal(marketLabel(undefined), null);
});

test("architecture preview matches the backend parameter count at 224 px", () => {
  const a = standardArchitecturePreview(224, 224);
  assert.equal(a.totalParams, 896 + 18496 + 73856 + (26 * 26 * 128 * 128 + 128) + 129);
  assert.deepEqual(a.layers[a.layers.length - 1].shape, [1]);
  assert.equal(standardArchitecturePreview(8, 8).totalParams, null);
});

test("every profile preview matches Keras count_params at 224 px", () => {
  // Values from backend/runners/cnn_architectures.py complexity() == model.count_params().
  const expected: Record<string, number> = {
    "convolve-cnn-v1": 11_169_089,
    "convolve-cnn-compact-v1": 650_465,
    "convolve-cnn-balanced-v1": 1_462_993,
    "convolve-cnn-deep-v1": 1_355_457,
  };
  for (const [id, params] of Object.entries(expected)) {
    assert.equal(architecturePreview(id, 224, 224).totalParams, params, id);
  }
  assert.equal(architecturePreview("unknown", 224, 224).family, "Convolve standard CNN");
});

test("ema keeps nulls as gaps and is bias-corrected", () => {
  const out = ema([1, null, 1, 1], 0.6);
  assert.equal(out[1], null);
  assert.ok(Math.abs((out[0] as number) - 1) < 1e-12);
  assert.ok(Math.abs((out[3] as number) - 1) < 1e-12);
  assert.deepEqual(ema([0.5, 0.7], 0), [0.5, 0.7]);
});

test("formatters never turn missing values into zero", () => {
  for (const v of [null, undefined, NaN, Infinity, "x"]) {
    assert.equal(fmtPct(v), MISSING);
    assert.equal(fmtNum(v), MISSING);
    assert.equal(fmtInt(v), MISSING);
    assert.equal(fmtDuration(v), MISSING);
    assert.equal(fmtClock(v), MISSING);
    assert.equal(fmtPp(v), MISSING);
  }
  assert.equal(fmtPct(0), "0.0%");
  assert.equal(fmtPp(0.034), "+3.4 pp");
  assert.equal(fmtDuration(185), "3 min 05 s");
  assert.equal(fmtClock(3725), "1:02:05");
});

test("paddedDomain ignores missing values and respects clamps", () => {
  assert.equal(paddedDomain([null, undefined]), undefined);
  const [lo, hi] = paddedDomain([0.5, null, 0.9], { clamp: [0, 1] }) as [number, number];
  assert.ok(lo < 0.5 && lo >= 0 && hi > 0.9 && hi <= 1);
});

test("niceScale snaps to round steps without cutting data", () => {
  const s = niceScale([0.26, 0.79], 5, [0, 1])!;
  assert.deepEqual(s.domain, [0.2, 0.8]);
  assert.deepEqual(s.ticks, [0.2, 0.4, 0.6, 0.8]);
  const l = niceScale([0.33, 2.17])!;
  assert.ok(l.domain[0] <= 0.33 && l.domain[1] >= 2.17);
  assert.equal(niceScale(undefined), undefined);
  assert.equal(niceScale([1, 1]), undefined);
});

test("csv leaves missing cells empty and quotes text", () => {
  assert.equal(toCsv([{ a: 1, b: null }, { a: 'x,"y"', b: NaN }], [{ key: "a" }, { key: "b", label: "B" }]), 'a,B\n1,\n"x,""y""",');
});
