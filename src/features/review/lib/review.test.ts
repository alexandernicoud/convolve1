import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewDataset, ReviewModel, ReviewOverviewResponse, ReviewRun } from "@/lib/api";
import { classBalance, formatDuration, num, pctFrac, pctUnits } from "./format";
import { datasetName, disambiguate, isOpaqueName, modelName, runName } from "./naming";
import { buildGraph, COLUMNS, layoutGraph, lineageOf, stockEdges } from "./graph";
import { edgePath } from "./graphLayout";
import { modelActions, nodeActions } from "./nodeActions";
import { producedListedAsset } from "./runs";
import { compareBacktests, compareModels } from "./compare";

const model = (over: Partial<ReviewModel>): ReviewModel => ({
  id: "20260101_000000_abcdef12",
  source: "trained",
  metadata_available: true,
  ...over,
});

const run = (over: Partial<ReviewRun>): ReviewRun => ({
  id: "r1",
  tool: "backtester",
  status: "succeeded",
  progress: 100,
  stage: "",
  message: "",
  created_at: 1,
  updated_at: 1,
  links: {},
  details: {},
  ...over,
});

test("missing values render as an em dash, never as zero", () => {
  assert.equal(num(undefined), "—");
  assert.equal(num(null), "—");
  assert.equal(num(NaN), "—");
  assert.equal(pctFrac(undefined), "—");
  assert.equal(pctUnits(null), "—");
  assert.equal(formatDuration(null), "—");
  assert.equal(num(0), "0.00");
  assert.equal(pctFrac(0.574), "57.4%");
});

test("class balance shares and empty distributions", () => {
  assert.deepEqual(classBalance(null), []);
  assert.deepEqual(classBalance({ "0": 0 }), []);
  const b = classBalance({ "1": 25, "0": 75 });
  assert.equal(b[0].label, "0");
  assert.equal(b[0].share, 0.75);
});

test("model names derive from metadata; user names win", () => {
  const m = model({ symbols: "aapl", timeframe: "1d", take_profit_fraction: 0.02, stop_loss_fraction: 0.01, horizon_bars: 7 });
  assert.equal(modelName(m).title, "AAPL · 1D · TP2/SL1 · H7 · CNN");
  assert.equal(modelName({ ...m, display_name: "My best" }).title, "My best");
  assert.equal(modelName({ ...m, display_name: "My best" }).derived, "AAPL · 1D · TP2/SL1 · H7 · CNN");
  const bare = modelName(model({ name: "model_20260101_000000_abc.keras", source: "uploaded" }));
  assert.ok(bare.opaque);
  assert.match(bare.title, /^Uploaded CNN /);
  assert.equal(modelName(model({ symbols: "A,B,C,D,E", timeframe: "1h" })).title, "A,B,C+2 · 1H · CNN");
});

test("dataset names keep user-given names and mark archives", () => {
  const base: ReviewDataset = { id: "generated:g1", kind: "training", source: "generated", representation: "archive", symbols: "MSFT", timeframe: "1d" };
  assert.equal(datasetName(base).title, "MSFT · 1D · Training set archive");
  assert.equal(datasetName({ ...base, id: "d1", representation: "extracted", name: "Q3 holdout", kind: "test" }).title, "Q3 holdout · MSFT · 1D");
  assert.ok(isOpaqueName("dataset_20260101_000000_abc"));
  assert.ok(!isOpaqueName("Q3 holdout"));
});

test("run names use linked model titles", () => {
  const titles = new Map([["t1", "AAPL · 1D · CNN"]]);
  assert.equal(runName(run({ links: { trainer_run_id: "t1" }, backtest: { assumptions: {}, symbol: "AAPL" } }), titles).title, "Backtest · AAPL · AAPL · 1D · CNN");
  assert.match(runName(run({ id: "abcdef123456", tool: "analysis" })).title, /^Analysis 123456$/);
});

test("disambiguation appends stable id suffixes only on collision", () => {
  const out = disambiguate(
    [{ id: "aaaa1111" }, { id: "bbbb2222" }, { id: "cccc3333" }],
    (x) => (x.id === "cccc3333" ? "Other" : "Same"),
  );
  assert.equal(out.get("aaaa1111"), "Same · 1111");
  assert.equal(out.get("bbbb2222"), "Same · 2222");
  assert.equal(out.get("cccc3333"), "Other");
});

const overview: Pick<ReviewOverviewResponse, "runs" | "models" | "datasets" | "bots" | "edges"> = {
  runs: [run({ id: "g1", tool: "training-chart-generator" }), run({ id: "t1", tool: "trainer" }), run({ id: "b1", tool: "backtester" }), run({ id: "o1", tool: "labeling-optimizer" })],
  models: [model({ id: "t1" })],
  datasets: [{ id: "generated:g1", kind: "training", source: "generated", representation: "archive" }],
  bots: [],
  edges: [
    { source: "run:g1", target: "dataset:generated:g1", relation: "produced", provenance: "recorded", basis: "x" },
    { source: "dataset:generated:g1", target: "run:t1", relation: "trained_on", provenance: "recovered", basis: "y" },
    { source: "run:t1", target: "model:t1", relation: "produced", provenance: "recorded", basis: "z" },
    { source: "model:t1", target: "run:b1", relation: "backtested", provenance: "recorded", basis: "w" },
    { source: "model:gone", target: "run:b1", relation: "backtested", provenance: "recorded", basis: "v" },
  ],
};

test("graph keeps only reported edges and marks missing endpoints unresolved", () => {
  const g = buildGraph(overview);
  assert.equal(g.edges.length, 5);
  assert.equal(g.nodes.get("model:gone")?.unresolved, true);
  assert.equal(g.nodes.get("dataset:generated:g1")?.kind, "archive");
  assert.equal(g.nodes.get("run:o1")?.kind, "optimizer");
  const lin = lineageOf(g, "model:t1");
  assert.ok(lin.has("run:g1") && lin.has("run:b1"));
  assert.ok(!lin.has("run:o1"), "unconnected runs are not part of a lineage");
});

test("layout places stages left to right without overlap", () => {
  const g = buildGraph(overview);
  const keys = new Set(g.nodes.keys());
  const l = layoutGraph(g, keys);
  assert.equal(l.pos.size, keys.size);
  assert.ok(l.pos.get("run:g1")!.x < l.pos.get("run:t1")!.x);
  assert.ok(l.pos.get("run:t1")!.x < l.pos.get("model:t1")!.x);
  const seen = new Set<string>();
  for (const p of l.pos.values()) {
    const k = `${p.x},${p.y}`;
    assert.ok(!seen.has(k), "nodes overlap");
    seen.add(k);
  }
});

test("stocks come only from recorded run configurations and are never duplicated", () => {
  const data = {
    ...overview,
    runs: [
      ...overview.runs.map((r) => (r.id === "g1" ? { ...r, generator: { config: { symbols: "aapl, MSFT,AAPL" } } } : r.id === "o1" ? { ...r, optimizer: { config: { symbol: "AAPL" } } } : r)),
    ],
  } as typeof overview;
  const se = stockEdges(data);
  assert.deepEqual(
    se.map((e) => `${e.source}>${e.target}`).sort(),
    ["stock:AAPL>run:g1", "stock:AAPL>run:o1", "stock:MSFT>run:g1"],
  );
  const g = buildGraph(data);
  assert.equal([...g.nodes.keys()].filter((k) => k === "stock:AAPL").length, 1);
  assert.equal(g.nodes.get("stock:AAPL")?.kind, "stock");
  // Lineage walks up and down from the selection only: a model's lineage includes its stock but
  // not the sibling label search that merely shares that stock.
  const lin = lineageOf(g, "model:t1");
  assert.ok(lin.has("stock:AAPL"));
  assert.ok(!lin.has("run:o1"));
});

test("layout uses eight columns, keeps order and scales to hundreds of nodes without overlap", () => {
  const runs: ReviewRun[] = [];
  const models: ReviewModel[] = [];
  const edges: ReviewOverviewResponse["edges"] = [];
  for (let i = 0; i < 60; i++) {
    runs.push(run({ id: `g${i}`, tool: "training-chart-generator", generator: { config: { symbols: `S${i % 7}` } } }));
    for (let j = 0; j < 2; j++) {
      const t = `t${i}_${j}`;
      runs.push(run({ id: t, tool: "trainer" }), run({ id: `b${t}`, tool: "backtester" }));
      models.push(model({ id: t }));
      edges.push(
        { source: `run:g${i}`, target: `run:${t}`, relation: "trained_on", provenance: "recorded", basis: "" },
        { source: `run:${t}`, target: `model:${t}`, relation: "produced", provenance: "recorded", basis: "" },
        { source: `model:${t}`, target: `run:b${t}`, relation: "backtested", provenance: "recorded", basis: "" },
      );
    }
  }
  const g = buildGraph({ runs, models, datasets: [], bots: [], edges });
  assert.ok(g.nodes.size > 400);
  const t0 = Date.now();
  const l = layoutGraph(g, new Set(g.nodes.keys()));
  assert.ok(Date.now() - t0 < 3000, "layout stays interactive");
  assert.equal(l.columns.length, COLUMNS.length);
  assert.equal(COLUMNS.length, 8);
  // Same column and lane: boxes must not overlap vertically.
  const byX = new Map<number, number[]>();
  for (const p of l.pos.values()) byX.set(p.x, [...(byX.get(p.x) ?? []), p.y]);
  for (const ys of byX.values()) {
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 58, "nodes overlap");
  }
  assert.ok(l.pos.get("stock:S0")!.x < l.pos.get("run:g0")!.x);
  assert.ok(l.pos.get("model:t0_0")!.x < l.pos.get("run:bt0_0")!.x);
  // A generator with two trainer children sits between them.
  const [a, b, p] = [l.pos.get("run:t5_0")!.y, l.pos.get("run:t5_1")!.y, l.pos.get("run:g5")!.y];
  assert.ok(p >= Math.min(a, b) - 1 && p <= Math.max(a, b) + 1, "parent centred on its children");
  for (const e of g.edges) assert.match(edgePath(e, l), /^M/);
});

test("model actions preload the model on each target page", () => {
  const m = model({ id: "t1", training_run_id: "t1" });
  const acts = modelActions(m);
  const by = Object.fromEntries(acts.map((a) => [a.id, a.to]));
  assert.equal(by.analyze, "/tools/analysis?model=trained%3At1");
  assert.match(by.backtest!, /^\/tools\/backtester\?/);
  assert.match(by.backtest!, /t1/);
  assert.match(by.deploy!, /^\/tools\/deploy\?/);
  assert.equal(by.improve, "/tools/improve?model=trained%3At1&from=search-hub");
  assert.ok(acts.some((a) => a.id === "details" && a.details));
  const uploaded = modelActions(model({ id: "u1", source: "uploaded" }));
  assert.ok(!uploaded.some((a) => a.id === "improve"), "only trained models can be retrained");
  const g = buildGraph(overview);
  const ctx = {
    graph: g,
    model: (id?: string | null) => (id === "t1" ? m : null),
    run: (id: string) => overview.runs.find((r) => r.id === id) ?? null,
    dataset: () => null,
    runRoute: (r: ReviewRun) => `/run/${r.id}`,
  };
  const bt = nodeActions(g.nodes.get("run:b1")!, ctx);
  assert.equal(bt.find((a) => a.id === "improve")?.to, "/tools/improve?model=trained%3At1&from=backtest%3Ab1");
});

test("runs that produced a listed model or dataset are folded out of Runs", () => {
  const data = { models: [model({ id: "t1", training_run_id: "t1" })], datasets: [{ id: "generated:g1", kind: "training" as const, source: "generated" as const, representation: "archive" as const, generator_run_id: "g1" }] };
  assert.ok(producedListedAsset(run({ id: "t1", tool: "trainer" }), data));
  assert.ok(producedListedAsset(run({ id: "g1", tool: "training-chart-generator" }), data));
  assert.ok(!producedListedAsset(run({ id: "t2", tool: "trainer", status: "failed" }), data));
  assert.ok(!producedListedAsset(run({ id: "b1", tool: "backtester" }), data));
});

test("backtest comparison warns on differing assumptions and suppresses deltas", () => {
  const a = run({ id: "a", backtest: { assumptions: { commission_pct: 0.1 }, period: { start: "2025-01-01", end: "2025-12-31" }, performance: { return_pct: 5 } } });
  const b = run({ id: "b", backtest: { assumptions: { commission_pct: 0.2 }, period: { start: "2025-01-01", end: "2025-12-31" }, performance: { return_pct: 7 } } });
  const c = compareBacktests([a, b], () => "m");
  assert.equal(c.comparable, false);
  assert.ok(c.warnings.some((w) => w.field === "Commission %"));
  assert.equal(c.rows.find((r) => r.def.key === "return_pct")!.deltas, null);
  assert.ok(!c.rows.some((r) => r.def.key === "sharpe_ratio"), "metrics absent everywhere are omitted, not zero-filled");

  const same = compareBacktests([a, { ...b, backtest: { ...b.backtest!, assumptions: { commission_pct: 0.1 } } }], () => "m");
  assert.equal(same.comparable, true);
  assert.deepEqual(same.rows.find((r) => r.def.key === "return_pct")!.deltas, [null, 2]);
});

test("backtest comparison refuses to mix legacy estimates with price simulations", () => {
  const period = { start: "2025-01-01", end: "2025-12-31" };
  const v1 = run({ id: "v1", backtest: { assumptions: {}, period, methodology: { id: "label_payoff_v1", label: "Legacy", evaluation_class: null, threshold_source: null }, performance: { return_pct: -5, estimate: true } } });
  const v2 = run({ id: "v2", backtest: { assumptions: {}, period, methodology: { id: "price_sim_v2", label: "Price", evaluation_class: "independent_test", threshold_source: "validation_locked" }, performance: { return_pct: -9 } } });
  const mixed = compareBacktests([v1, v2], () => "m");
  assert.equal(mixed.comparable, false);
  assert.ok(mixed.warnings.some((w) => w.field === "Method"));
  assert.equal(mixed.rows.find((r) => r.def.key === "return_pct")!.deltas, null);

  const legacyOnly = compareBacktests([v1, { ...v1, id: "v1b" }], () => "m");
  assert.equal(legacyOnly.comparable, true);
  assert.ok(legacyOnly.warnings.some((w) => w.field === "Legacy"));
});

test("model comparison separates train and validation metrics", () => {
  const c = compareModels([
    model({ id: "m1", dataset_id: "d1", metrics: { accuracy: 0.9, val_accuracy: 0.6 } }),
    model({ id: "m2", dataset_id: "d2", metrics: { accuracy: 0.8, val_accuracy: 0.62 } }),
  ]);
  const acc = c.rows.filter((r) => r.def.key === "accuracy" || r.def.key === "val_accuracy");
  assert.deepEqual(acc.map((r) => r.def.group), ["Validation set", "Training set (in-sample)"]);
  assert.ok(c.warnings.some((w) => w.field === "Training dataset"));
  assert.equal(c.comparable, false);
});
