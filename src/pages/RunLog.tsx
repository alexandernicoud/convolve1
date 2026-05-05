import { useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Play, CheckCircle, XCircle, Clock, Eye, Trash2, ArrowLeft, LayoutGrid } from "lucide-react";
import type { GlobalRun } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";

interface RunFamily {
  slug: string;
  title: string;
  routePrefix: string;
}

const RUN_FAMILIES: RunFamily[] = [
  { slug: "backtester", title: "Backtests", routePrefix: "/tools/backtester/runs/" },
  { slug: "labeling-optimizer", title: "Labeling optimizers", routePrefix: "/products/labeling-optimizer/results/" },
  { slug: "training-chart-generator", title: "Chart generators", routePrefix: "/tools/generator/runs/" },
  { slug: "trainer", title: "Model training", routePrefix: "/tools/trainer/runs/" },
  { slug: "analysis", title: "CNN analysis", routePrefix: "/tools/trainer/runs/" },
];

export default function RunLog() {
  const { toolFamily } = useParams<{ toolFamily?: string }>();
  const { runsById } = useRunsStore();

  const runsByFamily = useMemo(() => {
    const map: Record<string, GlobalRun[]> = {};
    for (const f of RUN_FAMILIES) {
      map[f.slug] = [];
    }
    const sorted = Object.values(runsById).sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
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
    await useRunsStore.getState().reconcileRunsWithBackend({ concurrency: 4 });
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const totalRuns = Object.values(runsById).length;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0a0a0a]">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute left-10 top-20 h-96 w-96 rounded-full bg-[rgba(255,255,255,0.06)] blur-3xl" />
        <div className="absolute right-20 top-40 h-80 w-80 rounded-full bg-[rgba(255,255,255,0.15)] blur-3xl" />
        <div className="absolute bottom-20 left-1/3 h-72 w-72 rounded-full bg-[rgba(236,72,153,0.12)] blur-3xl" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {activeFamily ? (
                <Link
                  to="/tools/run-log"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-[#F5F5F5] transition hover:border-white/30 hover:bg-white/[0.06]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  All categories
                </Link>
              ) : (
                <div className="flex items-center gap-2 text-sm text-[rgba(255,255,255,0.55)]">
                  <LayoutGrid className="h-4 w-4 text-white/65" />
                  <span>{totalRuns} saved run{totalRuns !== 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-medium text-[#0a0a0a] transition-all duration-200 hover:bg-white/90 "
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
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

          {!activeFamily ? (
            <>
              {totalRuns === 0 ? (
                <div className="py-12 text-center">
                  <div className="text-[#F5F5F5]/60">No runs found. Start your first analysis to see it here.</div>
                  <Link
                    to="/tools"
                    className="mt-4 inline-block rounded-lg bg-white px-6 py-2 font-medium text-[#0a0a0a] transition hover:bg-white/90 "
                  >
                    Explore tools
                  </Link>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <p className="marketing-section-label mb-6">Choose a test type</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {RUN_FAMILIES.map((fam) => {
                      const runs = runsByFamily[fam.slug] ?? [];
                      return (
                        <Link
                          key={fam.slug}
                          to={`/tools/run-log/${fam.slug}`}
                          className="group rounded-xl border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] p-5 transition hover:border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.05)]"
                        >
                          <h2 className="text-base font-semibold text-[#F5F5F5] transition group-hover:text-white">
                            {fam.title}
                          </h2>
                          <p className="mt-2 text-sm text-[rgba(255,255,255,0.45)]">
                            {runs.length} run{runs.length !== 1 ? "s" : ""}
                          </p>
                          <p className="mt-3 text-xs text-white/65">View history →</p>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
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
                          </div>
                          <div className="text-sm text-[#F5F5F5]/60">Started: {formatDate(run.created_at)}</div>
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

                        {(run.status === "succeeded" || run.status === "failed") && (
                          <Link
                            to={`${activeFamily.routePrefix}${run.id}`}
                            state={{ fromRunHistory: `/tools/run-log/${activeFamily.slug}` }}
                            className="flex items-center gap-2 rounded-full border border-white/25 bg-white px-4 py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white/90"
                          >
                            <Eye className="h-4 w-4" />
                            View results
                          </Link>
                        )}
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
          )}
        </div>
      </div>
    </div>
  );
}
