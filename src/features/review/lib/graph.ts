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
  | "run"
  | "unresolved";

export type AssetRefKind = "model" | "dataset" | "run" | "bot";

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
  run: "Run",
  unresolved: "Not in workspace",
};

/** Column (pipeline stage) per kind, left → right. */
export const STAGE: Record<NodeKind, number> = {
  generator: 0,
  optimizer: 0,
  archive: 1,
  dataset: 1,
  trainer: 2,
  model: 3,
  testdata: 4,
  testset: 5,
  analysis: 6,
  backtest: 6,
  bot: 7,
  run: 4,
  unresolved: 4,
};

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
  return k === "run" || k === "model" || k === "dataset" || k === "bot" ? { kind: k, id } : { kind: null, id: key };
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

  const edges = data.edges ?? [];
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

export const LAYOUT = { nodeW: 252, nodeH: 58, colGap: 76, rowGap: 14, compGap: 40, pad: 36 };

export interface Layout {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  columns: { stage: number; x: number }[];
}

/**
 * Deterministic columnar layout: stage columns left→right, components stacked
 * vertically, nodes ordered within a column by the mean row of their upstream nodes.
 */
export function layoutGraph(g: Graph, keys: Set<string>): Layout {
  const { nodeW, nodeH, colGap, rowGap, compGap, pad } = LAYOUT;
  const usedStages = [...new Set([...keys].map((k) => STAGE[g.nodes.get(k)!.kind]))].sort((a, b) => a - b);
  const colIndex = new Map(usedStages.map((s, i) => [s, i]));
  const colX = (stage: number) => pad + colIndex.get(stage)! * (nodeW + colGap);
  const pos = new Map<string, { x: number; y: number }>();
  let top = pad;

  for (const comp of components(g, keys)) {
    const byStage = new Map<number, string[]>();
    for (const k of comp) {
      const s = STAGE[g.nodes.get(k)!.kind];
      (byStage.get(s) ?? byStage.set(s, []).get(s)!).push(k);
    }
    const row = new Map<string, number>();
    let rows = 0;
    for (const s of [...byStage.keys()].sort((a, b) => a - b)) {
      const col = byStage.get(s)!;
      const score = (k: string) => {
        const ups = (g.in.get(k) ?? []).map((e) => row.get(e.source)).filter((v): v is number => v != null);
        return ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : Number.MAX_SAFE_INTEGER;
      };
      col.sort((a, b) => score(a) - score(b) || (g.nodes.get(b)!.ts ?? 0) - (g.nodes.get(a)!.ts ?? 0));
      col.forEach((k, i) => {
        row.set(k, i);
        pos.set(k, { x: colX(s), y: top + i * (nodeH + rowGap) });
      });
      rows = Math.max(rows, col.length);
    }
    top += rows * (nodeH + rowGap) - rowGap + compGap;
  }
  return {
    pos,
    width: pad * 2 + Math.max(1, usedStages.length) * (nodeW + colGap) - colGap,
    height: Math.max(top - compGap + pad, pad * 2 + nodeH),
    columns: usedStages.map((s) => ({ stage: s, x: colX(s) })),
  };
}

export function stageTitle(stage: number): string {
  const kinds = (Object.keys(STAGE) as NodeKind[]).filter((k) => STAGE[k] === stage && k !== "unresolved" && k !== "run");
  const labels: Record<number, string> = {
    0: "Source runs",
    1: "Training data",
    2: "Training",
    3: "Models",
    4: "Test-set runs",
    5: "Test sets",
    6: "Evaluation",
    7: "Deployment",
  };
  return labels[stage] ?? kinds.map((k) => NODE_KIND_LABEL[k]).join(" / ");
}
