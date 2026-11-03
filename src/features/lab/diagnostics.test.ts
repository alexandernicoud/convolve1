import { test } from "node:test";
import assert from "node:assert/strict";
import { allZeroCounts, diagnose, improveLink } from "./diagnostics";

const ci = (mean: number, lo: number, hi: number) => ({ mean, lo, hi, n: 50 });
const prop = (p: number, lo: number, hi: number) => ({ p, lo, hi, k: Math.round(p * 50), n: 50 });
const byId = (ds: ReturnType<typeof diagnose>) => Object.fromEntries(ds.map((d) => [d.id, d]));

test("every check reports missing until its experiment has a result", () => {
  const ds = diagnose({}, { splitKnown: true });
  assert.equal(ds.length, 7);
  for (const d of ds) assert.equal(d.state, "missing", d.id);
  assert.equal(byId(diagnose({}, { splitKnown: false })).splits.state, "unavailable");
});

test("faithfulness and random masking read the faithfulness rows", () => {
  const row = (k: number, top: number, rand: number, diffLo: number, winLo: number) => ({
    k,
    masked_fraction: k / 64,
    drop_top: ci(top, top - 0.01, top + 0.01),
    drop_random: ci(rand, rand - 0.01, rand + 0.01),
    drop_bottom: ci(0, -0.01, 0.01),
    top_minus_random: ci(top - rand, diffLo, top - rand + 0.02),
    win_rate: prop(0.7, winLo, 0.8),
  });
  const good = byId(diagnose({ faithfulness: { rows: [row(2, 0.05, 0.01, 0.02, 0.6), row(4, 0.08, 0.02, 0.03, 0.6), row(8, 0.1, 0.03, 0.04, 0.6)], n_all_zero: 3, n_used: 97 } }, { splitKnown: true }));
  assert.equal(good.faithfulness.state, "ok");
  assert.equal(good["random-mask"].state, "info");
  assert.ok(good.faithfulness.details.some((t) => t.includes("3 images were skipped")));

  const inert = byId(diagnose({ faithfulness: { rows: [row(8, 0.002, 0.001, -0.01, 0.4)] } }, { splitKnown: true }));
  assert.equal(inert.faithfulness.state, "unclear");
  assert.equal(inert["random-mask"].state, "attention");
  assert.equal(inert["random-mask"].improve?.preset, "lr");
});

test("old results without the new measurements ask for a rerun instead of guessing", () => {
  const ds = byId(diagnose({ atlas: { profile: { foreground_share: ci(0.3, 0.25, 0.35), foreground_area: ci(0.2, 0.19, 0.21) } }, embedding: { dim: 64, inactive_units: 0 } }, { splitKnown: true }));
  assert.equal(ds.background.state, "rerun");
  assert.equal(ds.splits.state, "rerun");
});

test("border, stability and split checks flag only when intervals clear the reference", () => {
  const atlas = { profile: { foreground_share: ci(0.3, 0.25, 0.35), foreground_area: ci(0.2, 0.19, 0.21), border: { attention: ci(0.4, 0.35, 0.45), ink: ci(0.1, 0.08, 0.12), area: 0.23 } } };
  const stability = { any_flip_confident: prop(0.2, 0.12, 0.3), rows: [{ description: "Shift", abs_delta: ci(0.03, 0.02, 0.04), flip_rate: prop(0.1, 0.05, 0.2) }] };
  const embedding = {
    dim: 64,
    inactive_units: 40,
    splits: { training: { n: 60, accuracy: prop(0.9, 0.82, 0.95), confidence: ci(0.8, 0.78, 0.82) }, validation: { n: 40, accuracy: prop(0.55, 0.4, 0.68), confidence: ci(0.7, 0.68, 0.72) }, centroid_shift: 0.2 },
  };
  const ds = byId(diagnose({ atlas, stability, embedding }, { splitKnown: true }));
  assert.equal(ds.background.state, "attention");
  assert.equal(ds.stability.state, "attention");
  assert.equal(ds.splits.state, "attention");
  assert.equal(ds.splits.improve?.preset, "regularize");
  assert.equal(ds.inactive.state, "attention");

  const calm = byId(diagnose({ stability: { any_flip_confident: prop(0.01, 0, 0.04), rows: [] } }, { splitKnown: true }));
  assert.equal(calm.stability.state, "ok");
  assert.equal(calm.stability.improve, null);
});

test("all-zero counts and Improve links", () => {
  assert.deepEqual(allZeroCounts({ atlas: { n_all_zero: 4, n_used: 196 } }), [{ kind: "atlas", zero: 4, of: 200 }]);
  assert.equal(improveLink("uploaded", "m1", null, "gap"), null);
  assert.equal(improveLink("trained", "r1", "lab_x", "gap"), "/tools/improve?model=trained%3Ar1&from=analysis%3Alab_x&preset=gap");
});
