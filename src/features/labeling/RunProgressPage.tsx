import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Plus, Square, X } from "lucide-react";
import { btn, btnPrimary, cx, surface } from "@/features/review/components/primitives";
import { labelingOptimizerApi, type ProgressResponse } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { StatusBadge } from "./ui";

/**
 * Live view of a labeling-optimizer run. The optimizer reports measurable progress only during the
 * grid search (step / total cells); data loading, exports and the methodology audit report a phase
 * without a fraction, so those stages show an indeterminate bar.
 */

type Outcome = "running" | "done" | "failed" | "cancelled";

const STAGES = [
  { id: "load", label: "Loading data" },
  { id: "grid", label: "Grid search" },
  { id: "export", label: "Exports & charts" },
  { id: "audit", label: "Methodology audit" },
  { id: "done", label: "Done" },
] as const;

const STAGE_DETAIL: Record<(typeof STAGES)[number]["id"], string> = {
  load: "Downloading daily prices for the selected window.",
  grid: "Simulating every TP × SL × horizon cell.",
  export: "Writing result tables, charts and dashboard data. The optimizer does not report progress in this step.",
  audit: "Re-simulating the top cell, valuing expired trades at the close and running the chronological holdout. No progress fraction is reported.",
  done: "Results are ready.",
};

function outcomeOf(phase: string): Outcome {
  const p = phase.toLowerCase();
  if (["done", "completed", "succeeded", "success"].includes(p)) return "done";
  if (["error", "failed", "interrupted"].includes(p)) return "failed";
  if (["cancelled", "canceled"].includes(p)) return "cancelled";
  return "running";
}

function stageIndex(p: ProgressResponse | null): number {
  if (!p) return -1;
  const phase = (p.phase || "").toLowerCase();
  if (outcomeOf(phase) === "done") return 4;
  if (phase === "starting" || phase.includes("load")) return 0;
  if (phase === "grid search") return pct(p) >= 100 ? 2 : 1;
  if (phase.includes("export")) return 2;
  if (phase.includes("audit")) return 3;
  return -1;
}

function pct(p: ProgressResponse): number {
  const v = typeof p.percent === "number" && Number.isFinite(p.percent) ? p.percent : 0;
  return Math.max(0, Math.min(100, v > 0 && v <= 1 && p.phase !== "grid search" ? v * 100 : v));
}

function fmtClock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export default function RunProgressPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [userCancelled, setUserCancelled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Wall-clock time at which the reported elapsed_s last changed (for a ticking clock between updates). */
  const lastChange = useRef<{ elapsed: number; at: number } | null>(null);
  /** Two grid-search reports (optimizer-side elapsed time) give a measured cell rate; nothing else is extrapolated. */
  const gridObs = useRef<{ step: number; at: number }[]>([]);

  const poll = useCallback(async (): Promise<boolean> => {
    if (!runId) return true;
    try {
      const p = await labelingOptimizerApi.getProgress(runId);
      setFetchError(null);
      setProgress(p);
      const at = Date.now();
      if (!lastChange.current || lastChange.current.elapsed !== p.elapsed_s) lastChange.current = { elapsed: p.elapsed_s, at };
      if (p.phase === "grid search" && typeof p.step === "number") {
        const obs = gridObs.current;
        if (!obs.length || obs[obs.length - 1]!.step !== p.step) obs.push({ step: p.step, at: p.elapsed_s * 1000 });
        if (obs.length > 12) obs.shift();
      }

      const outcome = outcomeOf(p.phase || "");
      const frac = pct(p) / 100;
      useRunsStore.getState().updateRun(runId, {
        status: outcome === "done" ? "succeeded" : outcome,
        progress: frac,
        stage: p.phase || "running",
        message: p.error_message || p.phase || "Running",
        route: outcome === "done" ? `/products/labeling-optimizer/results/${runId}` : `/products/labeling-optimizer/run/${runId}`,
      });
      if (outcome === "done") {
        navigate(`/products/labeling-optimizer/results/${runId}`, { replace: true });
        return true;
      }
      return outcome !== "running";
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Could not reach the optimization service");
      return false;
    }
  }, [runId, navigate]);

  useEffect(() => {
    if (!runId) return;
    lastChange.current = null;
    gridObs.current = [];
    setProgress(null);
    setUserCancelled(false);
    setFetchError(null);
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (stopped) return;
      if ((await poll()) && interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    void tick();
    interval = setInterval(tick, 1000);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runId, poll]);

  const outcome: Outcome = userCancelled ? "cancelled" : progress ? outcomeOf(progress.phase || "") : "running";
  const running = outcome === "running";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const cancel = async () => {
    if (!runId || cancelling) return;
    setCancelling(true);
    try {
      await labelingOptimizerApi.cancel(runId);
      useRunsStore.getState().updateRun(runId, { status: "cancelled", progress: 0, stage: "cancelled", message: "Cancelled by user" });
      setUserCancelled(true);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  };

  if (!runId) return <div className="flex min-h-[50vh] items-center justify-center text-white/60">No run ID provided.</div>;

  const idx = stageIndex(progress);
  const sinceUpdate = lastChange.current ? Math.max(0, (now - lastChange.current.at) / 1000) : null;
  const elapsed = progress ? progress.elapsed_s + (running && sinceUpdate != null ? sinceUpdate : 0) : null;

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-white/45">
            <Link to="/products/labeling-optimizer/technical" className="transition hover:text-white">
              Labeling optimizer
            </Link>
            <span>/</span>
            <span>Run</span>
          </div>
          <h1 className="mt-1.5 truncate text-[26px] font-semibold tracking-tight text-white">Label search</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13.5px] text-white/55">
            <OutcomeBadge outcome={outcome} stage={idx >= 0 ? STAGES[idx]!.label : progress?.phase} connected={!!progress} />
            <span className="font-mono text-[12px] text-white/35" title="Run id">
              {runId}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/products/labeling-optimizer/technical" className={btn}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          {running && progress ? (
            <button type="button" className={btn} onClick={cancel} disabled={cancelling}>
              <Square className="h-3.5 w-3.5" /> {cancelling ? "Stopping…" : "Cancel run"}
            </button>
          ) : null}
          {!running ? (
            <Link to="/products/labeling-optimizer/technical" className={btnPrimary}>
              <Plus className="h-4 w-4" /> New optimization
            </Link>
          ) : null}
        </div>
      </header>

      <StageTrack index={idx} outcome={outcome} />

      {outcome === "failed" || outcome === "cancelled" ? (
        <section className={cx(surface, "px-6 py-6")}>
          <p className={cx("text-[15px] font-medium", outcome === "failed" ? "text-red-200" : "text-white/85")}>{outcome === "failed" ? "The optimization failed" : "The optimization was cancelled"}</p>
          <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-white/55">
            {progress?.error_message || (outcome === "cancelled" ? "Stopped before results were written. No partial results are shown." : "No error message was reported.")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/products/labeling-optimizer/technical" className={btnPrimary}>
              Start a new optimization
            </Link>
          </div>
        </section>
      ) : progress ? (
        <ProgressPanel progress={progress} idx={idx} elapsed={elapsed} sinceUpdate={sinceUpdate} gridObs={gridObs.current} done={outcome === "done"} runId={runId} />
      ) : (
        <section className={cx(surface, "px-6 py-6")}>
          <p className="text-[14px] text-white/75">{fetchError ? "Waiting for the optimization service…" : "Connecting to the optimization service…"}</p>
          <div className="mt-4 h-1.5 max-w-md overflow-hidden rounded-full bg-white/[0.08]" aria-label="Connecting">
            <div className="h-full w-1/3 animate-indeterminate rounded-full bg-white/70" />
          </div>
          {fetchError ? <p className="mt-3 text-[12.5px] text-white/40">{fetchError}. Retrying every second.</p> : null}
        </section>
      )}

      {progress && fetchError && running ? <p className="text-[12.5px] text-amber-200/80">Connection problem: {fetchError}. Showing the last reported state; retrying.</p> : null}

      {running ? <p className="text-[12.5px] text-white/40">You can leave this page; the run continues on the server and can be reopened from Run history.</p> : null}
    </div>
  );
}

function OutcomeBadge({ outcome, stage, connected }: { outcome: Outcome; stage?: string; connected: boolean }) {
  if (outcome === "failed") return <StatusBadge tone="bad">Failed</StatusBadge>;
  if (outcome === "cancelled") return <StatusBadge tone="neutral">Cancelled</StatusBadge>;
  if (outcome === "done") return <StatusBadge tone="good">Completed</StatusBadge>;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/25 px-2.5 py-0.5 text-[12.5px] font-medium text-white">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      {connected ? `Running · ${stage ?? "working"}` : "Connecting"}
    </span>
  );
}

function StageTrack({ index, outcome }: { index: number; outcome: Outcome }) {
  const bad = outcome === "failed" || outcome === "cancelled";
  return (
    <ol className={cx(surface, "grid grid-flow-col auto-cols-fr overflow-x-auto")}>
      {STAGES.map((s, i) => {
        const reached = i < index || (s.id === "done" && outcome === "done");
        const current = !bad && i === index && s.id !== "done";
        const stoppedHere = bad && i === Math.max(0, index);
        const last = s.id === "done";
        return (
          <li key={s.id} className={cx("flex min-w-[150px] items-center gap-3 px-5 py-4", i > 0 && "border-l border-white/[0.07]")}>
            <span
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                reached ? "border-white bg-white text-black" : current || stoppedHere ? "border-white text-white" : "border-white/20 text-white/35",
                last && bad && (outcome === "failed" ? "border-red-400/60 text-red-300" : "border-white/30 text-white/50"),
              )}
            >
              {reached ? <Check className="h-3.5 w-3.5" /> : last && bad ? <X className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cx("block text-[13.5px] font-medium", current || reached || stoppedHere ? "text-white" : "text-white/45")}>
                {last && bad ? (outcome === "failed" ? "Failed" : "Cancelled") : s.label}
              </span>
              {current ? <span className="mt-0.5 block text-[12px] text-white/45">In progress</span> : stoppedHere ? <span className="mt-0.5 block text-[12px] text-white/45">Stopped here</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-black px-5 py-5">
      <p className="text-[13px] text-white/50">{label}</p>
      <p className="mt-2 font-digits text-[26px] font-semibold leading-none tabular-nums tracking-tight text-white">{value}</p>
      {sub ? <div className="mt-2 text-[12px] leading-snug text-white/40">{sub}</div> : null}
    </div>
  );
}

function ProgressPanel({
  progress: p,
  idx,
  elapsed,
  sinceUpdate,
  gridObs,
  done,
  runId,
}: {
  progress: ProgressResponse;
  idx: number;
  elapsed: number | null;
  sinceUpdate: number | null;
  gridObs: { step: number; at: number }[];
  done: boolean;
  runId: string;
}) {
  const total = p.total_steps ?? null;
  const step = typeof p.step === "number" ? p.step : null;
  const measurable = idx === 1 && total != null && step != null;
  const percent = measurable ? (step! / total!) * 100 : null;
  const stage = idx >= 0 ? STAGES[idx]! : null;

  const stale = sinceUpdate != null && sinceUpdate > 30;
  let remaining: number | null = null;
  if (measurable && !stale && gridObs.length >= 2) {
    const a = gridObs[0]!;
    const b = gridObs[gridObs.length - 1]!;
    const rate = (b.step - a.step) / Math.max(1e-3, (b.at - a.at) / 1000);
    if (rate > 0) remaining = (total! - step!) / rate;
  }
  const evaluated = idx >= 2 && total != null ? total : step;

  return (
    <section className={cx(surface, "overflow-hidden")}>
      <div className="grid lg:grid-cols-12">
        <div className="px-6 py-6 lg:col-span-5 lg:border-r lg:border-white/[0.07]">
          <h2 className="flex items-center gap-2 text-[14.5px] font-medium text-[#F5F5F5]">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            {done ? "Completed" : stage?.label ?? p.phase}
          </h2>
          <div className="mt-5 space-y-4 pl-3.5">
            <p className="text-[14.5px] leading-relaxed text-white/80">{done ? "Opening results…" : stage ? STAGE_DETAIL[stage.id] : `Reported phase: ${p.phase}`}</p>
            {done ? (
              <Link to={`/products/labeling-optimizer/results/${runId}`} className={btn}>
                View results
              </Link>
            ) : percent != null ? (
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-digits text-[44px] font-semibold leading-none tabular-nums text-white">{percent.toFixed(percent < 10 ? 1 : 0)}%</span>
                  <span className="font-digits text-[13px] tabular-nums text-white/50">
                    {step!.toLocaleString("en-US")} / {total!.toLocaleString("en-US")} cells
                  </span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-white transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
                </div>
              </div>
            ) : (
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]" aria-label="Working (no measurable progress)">
                  <div className="h-full w-1/3 animate-indeterminate rounded-full bg-white/70" />
                </div>
                <p className="mt-3 text-[12.5px] text-white/40">This step reports no progress fraction, so no percentage or time estimate is shown.</p>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-px bg-white/[0.06] min-[480px]:grid-cols-2 lg:col-span-7">
          <Figure
            label={done ? "Duration" : "Elapsed"}
            value={elapsed != null ? fmtClock(elapsed) : "—"}
            sub={!done && sinceUpdate != null ? (sinceUpdate < 3 ? "Updated just now" : `Last update from the optimizer ${Math.round(sinceUpdate)} s ago`) : undefined}
          />
          <Figure
            label="Grid search remaining"
            value={remaining != null ? `≈ ${fmtClock(remaining)}` : "—"}
            sub={remaining != null ? "From the optimizer's measured cell rate; exports and audit not included" : idx > 1 ? "Grid search finished" : stale && measurable ? "Withheld: no update from the optimizer for over 30 s" : "Needs two progress updates during the grid search"}
          />
          <Figure
            label="Cells evaluated"
            value={evaluated != null ? evaluated.toLocaleString("en-US") : "—"}
            sub={total != null ? `of ${total.toLocaleString("en-US")} TP × SL × horizon cells` : undefined}
          />
          <Figure label="Current best" value="—" sub="Not reported while the run is in progress; shown on the results page." />
        </div>
      </div>
    </section>
  );
}
