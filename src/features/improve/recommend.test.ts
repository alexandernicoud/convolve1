import { test } from "node:test";
import assert from "node:assert/strict";
import type { ImproveExperiment } from "@/lib/api";
import type { Finding } from "@/features/research/findings";
import { recommend, PURPOSES } from "./recommend";
import { ORDER, unchangedSettings, buildVariant } from "./variants";
import { resultCopy } from "./workspace";

const f = (id: string, severity: Finding["severity"], over: Partial<Finding> = {}): Finding => ({ id, severity, title: id, detail: `${id} detail`, ...over });
const exp = (over: Partial<ImproveExperiment>): ImproveExperiment =>
  ({ run_id: "r", group: "awaiting_decision", is_replicate: false, verdict: { verdict: "pending" }, changed: [], recorded_changes: [], ...over }) as ImproveExperiment;
const noise = (baseline_runs: number, required = 3) => ({ baseline_run_ids: [], baseline_runs, required, seed_sd: null, sufficient: baseline_runs >= required });
const all = () => true;

test("overfitting recommends regularization and keeps observation and hypothesis apart", () => {
  const r = recommend({ findings: [f("overfit", "problem", { evidence: "strong" })], experiments: [], noise: noise(1), available: all });
  assert.equal(r.kind, "diagnosis");
  assert.equal(r.key, "regularize");
  assert.match(r.observed ?? "", /overfit detail/);
  assert.equal(r.evidence, "Strong evidence");
  assert.deepEqual(r.alternatives, ["smaller", "gap"]);
});

test("already-tried fixes move on to the next one", () => {
  const r = recommend({
    findings: [f("overfit", "problem")],
    experiments: [exp({ variant_key: "regularize", group: "archived" })],
    noise: noise(3),
    available: all,
  });
  assert.equal(r.key, "smaller");
});

test("problems outrank warnings; imbalance and instability map to their experiments", () => {
  assert.equal(recommend({ findings: [f("imbalance", "warning"), f("constant", "problem")], experiments: [], noise: noise(1), available: all }).key, "class_weight");
  assert.equal(recommend({ findings: [f("underfit", "problem")], experiments: [], noise: noise(1), available: all }).key, "lr_up");
  assert.equal(recommend({ findings: [f("early-stop", "warning", { title: "Still improving when training ended" })], experiments: [], noise: noise(1), available: all }).key, "epochs");
});

test("undecided experiments without enough seeds ask for a seed replicate first", () => {
  const r = recommend({
    findings: [f("overfit", "problem")],
    experiments: [exp({ variant_key: "regularize", verdict: { verdict: "insufficient_evidence" } as never })],
    noise: noise(1),
    available: all,
  });
  assert.equal(r.kind, "evidence");
  assert.equal(r.key, "seed");
  assert.match(r.observed ?? "", /1 of the 3/);
});

test("no diagnosed problem gives an exploratory test, not an invented diagnosis", () => {
  const r = recommend({ findings: [f("overfit", "ok"), f("auc", "ok")], experiments: [], noise: noise(1), available: all });
  assert.equal(r.kind, "exploratory");
  assert.equal(r.finding, null);
  assert.equal(r.observed, null);
  assert.match(r.hypothesis, /no specific problem/);
});

test("unavailable variants are skipped and a preset from Model Health is respected", () => {
  const r = recommend({ findings: [f("overfit", "problem")], experiments: [], noise: noise(1), available: (k) => k !== "regularize" });
  assert.equal(r.key, "smaller");
  assert.equal(recommend({ findings: [f("overfit", "problem")], experiments: [], noise: noise(1), available: all, preset: "gap" }).key, "gap");
});

test("every variant belongs to exactly one purpose group", () => {
  const keys = PURPOSES.flatMap((p) => p.keys).sort();
  assert.deepEqual(keys, [...ORDER].sort());
});

test("a small positive difference is never presented as an improvement", () => {
  for (const verdict of ["no_clear_difference", "insufficient_evidence"] as const) {
    for (const n of [noise(1), noise(3)]) {
      const c = resultCopy(exp({ variant_key: "smaller", deltas: { roc_auc: 0.007 }, verdict: { verdict } as never }), n);
      assert.notEqual(c.tone, "good");
      assert.notEqual(c.next.kind, "keep");
      assert.doesNotMatch(c.label, /improved/i);
    }
  }
  const small = resultCopy(exp({ variant_key: "smaller", deltas: { roc_auc: 0.007 }, verdict: { verdict: "insufficient_evidence" } as never }), noise(1));
  assert.match(small.meaning, /not enough evidence/);
  assert.equal(small.next.kind, "seed_original");
  assert.equal(resultCopy(exp({ variant_key: "smaller", verdict: { verdict: "insufficient_evidence" } as never }), noise(3)).next.kind, "repeat");
});

test("clear verdicts map to keep and archive", () => {
  assert.equal(resultCopy(exp({ verdict: { verdict: "clearly_improved" } as never }), noise(3)).next.kind, "keep");
  const worse = resultCopy(exp({ verdict: { verdict: "worse" } as never }), noise(3));
  assert.equal(worse.next.kind, "archive");
  assert.equal(worse.tone, "bad");
});

test("unchanged settings omit exactly what a variant changes", () => {
  const base = { dataset_id: "d", image_height: 224, image_width: 224, batch_size: 16, epochs: 30, val_split: 0.2, random_seed: 7 } as never;
  const v = buildVariant("class_weight", base);
  const labels = unchangedSettings(base, v.request).map((r) => r.label);
  assert.ok(labels.includes("Dataset"));
  assert.ok(labels.includes("Seed"));
  assert.ok(!labels.includes("Class weights"));
});
