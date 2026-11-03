/**
 * Provenance graph built only from edges the backend reports. Nodes referenced by an
 * edge but absent from the workspace become explicit "unresolved" placeholders;
 * nothing is inferred client-side.
 */
import type { ReviewBot, ReviewDataset, ReviewEdge, ReviewModel, ReviewOverviewResponse, ReviewRun } from "@/lib/api";

export type NodeKind =
  | "generator"
  | "optimizer"
  | "dataset"
  | "archive"
  | "trainer"
  | "model"
  | "testdata"
  | "testset"
  | "analysis"
  | "backtest"
  | "bot"
  | "stock"
  | "run"
  | "unresolved";

export type AssetRefKind = "model" | "dataset" | "run" | "bot" | "stock";

export interface GraphNode {
  key: string;
  kind: NodeKind;
  ref: { kind: AssetRefKind; id: string };
  label: string;
  sublabel?: string;
  status?: string | null;
  ts?: number | null;
  unresolved?: boolean;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: ReviewEdge[];
  out: Map<string, ReviewEdge[]>;
  in: Map<string, ReviewEdge[]>;
}

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  generator: "Generator run",
  optimizer: "Label search",
  dataset: "Training data",
  archive: "Dataset archive",
  trainer: "Training run",
  model: "Model",
  testdata: "Test-set run",
  testset: "Test set",
  analysis: "Analysis",
  backtest: "Backtest",
  bot: "Deployed bot",
  stock: "Stock",
  run: "Run",
  unresolved: "Not in workspace",
};

/** The eight workflow columns of the Search Hub graph, left → right. */
export const COLUMNS = [
  "Stock",
  "Labeling Optimizer",
  "Training Chart Generator",
  "Trainer",
  "Analysis",
  "Test Data Generator",
  "Backtester",
  "Deploy",
] as const;

/**
 * Column and lane per kind. Tools that produce an artifact use two lanes inside their column:
 * the run (lane 0) and what it produced (lane 1), so produced-by links still run left → right.
 */
export const PLACE: Record<NodeKind, { col: number; lane: 0 | 1 }> = {
  stock: { col: 0, lane: 0 },
  optimizer: { col: 1, lane: 0 },
  generator: { col: 2, lane: 0 },
  archive: { col: 2, lane: 1 },
  dataset: { col: 2, lane: 1 },
  trainer: { col: 3, lane: 0 },
  model: { col: 3, lane: 1 },
  analysis: { col: 4, lane: 0 },
  testdata: { col: 5, lane: 0 },
  testset: { col: 5, lane: 1 },
  backtest: { col: 6, lane: 0 },
  bot: { col: 7, lane: 0 },
  run: { col: 4, lane: 0 },
  unresolved: { col: 4, lane: 0 },
};

/** Kept for callers that only need a stage number. */
export const STAGE: Record<NodeKind, number> = Object.fromEntries(
  (Object.keys(PLACE) as NodeKind[]).map((k) => [k, PLACE[k].col * 2 + PLACE[k].lane]),
) as Record<NodeKind, number>;

export const RELATION_LABEL: Record<string, string> = {
  produced: "produced",
  trained_on: "trained on",
  test_set_for: "test set for",
  configured_from: "configured from",
  backtested: "backtested",
  evaluated_on: "evaluated on",
  analyzed: "analyzed",
  analysis_input: "analysis input",
  exported_as: "exported as",
  deployed_as: "deployed as",
  informed: "informed",
  improved_into: "improved into",
  price_data: "price data for",
};

const RUN_KIND: Record<string, NodeKind> = {
  "training-chart-generator": "generator",
  "labeling-optimizer": "optimizer",
  trainer: "trainer",
  testdata: "testdata",
  analysis: "analysis",
  backtester: "backtest",
};

export function parseKey(key: string): { kind: AssetRefKind | null; id: string } {
  const i = key.indexOf(":");
  if (i < 0) return { kind: null, id: key };
  const k = key.slice(0, i);
  const id = key.slice(i + 1);
  return k === "run" || k === "model" || k === "dataset" || k === "bot" || k === "stock" ? { kind: k, id } : { kind: null, id: key };
}

export interface NameLookup {
  run?: (r: ReviewRun) => string;
  model?: (m: ReviewModel) => string;
  dataset?: (d: ReviewDataset) => string;
}

export function buildGraph(data: Pick<ReviewOverviewResponse, "runs" | "models" | "datasets" | "bots" | "edges">, names: NameLookup = {}): Graph {
  const nodes = new Map<string, GraphNode>();
  for (const r of data.runs ?? []) {
    nodes.set(`run:${r.id}`, {
      key: `run:${r.id}`,
      kind: RUN_KIND[r.tool] ?? "run",
      ref: { kind: "run", id: r.id },
      label: names.run?.(r) ?? r.display_name ?? r.id,
      sublabel: r.id,
      status: r.status,
      ts: r.created_at,
    });
  }
  for (const m of data.models ?? []) {
    nodes.set(`model:${m.id}`, {
      key: `model:${m.id}`,
      kind: "model",
      ref: { kind: "model", id: m.id },
      label: names.model?.(m) ?? m.display_name ?? m.name ?? m.id,
      sublabel: m.source === "uploaded" ? "uploaded" : m.id,
      status: m.status ?? null,
      ts: m.created_at ?? null,
    });
  }
  for (const d of data.datasets ?? []) {
    nodes.set(`dataset:${d.id}`, {
      key: `dataset:${d.id}`,
      kind: d.representation === "archive" ? "archive" : d.kind === "test" ? "testset" : "dataset",
      ref: { kind: "dataset", id: d.id },
      label: names.dataset?.(d) ?? d.display_name ?? d.name ?? d.id,
      sublabel: d.representation === "archive" ? "ZIP archive" : d.dataset_id ?? d.id,
      ts: d.created_at ?? null,
    });
  }
  for (const b of data.bots ?? []) {
    nodes.set(`bot:${b.id}`, botNode(b));
  }

  const priceEdges = stockEdges(data);
  for (const e of priceEdges) {
    if (!nodes.has(e.source)) {
      const sym = e.source.slice("stock:".length);
      nodes.set(e.source, { key: e.source, kind: "stock", ref: { kind: "stock", id: sym }, label: sym, sublabel: "Price data (Yahoo Finance)" });
    }
  }

  const edges = [...priceEdges, ...(data.edges ?? [])];
  const out = new Map<string, ReviewEdge[]>();
  const inc = new Map<string, ReviewEdge[]>();
  for (const e of edges) {
    for (const k of [e.source, e.target]) {
      if (!nodes.has(k)) {
        const p = parseKey(k);
        nodes.set(k, {
          key: k,
          kind: "unresolved",
          ref: { kind: p.kind ?? "run", id: p.id },
          label: p.id,
          sublabel: `${p.kind ?? "asset"} · not in workspace`,
          unresolved: true,
        });
      }
    }
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    (inc.get(e.target) ?? inc.set(e.target, []).get(e.target)!).push(e);
  }
  return { nodes, edges, out, in: inc };
}

export function splitSymbols(raw: unknown): string[] {
  if (typeof raw !== "string" && !Array.isArray(raw)) return [];
  const list = Array.isArray(raw) ? raw.map(String) : raw.split(/[,\s]+/);
  return [...new Set(list.map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

/**
 * Stock → tool links from the symbols each data-downloading run recorded in its own
 * configuration (label search, chart generator, test-set generator). Never matched by name
 * across assets: a run is linked only to the tickers it states it downloaded.
 */
export function stockEdges(data: Pick<ReviewOverviewResponse, "runs" | "datasets">): ReviewEdge[] {
  const out: ReviewEdge[] = [];
  const add = (sym: string, target: string, basis: string) =>
    out.push({ source: `stock:${sym}`, target, relation: "price_data", provenance: "recorded", basis });
  const testRuns = new Set<string>();
  for (const r of data.runs ?? []) {
    if (r.tool === "labeling-optimizer") for (const s of splitSymbols(r.optimizer?.config?.symbol)) add(s, `run:${r.id}`, "symbol in the label search's recorded configuration");
    if (r.tool === "training-chart-generator") for (const s of splitSymbols(r.generator?.config?.symbols)) add(s, `run:${r.id}`, "symbols in the generator's recorded configuration");
    if (r.tool === "testdata") testRuns.add(r.id);
  }
  const linkedTestRuns = new Set<string>();
  for (const d of data.datasets ?? []) {
    if (d.kind !== "test" || !d.symbols) continue;
    const target = d.testdata_run_id && testRuns.has(d.testdata_run_id) ? `run:${d.testdata_run_id}` : `dataset:${d.id}`;
    if (target.startsWith("run:")) {
      if (linkedTestRuns.has(target)) continue;
      linkedTestRuns.add(target);
    }
    for (const s of splitSymbols(d.symbols)) add(s, target, "symbols recorded in the test set's provenance");
  }
  return out;
}

function botNode(b: ReviewBot): GraphNode {
  return {
    key: `bot:${b.id}`,
    kind: "bot",
    ref: { kind: "bot", id: b.id },
    label: b.name || `Bot ${b.symbol}`,
    sublabel: `${b.symbol} · provenance ${b.provenance ?? "unknown"}`,
    status: b.lifecycle_state ?? (b.is_active ? "active" : "paused"),
    ts: b.created_at ?? null,
  };
}

/** All ancestors and descendants of `key` following edge direction (the node's lineage). */
export function lineageOf(g: Graph, key: string): Set<string> {
  const seen = new Set<string>([key]);
  const walk = (start: string, adj: Map<string, ReviewEdge[]>, next: (e: ReviewEdge) => string) => {
    const stack = [start];
    while (stack.length) {
      const k = stack.pop()!;
      for (const e of adj.get(k) ?? []) {
        const n = next(e);
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
  };
  walk(key, g.out, (e) => e.target);
  walk(key, g.in, (e) => e.source);
  return seen;
}

export function neighbors(g: Graph, key: string): { upstream: ReviewEdge[]; downstream: ReviewEdge[] } {
  return { upstream: g.in.get(key) ?? [], downstream: g.out.get(key) ?? [] };
}

/** Weakly connected components, largest-recent first. */
export function components(g: Graph, keys: Set<string>): string[][] {
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const start of keys) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      for (const e of [...(g.out.get(k) ?? []), ...(g.in.get(k) ?? [])]) {
        const n = e.source === k ? e.target : e.source;
        if (keys.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    comps.push(comp);
  }
  const recency = (c: string[]) => Math.max(0, ...c.map((k) => g.nodes.get(k)?.ts ?? 0));
  return comps.sort((a, b) => (b.length > 1 ? 1 : 0) - (a.length > 1 ? 1 : 0) || recency(b) - recency(a));
}

export { LAYOUT, layoutGraph, type Layout } from "./graphLayout";
