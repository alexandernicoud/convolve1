/**
 * Contextual actions for a Search Hub graph node. Every route here is read by its page:
 * Backtester (modelRunId / modelId / datasetId), Deploy (trainingRunId / modelId),
 * Analysis (model=kind:id), Improve (model=kind:id), Generator (symbols), Trainer (datasetId).
 */
import type { ReviewDataset, ReviewModel, ReviewRun } from "@/lib/api";
import type { Graph, GraphNode } from "./graph";

export type NodeAction = { id: string; label: string; to?: string; details?: boolean; primary?: boolean };

export interface ActionContext {
  graph: Pick<Graph, "in" | "out" | "nodes">;
  model: (id?: string | null) => ReviewModel | null;
  run: (id: string) => ReviewRun | null;
  dataset: (id: string) => ReviewDataset | null;
  runRoute: (r: ReviewRun) => string;
}

export function backtestRouteForModel(m: ReviewModel): string {
  if (m.source === "trained" && m.training_run_id) return `/tools/backtester?modelRunId=${encodeURIComponent(m.training_run_id)}`;
  if (m.source === "uploaded") return `/tools/backtester?modelId=${encodeURIComponent(m.id)}`;
  return "/tools/backtester";
}

export function deployRouteForModel(m: ReviewModel): string {
  return m.source === "trained" && m.training_run_id
    ? `/tools/deploy?trainingRunId=${encodeURIComponent(m.training_run_id)}`
    : `/tools/deploy?modelId=${encodeURIComponent(m.id)}`;
}

export function modelParam(m: ReviewModel): string {
  return m.source === "trained" && m.training_run_id ? `trained:${m.training_run_id}` : `uploaded:${m.id}`;
}

export const analysisRouteForModel = (m: ReviewModel) => `/tools/analysis?model=${encodeURIComponent(modelParam(m))}`;
export const improveRouteForModel = (m: ReviewModel, from?: string) =>
  `/tools/improve?model=${encodeURIComponent(modelParam(m))}${from ? `&from=${encodeURIComponent(from)}` : ""}`;

export function modelActions(m: ReviewModel): NodeAction[] {
  const out: NodeAction[] = [
    { id: "analyze", label: "Analyze model", to: analysisRouteForModel(m) },
    { id: "backtest", label: "Backtest model", to: backtestRouteForModel(m) },
    { id: "deploy", label: "Deploy model", to: deployRouteForModel(m) },
  ];
  if (m.source === "trained" && m.training_run_id) out.push({ id: "improve", label: "Improve model", to: improveRouteForModel(m, "search-hub"), primary: true });
  out.push({ id: "details", label: "Open model details", details: true });
  return out;
}

/** The model a run used or produced, following recorded edges only. */
function linkedModel(n: GraphNode, ctx: ActionContext, dir: "in" | "out"): ReviewModel | null {
  for (const e of ctx.graph[dir].get(n.key) ?? []) {
    const other = dir === "in" ? e.source : e.target;
    if (other.startsWith("model:")) {
      const m = ctx.model(other.slice("model:".length));
      if (m) return m;
    }
  }
  return null;
}

export function nodeActions(n: GraphNode, ctx: ActionContext): NodeAction[] {
  if (n.unresolved) return [];
  const id = n.ref.id;
  const details: NodeAction = { id: "details", label: "Details", details: true };
  switch (n.kind) {
    case "model": {
      const m = ctx.model(id);
      return m ? modelActions(m) : [details];
    }
    case "stock":
      return [
        { id: "generate", label: `Generate charts for ${id}`, to: `/tools/generator?symbols=${encodeURIComponent(id)}` },
        { id: "label-search", label: "New label search", to: "/products/labeling-optimizer/technical" },
      ];
    case "dataset":
    case "archive":
    case "testset": {
      const d = ctx.dataset(id);
      const out: NodeAction[] = [];
      if (d?.kind === "training" && d.representation !== "archive" && d.dataset_id)
        out.push({ id: "train", label: "Train a model on it", to: `/tools/trainer?datasetId=${encodeURIComponent(d.dataset_id)}`, primary: true });
      if (d?.generator_run_id) out.push({ id: "gen", label: "Open generator run", to: `/tools/generator/runs/${encodeURIComponent(d.generator_run_id)}` });
      if (d && (d.kind === "test" || d.kind === "unknown") && d.dataset_id)
        out.push({ id: "bt", label: "Backtest on this test set", to: `/tools/backtester?datasetId=${encodeURIComponent(d.dataset_id)}`, primary: true });
      return [...out, { ...details, label: "Open dataset details" }];
    }
    case "trainer": {
      const r = ctx.run(id);
      const m = ctx.model(id) ?? linkedModel(n, ctx, "out");
      const out: NodeAction[] = [];
      if (r) out.push({ id: "open", label: "Open training results", to: ctx.runRoute(r), primary: true });
      if (m) out.push(...modelActions(m).filter((a) => a.id === "improve" || a.id === "analyze" || a.id === "backtest"));
      return [...out, details];
    }
    case "backtest": {
      const r = ctx.run(id);
      const m = linkedModel(n, ctx, "in");
      const out: NodeAction[] = [];
      if (r) out.push({ id: "open", label: "Inspect backtest", to: ctx.runRoute(r), primary: true });
      if (m && m.source === "trained" && m.training_run_id) out.push({ id: "improve", label: "Improve this model", to: improveRouteForModel(m, `backtest:${id}`) });
      if (m) out.push({ id: "deploy", label: "Deploy model", to: deployRouteForModel(m) });
      return [...out, details];
    }
    case "analysis": {
      const r = ctx.run(id);
      const m = linkedModel(n, ctx, "in");
      const out: NodeAction[] = [];
      if (r) out.push({ id: "open", label: "Open analysis", to: ctx.runRoute(r), primary: true });
      if (m) out.push({ id: "lab", label: "Continue in the analysis lab", to: analysisRouteForModel(m) });
      if (m && m.source === "trained" && m.training_run_id) out.push({ id: "improve", label: "Improve this model", to: improveRouteForModel(m, `analysis:${id}`) });
      return [...out, details];
    }
    case "bot":
      return [{ id: "open", label: "Open bot", to: `/dashboard/bots/${encodeURIComponent(id)}`, primary: true }, details];
    default: {
      const r = ctx.run(id);
      return r ? [{ id: "open", label: n.kind === "optimizer" ? "Open label search results" : "Open run", to: ctx.runRoute(r), primary: true }, details] : [details];
    }
  }
}
