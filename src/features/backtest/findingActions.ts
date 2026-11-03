/** Routes for the `action` attached to a backend finding. Kept free of API imports so it can be unit-tested. */

export interface FindingActionContext {
  runId: string;
  trainerRunId?: string | null;
  modelId?: string | null;
  datasetId?: string | null;
}

export interface FindingActionLink {
  label: string;
  to: string;
}

function modelQuery(ctx: FindingActionContext, key: "backtester" | "analysis"): string | null {
  if (key === "backtester") {
    if (ctx.trainerRunId) return `modelRunId=${encodeURIComponent(ctx.trainerRunId)}`;
    if (ctx.modelId) return `modelId=${encodeURIComponent(ctx.modelId)}`;
    return null;
  }
  if (ctx.trainerRunId) return `model=${encodeURIComponent(`trained:${ctx.trainerRunId}`)}`;
  if (ctx.modelId) return `model=${encodeURIComponent(`uploaded:${ctx.modelId}`)}`;
  return null;
}

export function findingActionLink(action: { kind: string; label: string } | null | undefined, ctx: FindingActionContext): FindingActionLink | null {
  if (!action) return null;
  const from = `backtest:${ctx.runId}`;
  switch (action.kind) {
    case "improve":
      if (!ctx.trainerRunId) return null;
      return { label: action.label, to: `/tools/improve?model=${encodeURIComponent(`trained:${ctx.trainerRunId}`)}&from=${encodeURIComponent(from)}` };
    case "analyze": {
      const q = modelQuery(ctx, "analysis");
      return q ? { label: action.label, to: `/tools/analysis?${q}` } : null;
    }
    case "labeling":
      return { label: action.label, to: "/products/labeling-optimizer/technical" };
    case "new_test_set": {
      const q = modelQuery(ctx, "backtester");
      return { label: action.label, to: `/tools/backtester${q ? `?${q}` : ""}` };
    }
    case "rerun_validation_threshold": {
      const parts = [modelQuery(ctx, "backtester"), ctx.datasetId ? `datasetId=${encodeURIComponent(ctx.datasetId)}` : null].filter(Boolean);
      return { label: action.label, to: `/tools/backtester${parts.length ? `?${parts.join("&")}` : ""}` };
    }
    default:
      return null;
  }
}
