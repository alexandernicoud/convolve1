import { useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Play, CheckCircle, XCircle, Clock, Eye, Trash2, ArrowLeft, RefreshCw } from "lucide-react";
import type { GlobalRun } from "@/lib/api";
import { AuthorizedDownloadLink } from "@/components/AuthorizedDownloadLink";
import { useRunsStore } from "@/state/runsStore";
import { ReviewWorkspace } from "@/features/review/ReviewWorkspace";

interface RunFamily {
  slug: string;
  title: string;
  routePrefix: string;
}

const RUN_FAMILIES: RunFamily[] = [
  { slug: "backtester", title: "Backtests", routePrefix: "/tools/backtester/runs/" },
  { slug: "labeling-optimizer", title: "Labeling optimizers", routePrefix: "/products/labeling-optimizer/results/" },
  { slug: "training-chart-generator", title: "Chart generators", routePrefix: "/tools/generator/runs/" },
  { slug: "testdata", title: "Test datasets", routePrefix: "/tools/backtester?runId=" },
  { slug: "trainer", title: "Model training", routePrefix: "/tools/trainer?runId=" },
  { slug: "analysis", title: "CNN analysis", routePrefix: "/tools/trainer/runs/" },
];

const formatDate = (ts?: number | null) => {
  if (!ts) return "—";
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case "running":
      return <Play className="h-4 w-4 animate-pulse text-white/60" />;
    case "succeeded":
      return <CheckCircle className="h-4 w-4 text-[#e5e5e5]" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "cancelled":
      return <XCircle className="h-4 w-4 text-yellow-400" />;
    case "queued":
      return <Clock className="h-4 w-4 text-yellow-400" />;
    default:
      return <Clock className="h-4 w-4 text-gray-400" />;
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "queued":
      return "Queued";
    default:
      return "Unknown";
  }
};

/** `/tools/run-log` renders the research workspace; `/tools/run-log/:toolFamily` the per-tool history. */
export default function RunLog() {
  const { toolFamily } = useParams<{ toolFamily?: string }>();
  const runsById = useRunsStore((s) => s.runsById);
  const getRunRoute = useRunsStore((s) => s.getRunRoute);

  const runsByFamily = useMemo(() => {
    const map: Record<string, GlobalRun[]> = {};
    for (const f of RUN_FAMILIES) {
      map[f.slug] = [];
    }
    const sorted = Object.values(runsById).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    for (const run of sorted) {
      if (map[run.tool]) {
        map[run.tool].push(run);
      }
    }
    return map;
  }, [runsById]);

  const activeFamily = toolFamily ? RUN_FAMILIES.find((f) => f.slug === toolFamily) : null;

  if (toolFamily && !activeFamily) {
    return <Navigate to="/tools/run-log" replace />;
  }

  const handleRefresh = async () => {
    await useRunsStore.getState().mergeRunsFromBackendList(200);
    await useRunsStore.getState().reconcileRunsWithBackend({ concurrency: 4 });
  };

  if (!activeFamily) return <ReviewWorkspace />;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0a0a0a]">
      {activeFamily ? (
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <div className="absolute left-10 top-20 h-96 w-96 rounded-full bg-[rgba(255,255,255,0.06)] blur-3xl" />
          <div className="absolute right-20 top-40 h-80 w-80 rounded-full bg-[rgba(255,255,255,0.15)] blur-3xl" />
          <div className="absolute bottom-20 left-1/3 h-72 w-72 rounded-full bg-[rgba(236,72,153,0.12)] blur-3xl" />
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
        <div className="mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden">
          {(
            <>
              <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
                <Link
                  to="/tools/run-log"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-[#F5F5F5] transition hover:border-white/30 hover:bg-white/[0.06]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to overview
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRefresh}
                    className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-medium text-[#0a0a0a] transition-all duration-200 hover:bg-white/90 "
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => useRunsStore.getState().clearStaleRuns()}
                    className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-[#F5F5F5]/80 transition hover:border-white/30 hover:text-white"
                  >
                    Clear stale runs
                  </button>
                  <button
                    type="button"
                    onClick={() => useRunsStore.getState().clearAllRuns()}
                    className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-[#F5F5F5]/80 transition hover:border-[#f87171]/50 hover:text-white"
                  >
                    Clear all runs
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="mb-6 border-b border-white/[0.08] pb-4">
                  <p className="marketing-section-label">Run log</p>
                  <h1 className="mt-3 text-[clamp(1.1rem,2vw,1.35rem)] font-extralight tracking-[-0.02em] text-white">
                    {activeFamily.title}
                  </h1>
                  <p className="mt-2 text-[13px] text-white/50">Runs for this tool, newest first.</p>
                </div>
                {(runsByFamily[activeFamily.slug] ?? []).length === 0 ? (
                  <p className="mt-6 text-sm text-[rgba(255,255,255,0.45)]">No runs in this category yet.</p>
                ) : (
                  <div className="space-y-3">
                    {(runsByFamily[activeFamily.slug] ?? []).map((run) => (
                      <div
                        key={run.id}
                        className="tech-surface-muted flex items-center justify-between p-4 transition-all duration-200 hover:border-white/[0.12]"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(run.status)}
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-[#F5F5F5]">{getStatusText(run.status)}</span>
                              <span className="text-sm text-[#F5F5F5]/50">•</span>
                              <span className="text-sm text-[#F5F5F5]/50">ID: {run.id.slice(-8)}</span>
                              {run.tool === "analysis" && (run.parent_run_id == null || run.parent_run_id === undefined) ? (
                                <span className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
                                  Standalone analysis
                                </span>
                              ) : null}
                            </div>
                            <div className="text-sm text-[#F5F5F5]/60">
                              Updated: {formatDate(run.updated_at)} · Started: {formatDate(run.created_at)}
                            </div>
                            {run.stage ? (
                              <div className="mt-1 text-xs text-[#F5F5F5]/50">
                                {run.stage}: {run.message || ""}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {run.status === "running" && (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/20">
                                <div
                                  className="h-full rounded-full bg-[#e5e5e5] transition-all duration-300"
                                  style={{ width: `${Math.max(5, run.progress * 100)}%` }}
                                />
                              </div>
                              <span className="min-w-[3ch] text-sm font-medium text-[#F5F5F5]">
                                {Math.round(run.progress * 100)}%
                              </span>
                            </div>
                          )}

                          {(run.status === "succeeded" ||
                            run.status === "failed" ||
                            run.status === "running" ||
                            run.status === "queued") && (
                            <Link
                              to={getRunRoute(run)}
                              state={{ fromRunHistory: `/tools/run-log/${activeFamily.slug}` }}
                              className="flex items-center gap-2 rounded-full border border-white/25 bg-white px-4 py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white/90"
                            >
                              <Eye className="h-4 w-4" />
                              {run.status === "running" || run.status === "queued" ? "Open" : "View results"}
                            </Link>
                          )}
                          {run.download_zip_url && run.status === "succeeded" ? (
                            <AuthorizedDownloadLink
                              path={run.download_zip_url}
                              filename={`${run.id}.zip`}
                              className="rounded-full border border-white/20 px-3 py-2 text-sm text-white/90 transition hover:bg-white/10"
                            >
                              Download
                            </AuthorizedDownloadLink>
                          ) : null}
                          {run.status !== "running" && run.status !== "queued" && (
                            <button
                              type="button"
                              onClick={() => useRunsStore.getState().removeRun(run.id)}
                              className="rounded-lg border border-white/15 bg-transparent p-2 text-[#F5F5F5]/70 transition hover:border-[#f87171]/60 hover:text-white"
                              title="Remove from history"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
