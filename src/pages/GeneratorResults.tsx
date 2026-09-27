import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, RotateCcw, ArrowRight, X, AlertTriangle } from "lucide-react";
import ToolLayout from "@/components/ToolLayout";
import type { Status } from "@/components/StatusPanel";
import {
  trainingChartGeneratorApi,
  ApiError,
  type DatasetStats,
  type TrainingChartGeneratorConfig,
} from "@/lib/api";
import { createEtaEstimator, formatRemaining } from "@/lib/eta";
import { useRunsStore } from "@/state/runsStore";

const mapPhaseToStatus = (phase?: string) => {
  const normalized = (phase || "").toLowerCase();
  if (["done", "completed", "succeeded"].includes(normalized)) return "succeeded";
  if (["error", "failed"].includes(normalized)) return "failed";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["queued", "starting"].includes(normalized)) return "running";
  return "running";
};

function SettingsReadout({ cfg }: { cfg: TrainingChartGeneratorConfig | null }) {
  if (!cfg) {
    return (
      <p className="text-sm text-white/55">
        Loading saved settings… If this never resolves, the run may predate config storage.
      </p>
    );
  }
  const rows: { k: string; v: string }[] = [
    { k: "Symbols", v: cfg.symbols || "—" },
    { k: "Charts per label", v: String(cfg.chartsPerLabel) },
    { k: "Chart type", v: cfg.useCandles ? "Candlestick" : "Line" },
    { k: "Timeframe", v: cfg.timeframe },
    { k: "Timespan", v: `${cfg.timespanCount} ${cfg.timespanUnit}` },
    { k: "Horizon bars", v: String(cfg.horizonBars) },
    { k: "Take profit", v: String(cfg.takeProfitFraction) },
    { k: "Stop loss", v: String(cfg.stopLossFraction) },
    { k: "Image size", v: String(cfg.imageDimension) },
    { k: "End offset", v: String(cfg.endOffset) },
  ];
  if (cfg.volumeMode) {
    const modeLabel =
      cfg.volumeMode === "by_period"
        ? "Fixed training period"
        : cfg.volumeMode === "by_charts"
          ? "Fixed dataset size"
          : cfg.volumeMode;
    rows.push({ k: "Generator mode", v: modeLabel });
  }
  if (cfg.referenceEndIso) rows.push({ k: "Dataset end (ISO)", v: cfg.referenceEndIso });
  if (cfg.trainingStartIso) rows.push({ k: "Training start (ISO)", v: cfg.trainingStartIso });
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(({ k, v }) => (
        <div key={k} className="flex flex-col border-b border-white/[0.06] pb-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">{k}</dt>
          <dd className="mt-0.5 break-all font-mono text-[13px] text-white/90">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function GeneratorResults() {
  const { runId: runIdParam } = useParams<{ runId: string }>();
  const runId = runIdParam?.trim() ?? "";

  const [status, setStatus] = useState<Status>("running");
  const [progress, setProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const etaRef = useRef(createEtaEstimator());
  const [datasetStats, setDatasetStats] = useState<DatasetStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Record<string, unknown> | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [savedConfig, setSavedConfig] = useState<TrainingChartGeneratorConfig | null>(null);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);

  const startTimeRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelFlagRef = useRef(false);
  const pollTokenRef = useRef(0);

  const clearPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const pollProgress = useCallback(
    (rid: string, token: number) => {
      clearPoll();
      pollIntervalRef.current = setInterval(async () => {
        if (token !== pollTokenRef.current) return;
        if (cancelFlagRef.current) {
          clearPoll();
          return;
        }
        try {
          const progressData = await trainingChartGeneratorApi.getProgress(rid);
          const rawProgress = progressData.percent || 0;
          setProgress((prev) => {
            const next = Math.max(prev, rawProgress);
            etaRef.current.record(next / 100);
            setEtaSeconds(etaRef.current.remainingSeconds());
            return next;
          });
          setCurrentPhase(progressData.phase || "Processing...");
          useRunsStore.getState().updateRun(rid, {
            status: mapPhaseToStatus(progressData.phase),
            progress: rawProgress > 1 ? rawProgress / 100 : rawProgress,
            stage: progressData.phase || "running",
            message: progressData.error_message || progressData.phase || "Running",
          });
          if (startTimeRef.current) {
            setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
          }
          if (progressData.phase === "done") {
            clearPoll();
            setStatus("done");
            setEtaSeconds(null);
            useRunsStore.getState().updateRun(rid, {
              status: "succeeded",
              progress: 1,
              stage: "done",
              message: "Completed",
            });
            try {
              const artifacts = await trainingChartGeneratorApi.getArtifacts(rid);
              setDatasetStats(artifacts);
            } catch (statsErr) {
              setError("Completed but failed to load dataset statistics");
              setErrorDetails({
                type: "stats_error",
                details: statsErr instanceof Error ? statsErr.message : String(statsErr),
              });
            }
          } else if (progressData.phase === "error") {
            clearPoll();
            setStatus("error");
            useRunsStore.getState().updateRun(rid, {
              status: "failed",
              stage: "error",
              message: progressData.error_message || "Generation failed",
            });
            setError(progressData.error_message || "Generation failed");
            setErrorDetails({
              type: "generation_error",
              details: progressData.error_message || "Unknown error",
            });
          }
        } catch (err) {
          clearPoll();
          setStatus("error");
          setError("Lost connection to generation process");
          setErrorDetails({
            type: "connection_error",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      }, 1500);
    },
    [clearPoll],
  );

  useEffect(() => {
    if (!runId) return;
    void useRunsStore.getState().mergeRunsFromBackendList(200);
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await trainingChartGeneratorApi.getSavedConfig(runId);
        if (!cancelled) setSavedConfig(cfg);
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && e.status === 404) {
            setConfigLoadError("No saved settings file for this run.");
          } else {
            setConfigLoadError(e instanceof Error ? e.message : "Could not load settings");
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    cancelFlagRef.current = false;
    etaRef.current.reset();
    setEtaSeconds(null);
    void (async () => {
      try {
        const progressData = await trainingChartGeneratorApi.getProgress(runId);
        if (cancelled) return;
        const mapped = mapPhaseToStatus(progressData.phase);
        const raw = progressData.percent || 0;
        setProgress(raw > 1 ? raw : raw);
        setCurrentPhase(progressData.phase || "");
        startTimeRef.current = Date.now() - (progressData.elapsed_s || 0) * 1000;
        etaRef.current.record(raw / 100);

        if (mapped === "running") {
          setStatus("running");
          const token = ++pollTokenRef.current;
          pollProgress(runId, token);
        } else if (mapped === "succeeded") {
          setStatus("done");
          try {
            const artifacts = await trainingChartGeneratorApi.getArtifacts(runId);
            if (!cancelled) setDatasetStats(artifacts);
          } catch {
            /* optional */
          }
        } else if (mapped === "failed") {
          setStatus("error");
          setError(progressData.error_message || "Run failed");
        } else if (mapped === "cancelled") {
          setStatus("cancelled");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setError("Run not found or progress unavailable.");
        }
      }
    })();
    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [runId, pollProgress, clearPoll]);

  useEffect(() => () => clearPoll(), [clearPoll]);

  const handleCancel = async () => {
    if (!runId || status !== "running") return;
    setIsCancelling(true);
    cancelFlagRef.current = true;
    try {
      await trainingChartGeneratorApi.cancel(runId);
      clearPoll();
      setStatus("cancelled");
      useRunsStore.getState().updateRun(runId, {
        status: "cancelled",
        message: "Cancelled by user",
        stage: "cancelled",
        progress: 0,
      });
    } catch {
      clearPoll();
      setStatus("cancelled");
    } finally {
      setIsCancelling(false);
      cancelFlagRef.current = false;
    }
  };

  const handleDownload = async () => {
    if (!runId) return;
    try {
      await trainingChartGeneratorApi.download(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleRunAgainNav = () => {
    window.location.href = "/tools/generator";
  };

  const OutputBody = (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.1] bg-[rgba(255,255,255,0.04)] p-4 md:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">Settings used</h2>
        {configLoadError ? (
          <p className="mt-2 text-sm text-amber-200/90">{configLoadError}</p>
        ) : (
          <div className="mt-3">
            <SettingsReadout cfg={savedConfig} />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-[#0a0a0a]/60 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                status === "running"
                  ? "bg-white/10 text-white"
                  : status === "done"
                    ? "bg-[#e5e5e5]/20 text-[#e5e5e5]"
                    : status === "cancelled"
                      ? "bg-white/10 text-white/70"
                      : "bg-[#f87171]/20 text-[#f87171]"
              }`}
            >
              {status === "running"
                ? "Running"
                : status === "done"
                  ? "Complete"
                  : status === "cancelled"
                    ? "Cancelled"
                    : "Failed"}
            </div>
            {status === "running" && (
              <span className="text-sm text-[#F5F5F5]/62">
                {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, "0")} elapsed
              </span>
            )}
          </div>
          <Link
            to="/tools/generator"
            className="shrink-0 text-xs font-medium text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            ← Edit configuration
          </Link>
        </div>

        {status === "running" && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#F5F5F5]/80">{currentPhase || "Initializing…"}</span>
              <span className="text-[#F5F5F5]/62 text-xs">
                {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, "0")}
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-[#0a0a0a]/60">
              <div
                className="h-3 rounded-full bg-white transition-all duration-500"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-[#F5F5F5]/62">{Math.round(progress)}% complete</span>
              {formatRemaining(etaSeconds) ? (
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-[#F5F5F5]/70">
                  {formatRemaining(etaSeconds)}
                </span>
              ) : progress > 0 && progress < 100 ? (
                <span className="text-xs text-white/35">estimating…</span>
              ) : null}
              <span className="font-mono text-[10px] text-white/40">ID {runId}</span>
            </div>
            {!isCancelling ? (
              <button
                type="button"
                onClick={() => void handleCancel()}
                className="inline-flex items-center gap-2 rounded-lg border border-[#f87171]/50 px-4 py-2 text-sm font-medium text-[#f87171] hover:bg-[#f87171]/10"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            ) : (
              <div className="text-sm text-[#f87171]">Cancelling…</div>
            )}
          </div>
        )}

        {status === "done" && datasetStats && (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-white/8 bg-[#0a0a0a]/40 p-4">
              <h3 className="mb-3 text-sm font-semibold text-[#F5F5F5]">Dataset summary</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[#F5F5F5]/62">Symbols</span>
                  <span className="ml-2 text-[#F5F5F5]">{savedConfig?.symbols.split(",").length ?? "—"}</span>
                </div>
                <div>
                  <span className="text-[#F5F5F5]/62">Timeframe</span>
                  <span className="ml-2 text-[#F5F5F5]">{datasetStats.timeframe ?? savedConfig?.timeframe ?? "—"}</span>
                </div>
                <div>
                  <span className="text-[#F5F5F5]/62">Total charts</span>
                  <span className="ml-2 text-[#F5F5F5]">{datasetStats.total_charts ?? "—"}</span>
                </div>
                <div>
                  <span className="text-[#F5F5F5]/62">Chart type</span>
                  <span className="ml-2 text-[#F5F5F5]">{datasetStats.chart_type ?? "—"}</span>
                </div>
                {datasetStats.label_counts ? (
                  <div>
                    <span className="text-[#F5F5F5]/62">Label split (0 / 1)</span>
                    <span className="ml-2 font-mono text-[#F5F5F5]">
                      {datasetStats.label_counts["0"] ?? 0} / {datasetStats.label_counts["1"] ?? 0}
                    </span>
                  </div>
                ) : null}
              </div>
              {datasetStats.label_counts ? (
                <p className="mt-3 text-xs leading-relaxed text-white/50">
                  {datasetStats.balanced
                    ? datasetStats.removed_for_balance
                      ? `Balanced 50 / 50 — trimmed ${datasetStats.removed_for_balance} majority-class chart${
                          datasetStats.removed_for_balance === 1 ? "" : "s"
                        } to match the rarer label.`
                      : "Balanced 50 / 50 — both classes reached the target."
                    : `Imbalanced dataset kept as-is${
                        datasetStats.charts_per_label_requested
                          ? ` (requested ${datasetStats.charts_per_label_requested} per label)`
                          : ""
                      }. Label 1 is naturally rarer than label 0.`}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void handleDownload()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-medium text-[#0a0a0a]"
              >
                <Download className="h-4 w-4" />
                Download ZIP
              </button>
              <button
                type="button"
                onClick={handleRunAgainNav}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/18 px-4 py-3 text-sm font-medium text-[#F5F5F5] hover:bg-white/8"
              >
                <RotateCcw className="h-4 w-4" />
                New run
              </button>
              <Link to="/tools/trainer" className="flex-1">
                <span className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/18 px-4 py-3 text-sm font-medium text-[#F5F5F5] hover:bg-white/8">
                  <ArrowRight className="h-4 w-4" />
                  Trainer
                </span>
              </Link>
            </div>
          </div>
        )}

        {status === "error" && error && (
          <div className="mt-5 rounded-lg border border-[#f87171]/25 bg-[#f87171]/10 p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#f87171]" />
              <div>
                <h3 className="text-sm font-semibold text-[#f87171]">Generation failed</h3>
                <p className="mt-1 text-sm text-white/80">{error}</p>
                {errorDetails?.details != null && (
                  <p className="mt-2 font-mono text-xs text-white/55">{String(errorDetails.details)}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {status === "cancelled" && (
          <p className="mt-5 text-sm text-white/60">This run was cancelled.</p>
        )}
      </div>
    </div>
  );

  if (!runId) {
    return (
      <div className="p-6 text-sm text-white/70">
        Missing run id. <Link to="/tools/generator" className="text-white underline">Back to generator</Link>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ToolLayout
        title="Generator results"
        description="Training chart generator run output and saved settings."
        inputPanel={OutputBody}
        contentMaxWidthClass="w-full max-w-none"
      />
    </div>
  );
}
