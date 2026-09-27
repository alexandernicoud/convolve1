import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, XCircle, Clock } from "lucide-react";
import { labelingOptimizerApi, formatEta, formatDuration } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";

export default function LabelingOptimizerRun() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const pollProgress = useCallback(async () => {
    if (!runId) return;
    try {
      const progressData = await labelingOptimizerApi.getProgress(runId);
      setProgress(progressData);

      const phase = (progressData.phase || "").toLowerCase();
      const done = phase === "done" || phase === "completed" || phase === "succeeded" || phase === "success";
      const failed = phase === "error" || phase === "failed";
      const cancelled = phase === "cancelled" || phase === "canceled";
      const pct = typeof progressData.percent === "number" ? progressData.percent : 0;
      // Backend sometimes reports 0–100, sometimes 0–1
      const progress01 = pct > 1 ? Math.min(1, pct / 100) : Math.max(0, Math.min(1, pct));

      useRunsStore.getState().updateRun(runId, {
        status: done ? "succeeded" : failed ? "failed" : cancelled ? "cancelled" : "running",
        progress: progress01,
        stage: progressData.phase || "running",
        message: progressData.error_message || progressData.phase || "Running",
        route: done
          ? `/products/labeling-optimizer/results/${runId}`
          : `/products/labeling-optimizer/run/${runId}`,
      });

      if (done && (pct >= 100 || progress01 >= 0.99)) {
        navigate(`/products/labeling-optimizer/results/${runId}`, { replace: true });
        return true;
      }
      if (failed) {
        setError(progressData.error_message || "Optimization failed");
        return true;
      }
      if (cancelled) {
        setError(progressData.error_message || "Optimization cancelled");
        return true;
      }
    } catch (err) {
      console.error("Failed to fetch progress:", err);
    }
    return false;
  }, [runId, navigate]);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled) return;
      const finished = await pollProgress();
      if (finished && interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    void tick();
    interval = setInterval(tick, 1000);

    // Browsers throttle timers in background tabs — refresh immediately on return
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runId, pollProgress]);

  if (!runId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-white">Invalid Run ID</h1>
          <Link
            to="/products/labeling-optimizer/technical"
            className="inline-block rounded-lg bg-white px-6 py-2.5 font-medium text-[#0a0a0a] transition hover:bg-white/90"
          >
            Start New Run
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative pb-16 text-white">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/products/labeling-optimizer/technical"
          className="mb-8 inline-flex items-center gap-2 text-sm text-white/55 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to form
        </Link>

        <div className="rounded-xl border border-white/12 bg-white/[0.04] p-8">
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-3xl font-bold text-white">Labeling Optimization</h1>
            <p className="text-white/55">
              Run ID: <code className="rounded bg-white/10 px-2 py-1 text-sm text-white/85">{runId}</code>
            </p>
          </div>

          {error ? (
            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <XCircle className="h-16 w-16 text-red-500" />
              </div>
              <h2 className="mb-2 text-xl font-semibold text-white">Optimization Failed</h2>
              <p className="mb-6 text-white/55">{error}</p>
              <Link
                to="/products/labeling-optimizer/technical"
                className="inline-block rounded-lg bg-white px-6 py-2.5 font-medium text-[#0a0a0a] transition hover:bg-white/90"
              >
                Try Again
              </Link>
            </div>
          ) : progress ? (
            <div className="space-y-6">
              <div className="flex items-center justify-center gap-2">
                {progress.phase === "done" ? (
                  <CheckCircle className="h-6 w-6 text-emerald-300" />
                ) : progress.phase === "error" ? (
                  <XCircle className="h-6 w-6 text-red-500" />
                ) : (
                  <Clock className="h-6 w-6 animate-pulse text-white/70" />
                )}
                <span className="text-lg font-medium capitalize text-white">{progress.phase}</span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm text-white/55">
                  <span>Progress</span>
                  <span>{Math.round(progress.percent > 1 ? progress.percent : progress.percent * 100)}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-white transition-all duration-300 ease-out"
                    style={{
                      width: `${Math.min(100, progress.percent > 1 ? progress.percent : progress.percent * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-white/[0.06] p-4 text-center">
                  <div className="text-2xl font-bold text-white">{formatDuration(progress.elapsed_s)}</div>
                  <div className="text-sm text-white/50">Elapsed</div>
                </div>
                <div className="rounded-lg bg-white/[0.06] p-4 text-center">
                  <div className="text-2xl font-bold text-white">
                    {formatEta(progress.elapsed_s, progress.percent)}
                  </div>
                  <div className="text-sm text-white/50">ETA</div>
                </div>
              </div>

              {progress.step != null && progress.total_steps ? (
                <div className="text-center text-sm text-white/50">
                  Step {progress.step} of {progress.total_steps}
                </div>
              ) : null}

              {progress.phase !== "done" && progress.phase !== "error" && progress.phase !== "cancelled" ? (
                <div className="text-center">
                  <button
                    type="button"
                    disabled={cancelling}
                    onClick={async () => {
                      if (!runId || cancelling) return;
                      setCancelling(true);
                      try {
                        await labelingOptimizerApi.cancel(runId);
                        useRunsStore.getState().updateRun(runId, {
                          status: "cancelled",
                          progress: 0,
                          stage: "cancelled",
                          message: "Cancelled by user",
                        });
                        setError("Optimization cancelled");
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setCancelling(false);
                      }
                    }}
                    className="rounded-lg border border-white/25 bg-white/10 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/15 disabled:opacity-50"
                  >
                    {cancelling ? "Stopping…" : "Cancel run"}
                  </button>
                </div>
              ) : null}

              {progress.phase === "done" ? (
                <div className="text-center">
                  <div className="mb-2 font-medium text-emerald-200">Optimization complete</div>
                  <p className="text-sm text-white/50">Opening results…</p>
                  <Link
                    to={`/products/labeling-optimizer/results/${runId}`}
                    className="mt-4 inline-block rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
                  >
                    View results now
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Clock className="mx-auto mb-4 h-12 w-12 animate-pulse text-white/60" />
              <p className="text-white/55">Connecting to optimization service…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
