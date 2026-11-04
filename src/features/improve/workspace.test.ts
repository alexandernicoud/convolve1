import { test } from "node:test";
import assert from "node:assert/strict";
import type { ImproveExperiment, InternalModel } from "@/lib/api";
import { byGroup, changeLines, isActive, suggestion } from "./workspace";
import { candidatesLast, lifecycleSuffix } from "@/lib/modelLifecycle";
import { libraryModels } from "@/features/trainer/libraryModels";
import { recommendedExperiment } from "@/features/trainer/improveRecommendation";
import type { Finding } from "@/features/research/findings";

const exp = (over: Partial<ImproveExperiment>): ImproveExperiment =>
  ({ run_id: "r", group: "awaiting_decision", is_replicate: false, verdict: { verdict: "pending" }, changed: [], recorded_changes: [], ...over }) as ImproveExperiment;

test("suggestions follow the server verdict and never auto-keep without clear evidence", () => {
  assert.equal(suggestion(exp({ verdict: { verdict: "clearly_improved" } as never })).action, "keep");
  assert.equal(suggestion(exp({ verdict: { verdict: "worse" } as never })).action, "discard");
  assert.equal(suggestion(exp({ verdict: { verdict: "no_clear_difference" } as never })).action, "discard");
  assert.equal(suggestion(exp({ verdict: { verdict: "insufficient_evidence" } as never })).action, "replicate");
  assert.equal(suggestion(exp({ group: "kept", verdict: { verdict: "clearly_improved" } as never })).action, null);
  assert.equal(suggestion(exp({ is_replicate: true, verdict: { verdict: "replicate" } as never })).action, "discard");
});

test("grouping and polling", () => {
  const list = [exp({ run_id: "a" }), exp({ run_id: "b", group: "running" }), exp({ run_id: "c", group: "archived" })];
  const g = byGroup(list);
  assert.deepEqual(g.awaiting_decision.map((e) => e.run_id), ["a"]);
  assert.deepEqual(g.archived.map((e) => e.run_id), ["c"]);
  assert.equal(isActive(list), true);
  assert.equal(isActive([exp({ group: "kept" })]), false);
});

test("change lines prefer the server diff", () => {
  const e = exp({ changed: [{ setting: "seed", label: "Seed", from: 1, to: 2 }] as never, recorded_changes: ["x"] });
  assert.deepEqual(changeLines(e), ["Seed: 1 → 2"]);
  assert.deepEqual(changeLines(exp({ recorded_changes: ["Architecture: a → b"] })), ["Architecture: a → b"]);
});

const model = (over: Partial<InternalModel>): InternalModel =>
  ({ model_id: "m", kind: "trained", training_run_id: "r", metadata_available: true, ...over }) as InternalModel;

test("trainer model list hides candidates and archived models, newest first", () => {
  const rows = libraryModels([
    model({ model_id: "old", training_run_id: "old", created_at: 100 }),
    model({ model_id: "new", training_run_id: "new", created_at: 200 }),
    model({ model_id: "cand", training_run_id: "cand", lifecycle: "candidate" }),
    model({ model_id: "arch", training_run_id: "arch", archived: true }),
    model({ model_id: "kept", training_run_id: "kept", lifecycle: "kept", created_at: 150 }),
    model({ model_id: "up", kind: "uploaded", training_run_id: null }),
  ]);
  assert.deepEqual(rows.map((m) => m.model_id), ["new", "kept", "old"]);
});

test("pickers label candidates and list them last", () => {
  assert.match(lifecycleSuffix({ lifecycle: "candidate", improve: null }), /candidate/);
  assert.equal(lifecycleSuffix({ lifecycle: "model", improve: null }), "");
  const ordered = candidatesLast([{ lifecycle: "candidate" as const, id: 1 }, { lifecycle: "model" as const, id: 2 }]);
  assert.deepEqual(ordered.map((m) => m.id), [2, 1]);
});

test("the trainer callout recommends the most severe Model Health experiment", () => {
  const f = (severity: string, to?: string) => ({ id: severity, severity, title: severity, action: to ? { label: `do ${severity}`, to } : undefined }) as unknown as Finding;
  const rec = recommendedExperiment([f("info", "/tools/improve?preset=a"), f("warning", "/tools/improve?preset=w"), f("problem", "/tools/improve?preset=p"), f("problem", "/tools/analysis")]);
  assert.equal(rec?.to, "/tools/improve?preset=p");
  assert.equal(recommendedExperiment([f("info", "/tools/improve?preset=a")]), null);
});
