import { getTrainerModelMetadata, getUploadedModelMetadata } from "@/lib/api";
import { backtestApi, isV2, type EquityPayload, type MetricsPayload, type Summary, type Trade } from "@/features/backtest/api";
import { labApi, type LabContext, type LabJob, type ModelKind } from "@/features/lab/api";
import { analysisPromptInput, backtestPromptInput, type AiPromptInput } from "./build";

async function modelMetadata(ref: { trainerRunId?: string | null; modelId?: string | null }): Promise<unknown> {
  try {
    if (ref.trainerRunId) return await getTrainerModelMetadata(ref.trainerRunId);
    if (ref.modelId) return await getUploadedModelMetadata(ref.modelId);
  } catch {
    /* runs made before metadata existed */
  }
  return { unavailable: "No generator or trainer metadata is recorded for this model." };
}

export async function collectBacktest(args: { runId: string; summary: Summary; metrics: MetricsPayload | null; equity: EquityPayload | null; trades: Trade[] | null }): Promise<AiPromptInput> {
  const { runId, summary } = args;
  const model = (summary as { model?: Record<string, string | undefined> }).model ?? {};
  const v2 = isV2(summary);
  const [metrics, equity, trades, meta] = await Promise.all([
    v2 ? args.metrics ?? backtestApi.metrics(runId).catch(() => null) : null,
    v2 ? args.equity ?? backtestApi.equity(runId).catch(() => null) : null,
    v2 ? args.trades ?? backtestApi.allTrades(runId).catch(() => null) : null,
    modelMetadata({ trainerRunId: model.trainer_run_id ?? model.training_run_id, modelId: model.model_id }),
  ]);
  return backtestPromptInput({ runId, summary: summary as Record<string, any>, metrics, equity, trades, modelMetadata: meta });
}

export async function collectAnalysis(args: { sessionId: string | null; context: LabContext; model: { kind: ModelKind; id: string } }): Promise<AiPromptInput> {
  const { sessionId, context, model } = args;
  let jobs: LabJob[] = [];
  let findings: unknown = null;
  if (sessionId) {
    const session = await labApi.session(sessionId);
    const latest = new Map<string, LabJob>();
    for (const j of session.jobs) {
      if (j.status !== "succeeded" || !j.has_result) continue;
      const cur = latest.get(j.kind);
      if (!cur || j.created_at > cur.created_at) latest.set(j.kind, j);
    }
    jobs = await Promise.all([...latest.values()].map((j) => labApi.job(sessionId, j.job_id).catch(() => j)));
    findings = await labApi.findings(sessionId).catch(() => null);
  }
  const meta = await modelMetadata(model.kind === "trained" ? { trainerRunId: model.id } : { modelId: model.id });
  return analysisPromptInput({ sessionId, context: context as unknown as Record<string, any>, jobs, findings, modelMetadata: meta });
}
