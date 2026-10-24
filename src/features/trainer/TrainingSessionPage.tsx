import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRight, Check, ChevronDown, Download, FlaskConical, LineChart, Plus, RefreshCw, Square, WifiOff, X } from "lucide-react";
import { trainerApi, type TrainerProgressResponse, type TrainingSession } from "@/lib/api";
import { TrainingCurves } from "@/components/viz/TrainingCurves";
import { fmtClock, fmtDateTime, fmtDuration, fmtInt, fmtNum, fmtPct, isFiniteNum, MISSING } from "@/lib/viz/format";
import { SEMANTIC } from "@/lib/viz/tokens";
import { btn, btnPrimary, Caveat, cx, EmptyState, KV, Panel, PanelTitle, surface } from "@/features/review/components/primitives";
import { useTrainingRun } from "./useTrainingRun";
import { LiveComputation } from "./LiveComputation";
import { DiagnosticsPanel, EvaluationPanel, isProtocol2, SelectionCurves, SplitPanel } from "./EvaluationPanels";
import { SELECTION_NAME, selectionName } from "./evaluation";
import { OPTIMIZER_LABEL, SCHEDULE_LABEL } from "./options";
import {
  elapsedSeconds,
  epochProgress,
  isTerminal,
  marketLabel,
  patienceUsed,
  remainingUpperBound,
  STAGE_DETAIL,
  STAGE_LABEL,
  STAGE_ORDER,
  fmtPhaseSeconds,
  stageOf,
  timingRows,
} from "./lib";

export function LegacyTrainerAnalysisRedirect() {
  const { runId } = useParams();
  return <Navigate to={runId ? `/tools/analysis?trainer_run=${encodeURIComponent(runId)}` : "/tools/analysis"} replace />;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export default function TrainingSessionPage() {
  const { runId } = useParams();
  const { data, connection, failures, refresh, cancel, resume } = useTrainingRun(runId);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const session = data?.session ?? null;
  const stage = stageOf(data);
  const running = !!data && !isTerminal(data.status);
  const now = useNow(running);

  if (!runId) return <Navigate to="/tools/trainer" replace />;

  if (connection === "not_found" || connection === "forbidden") {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <EmptyState
          title="This training run could not be found"
          body="It may belong to another account, or its files were removed. Runs you started are listed in Review."
          action={
            <div className="flex gap-2">
              <Link to="/tools/trainer?new=1" className={btnPrimary}>
                <Plus className="h-4 w-4" /> New training run
              </Link>
              <Link to="/tools/run-log?tab=runs" className={btn}>
                Open Review
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  if (!data) return <SessionSkeleton reconnecting={failures > 0} />;

  const onCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancel();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Could not cancel the run");
    } finally {
      setCancelling(false);
    }
  };

  const onResume = async () => {
    setResuming(true);
    setCancelError(null);
    try {
      await resume();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Could not resume the run");
    } finally {
      setResuming(false);
    }
  };

  const stopping = data.status === "cancelled" && session?.worker_active === true;
  const resumeFrom = !running && !stopping ? session?.resumable_from_epoch ?? null : null;
  const resumePanel = resumeFrom ? <ResumeOffer epoch={resumeFrom} resuming={resuming} onResume={onResume} /> : null;

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5 pb-10">
      <SessionHeader
        runId={runId}
        data={data}
        session={session}
        stage={stage}
        running={running}
        stopping={stopping}
        cancelling={cancelling}
        onCancel={onCancel}
      />

      {connection === "reconnecting" ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-4 py-3 text-[13.5px] text-amber-100/85">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Lost contact with the server ({failures} failed {failures === 1 ? "attempt" : "attempts"}). Training continues on the server; showing the last
            update received.
          </span>
          <button type="button" className={btn} onClick={refresh}>
            <RefreshCw className="h-4 w-4" /> Retry now
          </button>
        </div>
      ) : null}
      {cancelError ? <p className="rounded-xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3 text-[13.5px] text-red-200/90">{cancelError}</p> : null}

      <StageTrack stage={stage} queued={stage === "queued" || data.progress?.phase === "queued"} epochsDone={session?.epochs_completed ?? 0} />

      {stage === "failed" ? <FailurePanel session={session} data={data} /> : null}
      {stage === "cancelled" ? <CancelledPanel session={session} stopping={stopping} /> : null}
      {resumePanel}

      <ProgressPanel data={data} session={session} stage={stage} now={now} running={running} />
      {session && stage !== "failed" && stage !== "cancelled" ? <LiveComputation session={session} running={running} /> : null}

      {stage === "completed" && session ? <CompletedPanel runId={runId} session={session} /> : null}
      {stage === "completed" && session ? <EvaluationPanel session={session} /> : null}
      {!running && session?.timings ? <TimingPanel session={session} /> : null}

      <Panel
        help="learning-curves"
        title="Learning curves"
        description="Per-epoch values recorded by the trainer. Validation images are held out from fitting; the gap between the two lines is the first place to look for overfitting."
      >
        <TrainingCurves
          history={session?.history ?? []}
          bestEpoch={session?.best_epoch ?? null}
          bestLabel={`best ${selectionName(session)}`}
          exportName={`training_${runId}`}
        />
      </Panel>
      {session && isProtocol2(session) ? <SelectionCurves session={session} /> : null}

      <div className="grid gap-5 xl:grid-cols-12">
        <RunDetails session={session} className="xl:col-span-7" />
        <ArchitecturePanel session={session} className="xl:col-span-5" />
      </div>
      {session && (session.split || session.reproducibility || session.model) ? (
        <div className="grid gap-5 xl:grid-cols-12">
          {session.split ? (
            <div className="xl:col-span-7">
              <SplitPanel session={session} />
            </div>
          ) : null}
          <DiagnosticsPanel session={session} className={session.split ? "xl:col-span-5" : "xl:col-span-12"} />
        </div>
      ) : null}

      <EpochLog session={session} message={data.progress?.message} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function SessionHeader({
  runId,
  data,
  session,
  stage,
  running,
  stopping,
  cancelling,
  onCancel,
}: {
  runId: string;
  data: TrainerProgressResponse;
  session: TrainingSession | null;
  stage: string;
  running: boolean;
  stopping: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const name = (session?.model_name || "").replace(/\.keras$/i, "") || "Training run";
  const dataset = session?.dataset?.name || (session?.dataset?.id ? `Dataset ${session.dataset.id.slice(-8)}` : null);
  const market = marketLabel(session?.dataset?.market);
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pt-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] text-white/45">
          <Link to="/tools/trainer?new=1" className="transition hover:text-white">
            Trainer
          </Link>
          <span>/</span>
          <span>Training session</span>
        </div>
        <h1 className="mt-1.5 truncate text-[26px] font-semibold tracking-tight text-white">{name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-white/55">
          <StageBadge stage={stopping ? "stopping" : stage} />
          {dataset ? <span>{dataset}</span> : null}
          {market ? <span className="text-white/45">{market}</span> : null}
          <span className="font-mono text-[12px] text-white/35" title="Run id">
            {runId}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {running && !stopping ? (
          <button type="button" className={btn} onClick={onCancel} disabled={cancelling} title="Stops the training machine after the current batch">
            <Square className="h-3.5 w-3.5" /> {cancelling ? "Cancelling…" : "Cancel training"}
          </button>
        ) : null}
        {data.status === "done" ? (
          <button type="button" className={btn} onClick={() => void trainerApi.downloadModel(runId)}>
            <Download className="h-4 w-4" /> Download model
          </button>
        ) : null}
        <Link to="/tools/trainer?new=1" className={running ? btn : btnPrimary}>
          <Plus className="h-4 w-4" /> New training run
        </Link>
      </div>
    </header>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const failed = stage === "failed";
  const done = stage === "completed";
  const idle = stage === "cancelled";
  const label = stage === "stopping" ? "Stopping" : STAGE_LABEL[stage] ?? stage;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[12.5px] font-medium",
        failed ? "border-red-400/30 text-red-200" : done ? "border-white/25 text-white" : idle ? "border-white/15 text-white/55" : "border-white/25 text-white",
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          failed ? "bg-red-400" : done ? "bg-white" : idle ? "bg-white/40" : "animate-pulse bg-white",
        )}
      />
      {label}
    </span>
  );
}

function StageTrack({ stage, queued, epochsDone }: { stage: string; queued: boolean; epochsDone: number }) {
  const steps = STAGE_ORDER.filter((s) => s !== "queued" || queued);
  const terminalBad = stage === "failed" || stage === "cancelled";
  // A stopped run has no recorded stage history; finished epochs prove it got as far as training.
  const stoppedAt = epochsDone > 0 ? "training" : "preparing";
  const currentIndex = steps.indexOf((terminalBad ? stoppedAt : stage) as (typeof STAGE_ORDER)[number]);
  return (
    <ol className={cx(surface, "grid grid-flow-col auto-cols-fr overflow-x-auto")}>
      {steps.map((s, i) => {
        const reached = currentIndex >= 0 ? i < currentIndex || (s === "completed" && stage === "completed") : false;
        const current = (!terminalBad && s === stage && stage !== "completed") || (terminalBad && s === stoppedAt);
        const label = s === "completed" && terminalBad ? STAGE_LABEL[stage] : STAGE_LABEL[s];
        return (
          <li key={s} className={cx("flex min-w-[150px] items-center gap-3 px-5 py-4", i > 0 && "border-l border-white/[0.07]")}>
            <span
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                reached ? "border-white bg-white text-black" : current ? "border-white text-white" : "border-white/20 text-white/35",
                s === "completed" && terminalBad && (stage === "failed" ? "border-red-400/60 text-red-300" : "border-white/30 text-white/50"),
              )}
            >
              {reached ? <Check className="h-3.5 w-3.5" /> : s === "completed" && terminalBad ? <X className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cx("block text-[13.5px] font-medium", current || reached ? "text-white" : "text-white/45")}>{label}</span>
              {current ? <span className="mt-0.5 block text-[12px] text-white/45">{terminalBad ? "Stopped here" : "In progress"}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function EpochStrip({ total, done, best }: { total: number; done: number; best?: number | null }) {
  const cells = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`${done} of up to ${total} epochs completed`}>
      {cells.map((e) => (
        <span
          key={e}
          title={`Epoch ${e}${e === best ? " · best validation loss" : ""}`}
          className={cx("h-2.5 flex-1 rounded-[3px]", e <= done ? "bg-white/80" : "bg-white/[0.08]", e === best && "bg-white")}
          style={e === best ? { background: SEMANTIC.validation } : undefined}
        />
      ))}
    </div>
  );
}

function ProgressPanel({
  data,
  session,
  stage,
  now,
  running,
}: {
  data: TrainerProgressResponse;
  session: TrainingSession | null;
  stage: string;
  now: number;
  running: boolean;
}) {
  const { done, total } = epochProgress(session);
  const elapsed = elapsedSeconds(session, now);
  const remaining = running ? remainingUpperBound(session) : null;
  const patience = patienceUsed(session);
  const latest = session?.history?.[session.history.length - 1];
  const prev = session?.history?.[session.history.length - 2];
  const preTraining = stage === "queued" || stage === "preparing" || stage === "initializing";

  return (
    <section className={cx(surface, "overflow-hidden")}>
      <div className="grid gap-0 lg:grid-cols-12">
        <div className="px-6 py-6 lg:col-span-5 lg:border-r lg:border-white/[0.07]" data-help="train-progress">
          <PanelTitle>{preTraining ? STAGE_LABEL[stage] : "Progress"}</PanelTitle>
          {preTraining ? (
            <div className="mt-5 space-y-4 pl-4">
              <p className="text-[15px] leading-relaxed text-white/80">{data.progress?.message || STAGE_DETAIL[stage]}</p>
              {session?.queue ? (
                <p className="text-[12.5px] leading-relaxed text-white/45" data-help="train-queue">
                  {session.queue.waiting_for === "user"
                    ? "Runs from one account train one at a time; this one starts automatically."
                    : `Place ${session.queue.position} among runs waiting for a ${session.queue.waiting_for === "gpu" ? "GPU" : "training"} machine. It starts automatically; how long that takes depends on the runs ahead.`}
                </p>
              ) : null}
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]" aria-label="Working (no measurable progress yet)">
                <div className="h-full w-1/3 animate-indeterminate rounded-full bg-white/70" />
              </div>
              <p className="text-[12.5px] text-white/40">No epoch has finished yet, so there is nothing to measure progress against.</p>
            </div>
          ) : (
            <div className="mt-5 pl-4">
              <div className="flex items-baseline gap-3">
                <span className="font-digits text-[44px] font-semibold leading-none tabular-nums text-white">{done}</span>
                <span className="text-[15px] text-white/50">
                  {total ? `of up to ${total} epochs` : "epochs completed"}
                </span>
              </div>
              {total ? (
                <div className="mt-5">
                  <EpochStrip total={total} done={done} best={session?.best_epoch} />
                </div>
              ) : null}
              {running && stage === "training" ? <LiveEpoch live={session?.live_epoch} valSamples={session?.val_samples} /> : null}
              <p className="mt-3 text-[12.5px] leading-relaxed text-white/40">
                {session?.architecture?.early_stopping?.enabled === false
                  ? `Early stopping is off: every epoch runs, and the epoch with the best ${selectionName(session)} is kept.`
                  : `Early stopping ends training when ${selectionName(session)} has not improved for ${session?.architecture?.early_stopping?.patience ?? 5} epochs, so a run can finish before the maximum.`}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px bg-white/[0.06] lg:col-span-7 sm:grid-cols-3">
          <Figure label={running ? "Elapsed" : "Duration"} value={elapsed != null ? fmtClock(elapsed) : MISSING} sub={session?.started_at ? `Started ${fmtDateTime(session.started_at)}` : undefined} />
          <Figure
            label="Mean epoch time"
            value={isFiniteNum(session?.mean_epoch_seconds) ? fmtDuration(session?.mean_epoch_seconds) : MISSING}
            sub={isFiniteNum(session?.mean_epoch_seconds) ? "Measured from epoch timestamps" : "After the first epoch"}
          />
          <Figure
            label="Time left (upper bound)"
            value={remaining != null ? `≤ ${fmtDuration(remaining)}` : MISSING}
            sub={remaining != null ? "Estimate: mean epoch × epochs to the maximum" : running ? "Needs two finished epochs" : "Not running"}
          />
          <Figure
            label="Validation loss"
            value={fmtNum(latest?.val_loss, 4)}
            sub={<Delta now={latest?.val_loss} prev={prev?.val_loss} lowerIsBetter digits={4} />}
          />
          <Figure
            help="validation-accuracy"
            label="Validation accuracy"
            value={fmtPct(latest?.val_accuracy, 1)}
            sub={<Delta now={latest?.val_accuracy} prev={prev?.val_accuracy} pct />}
          />
          <Figure
            label={`Best ${selectionName(session)}`}
            value={fmtSelection(session)}
            sub={
              session?.best_epoch
                ? `Epoch ${session.best_epoch}${patience && running ? ` · ${patience.since} of ${patience.patience} epochs without improvement` : ""}`
                : session?.val_samples === 0
                  ? "Needs a validation split"
                  : "After the first epoch"
            }
          />
        </div>
      </div>
      {latest ? (
        <div className="grid grid-cols-2 border-t border-white/[0.07] text-[13px] text-white/55 sm:grid-cols-4">
          <MiniStat label="Training loss" value={fmtNum(latest.loss, 4)} />
          <MiniStat label="Training accuracy" value={fmtPct(latest.accuracy, 1)} />
          <MiniStat label="Val. recall (label 1)" value={fmtPct(latest.val_label_1_recall, 1)} />
          <MiniStat label="Latest epoch" value={`${latest.epoch}${latest.timestamp ? ` · ${new Date(latest.timestamp * 1000).toLocaleTimeString("en-GB")}` : ""}`} />
        </div>
      ) : null}
    </section>
  );
}

/** The selection metric's value at the kept epoch (validation loss for older runs). */
function fmtSelection(session: TrainingSession | null): string {
  const key = (session?.selection_metric?.name ?? "val_loss") as keyof TrainingSession["history"][number];
  const row = session?.best_epoch ? session.history.find((h) => h.epoch === session.best_epoch) : undefined;
  const v = row?.[key] ?? (key === "val_loss" ? session?.best_metrics?.val_loss : undefined);
  if (!isFiniteNum(v)) return MISSING;
  if (key === "val_loss") return fmtNum(v, 4);
  if (key === "val_auc" || key === "val_pr_auc") return fmtNum(v, 3);
  return fmtPct(v, 1);
}

function LiveEpoch({ live, valSamples }: { live?: TrainingSession["live_epoch"]; valSamples?: number | null }) {
  const batch = live?.batch;
  const batches = live?.batches;
  if (!isFiniteNum(batch) || !live?.epoch_in_progress) {
    return <p className="mt-4 text-[12.5px] text-white/40">Waiting for the next batch report…</p>;
  }
  const fraction = isFiniteNum(batches) && batches > 0 ? Math.min(1, batch / batches) : null;
  return (
    <div className="mt-4 space-y-1.5" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-white/75">
          {live.validating
            ? `Epoch ${live.epoch_in_progress} · all batches done, scoring ${isFiniteNum(valSamples) ? `${fmtInt(valSamples)} ` : "the "}validation images`
            : `Epoch ${live.epoch_in_progress} in progress · batch ${fmtInt(batch)}${isFiniteNum(batches) ? ` of ${fmtInt(batches)}` : ""}`}
        </span>
        {!live.validating && isFiniteNum(live.images_per_second) ? (
          <span className="font-digits tabular-nums text-white/45">{fmtNum(live.images_per_second, 1)} images/s</span>
        ) : null}
      </div>
      {fraction != null ? (
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={batches ?? undefined} aria-valuenow={batch}>
          <div className="h-full rounded-full bg-white/60 transition-[width] duration-700" style={{ width: `${fraction * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function TimingPanel({ session }: { session: TrainingSession }) {
  const rows = timingRows(session.timings);
  if (!rows.length) return null;
  const t = session.timings!;
  const facts = [
    isFiniteNum(t.epoch_seconds_median) ? `median epoch ${fmtDuration(t.epoch_seconds_median)}` : null,
    isFiniteNum(t.train_images_per_second) ? `${fmtNum(t.train_images_per_second, 1)} training images/s` : null,
    isFiniteNum(t.cpu_utilization) && isFiniteNum(t.cpu_count) ? `${fmtNum(t.cpu_utilization, 1)} of ${t.cpu_count} CPU cores busy on average` : null,
    isFiniteNum(t.peak_rss_mb) ? `peak memory ${fmtInt(t.peak_rss_mb)} MB` : null,
    isFiniteNum(t.model_file_mb) ? `model file ${fmtNum(t.model_file_mb, 1)} MB` : null,
  ].filter(Boolean);
  return (
    <Panel
      help="train-timings"
      title="Where the time went"
      description={`Measured wall time per phase, ${fmtDuration(t.measured_seconds)} in total. Phases that were not measured for this run are not listed.`}
    >
      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label="Share of time per phase">
        {rows.map((r, i) => (
          <span key={r.key} title={`${r.label}: ${fmtPhaseSeconds(r.seconds)}`} className={cx("h-full", i > 0 && "border-l border-black")} style={{ width: `${r.share * 100}%`, background: r.largest ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)" }} />
        ))}
      </div>
      <table className="mt-4 w-full text-[13px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/[0.06]">
              <td className="py-2">
                <span className={r.largest ? "text-white" : "text-white/80"}>{r.label}</span>
                <span className="ml-2 hidden text-white/35 sm:inline">{r.detail}</span>
              </td>
              <td className="py-2 text-right font-digits tabular-nums text-white/70">{fmtPhaseSeconds(r.seconds)}</td>
              <td className="w-16 py-2 text-right font-digits tabular-nums text-white/45">{fmtPct(r.share, r.share < 0.01 ? 1 : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {facts.length ? <Caveat>{facts.join(" · ")}.</Caveat> : null}
    </Panel>
  );
}

function Figure({ label, value, sub, help }: { label: string; value: string; sub?: React.ReactNode; help?: string }) {
  return (
    <div className="bg-black px-5 py-5" data-help={help}>
      <p className="text-[13px] text-white/50">{label}</p>
      <p className="mt-2 font-digits text-[26px] font-semibold leading-none tabular-nums text-white">{value}</p>
      {sub ? <div className="mt-2 text-[12.5px] leading-snug text-white/40">{sub}</div> : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-white/[0.07] px-5 py-3 [&:not(:first-child)]:border-l">
      <span>{label}</span>
      <span className="font-digits tabular-nums text-white/85">{value}</span>
    </div>
  );
}

function Delta({ now, prev, lowerIsBetter, pct, digits = 3 }: { now?: number | null; prev?: number | null; lowerIsBetter?: boolean; pct?: boolean; digits?: number }) {
  if (!isFiniteNum(now) || !isFiniteNum(prev)) return <span>vs previous epoch: {MISSING}</span>;
  const d = now - prev;
  const better = lowerIsBetter ? d < 0 : d > 0;
  const text = pct ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pp` : `${d >= 0 ? "+" : ""}${d.toFixed(digits)}`;
  return (
    <span>
      <span style={{ color: d === 0 ? undefined : better ? SEMANTIC.positive : SEMANTIC.negative }}>{text}</span> vs previous epoch
    </span>
  );
}

function CompletedPanel({ runId, session }: { runId: string; session: TrainingSession }) {
  const s = session.summary ?? {};
  const savedEpoch = s.saved_weights_epoch ?? session.best_epoch ?? null;
  const saved = savedEpoch ? session.history.find((h) => h.epoch === savedEpoch) ?? s.saved_weights_metrics : undefined;
  const trained = s.epochs_trained ?? session.epochs_completed;
  const configured = s.epochs_configured ?? session.epochs_total;
  const stoppedEarly = s.stopped_early ?? (configured != null && trained < configured);
  return (
    <section className={cx(surface, "overflow-hidden")}>
      <div className="grid lg:grid-cols-12">
        <div className="px-6 py-6 lg:col-span-7 lg:border-r lg:border-white/[0.07]">
          <PanelTitle>Saved model</PanelTitle>
          <p className="mt-2 pl-4 text-[14px] leading-relaxed text-white/60">
            {savedEpoch
              ? `The saved weights are from epoch ${savedEpoch}${
                  session.best_epoch === savedEpoch
                    ? `, the epoch with the ${session.selection_metric?.mode === "max" ? "highest" : "lowest"} ${selectionName(session)}`
                    : ""
                }. `
              : "Weights from the last epoch were saved. "}
            Trained {trained} of up to {configured ?? MISSING} epochs{stoppedEarly ? "; early stopping ended the run." : "."}
          </p>
          {s.saved_weights_inferred ? (
            <Caveat>This run predates recorded best-epoch tracking; the saved epoch is inferred from its history (Keras restores the best validation-loss weights).</Caveat>
          ) : null}
          <div className="mt-5 grid grid-cols-2 gap-6 pl-4 sm:grid-cols-4">
            <div data-help="validation-accuracy">
              <SmallFigure label="Validation accuracy" value={fmtPct(saved?.val_accuracy, 1)} />
            </div>
            <SmallFigure label="Validation loss" value={fmtNum(saved?.val_loss, 4)} />
            <SmallFigure label="Training accuracy" value={fmtPct(saved?.accuracy, 1)} />
            <SmallFigure label="Training loss" value={fmtNum(saved?.loss, 4)} />
          </div>
          <Caveat>
            {(session.config?.validation_method ?? (isProtocol2(session) ? "chronological" : "random")) === "chronological"
              ? "Validation figures come from the most recent period of the dataset, held out from fitting. "
              : "Validation figures come from a random sample of the same dataset; neighbouring charts overlap, so they read higher than on a later period. "}
            They describe classification on that split, not trading performance. Use the Backtester for out-of-sample market tests.
          </Caveat>
        </div>
        <div className="flex flex-col gap-2 px-6 py-6 lg:col-span-5">
          <p className="mb-1 text-[13px] font-medium text-white/55">Next steps</p>
          <NextStep
            to={`/tools/analysis?trainer_run=${encodeURIComponent(runId)}`}
            icon={<FlaskConical className="h-4 w-4" />}
            title="Investigate what it learned"
            body="Attribution maps, attention atlas and masking experiments in Analysis."
          />
          <NextStep to="/tools/backtester" icon={<LineChart className="h-4 w-4" />} title="Backtest it" body="Run the model on unseen market periods." />
          <NextStep
            to={`/tools/run-log?tab=models&inspect=${encodeURIComponent(`model:${runId}`)}`}
            icon={<ArrowRight className="h-4 w-4" />}
            title="Open in Review"
            body="Lineage, labels and comparison with your other models."
          />
        </div>
      </div>
    </section>
  );
}

function SmallFigure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12.5px] text-white/45">{label}</p>
      <p className="mt-1 font-digits text-[20px] font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}

function NextStep({ to, icon, title, body }: { to: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-lg border border-white/[0.08] px-4 py-3 transition hover:border-white/25 hover:bg-white/[0.03]">
      <span className="mt-0.5 text-white/60 group-hover:text-white">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-white">{title}</span>
        <span className="block text-[12.5px] text-white/45">{body}</span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 text-white/30 transition group-hover:translate-x-0.5 group-hover:text-white/70" />
    </Link>
  );
}

function FailurePanel({ session, data }: { session: TrainingSession | null; data: TrainerProgressResponse }) {
  const message = session?.error || data.progress?.message || "Training stopped with an error.";
  return (
    <section className="rounded-xl border border-red-400/25 bg-red-400/[0.04] px-6 py-5">
      <h2 className="flex items-center gap-2 text-base font-medium text-red-100">
        <span className="h-2 w-2 rounded-full bg-red-400" />
        Training failed
      </h2>
      <p className="mt-2 pl-4 text-[14px] leading-relaxed text-red-100/80">{message}</p>
      <p className="mt-2 pl-4 text-[12.5px] text-white/45">
        {session?.epochs_completed ? `${session.epochs_completed} epoch(s) completed before the failure; their metrics are shown below.` : "No epoch completed."} No
        model was saved.
      </p>
    </section>
  );
}

function ResumeOffer({ epoch, resuming, onResume }: { epoch: number; resuming: boolean; onResume: () => void }) {
  return (
    <section className={cx(surface, "flex flex-wrap items-center justify-between gap-4 px-6 py-5")} data-help="train-resume">
      <div className="min-w-0 max-w-[70ch]">
        <PanelTitle>Continue this run</PanelTitle>
        <p className="mt-2 pl-4 text-[13.5px] leading-relaxed text-white/60">
          A checkpoint was saved after epoch {epoch}. Resuming continues this run from epoch {epoch + 1} with the same dataset and settings, including
          the early-stopping state. A new training run starts again from epoch 1.
        </p>
      </div>
      <button type="button" className={btnPrimary} onClick={onResume} disabled={resuming}>
        <RefreshCw className={cx("h-4 w-4", resuming && "animate-spin")} /> {resuming ? "Resuming…" : `Resume from epoch ${epoch + 1}`}
      </button>
    </section>
  );
}

function CancelledPanel({ session, stopping }: { session: TrainingSession | null; stopping: boolean }) {
  return (
    <section className={cx(surface, "px-6 py-5")}>
      <PanelTitle muted>{stopping ? "Stopping" : "Training cancelled"}</PanelTitle>
      <p className="mt-2 pl-4 text-[14px] leading-relaxed text-white/55">
        {stopping
          ? "Cancellation was requested. The trainer stops after the batch it is working on, usually within a few seconds."
          : `Cancelled after ${session?.epochs_completed ?? 0} completed epoch(s). Cancelled runs do not save a model.`}
      </p>
    </section>
  );
}

function RunDetails({ session, className }: { session: TrainingSession | null; className?: string }) {
  const c = session?.config;
  const setup = session?.training_setup;
  const method = setup?.validation_method ?? c?.validation_method;
  const validation =
    method === "chronological"
      ? `Most recent period${setup?.val_period ? ` (${setup.val_period.join(" to ")})` : ""}${
          isFiniteNum(setup?.purged_overlapping_train_samples) ? `; ${fmtInt(setup?.purged_overlapping_train_samples)} overlapping training charts left out` : ""
        }`
      : method === "random" || c
        ? "Random sample"
        : null;
  const counts = (m?: Record<string, number> | null) =>
    m && Object.keys(m).length ? Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `label ${k}: ${fmtInt(v)}`).join(" · ") : null;
  const v2 = isProtocol2(session);
  const opts = session?.options;
  const opt = opts?.optimizer;
  const test = session?.evaluation?.test;
  return (
    <Panel
      title="Run details"
      description={
        v2
          ? "Recorded configuration and data split."
          : "Recorded configuration and data split. This run predates Trainer 2.0: it used the original random split and training settings."
      }
      className={className}
    >
      <KV
        rows={[
          ["Dataset", session?.dataset?.name ?? (session?.dataset?.id ? `${session.dataset.id.slice(0, 8)}…` : null)],
          ["Images in dataset", isFiniteNum(session?.dataset?.image_count) ? fmtInt(session?.dataset?.image_count) : null],
          ["Training images", isFiniteNum(session?.train_samples) ? fmtInt(session?.train_samples) : null],
          ["Validation images", isFiniteNum(session?.val_samples) ? fmtInt(session?.val_samples) : null],
          [
            "Test images",
            isFiniteNum(session?.test_samples) && (session?.test_samples ?? 0) > 0
              ? `${fmtInt(session?.test_samples)} · ${test?.status === "reserved_not_evaluated" ? "reserved, not scored" : "scored once at the end"}`
              : null,
          ],
          ["Training labels", counts(session?.train_label_counts)],
          ["Validation labels", counts(session?.val_label_counts)],
          ["Test labels", counts(session?.test_label_counts)],
          ["Market", marketLabel(session?.dataset?.market)],
          ["Image size", c?.image_size ? `${c.image_size[0]} × ${c.image_size[1]} px` : null],
          ["Batch size", c?.batch_size ?? null],
          ["Maximum epochs", c?.epochs ?? null],
          ["Validation split", isFiniteNum(c?.val_split) ? `${Math.round((c?.val_split ?? 0) * 100)}%` : null],
          ["Validation images chosen by", validation],
          ["Random seed", c?.random_seed ?? null],
          ["Network", session?.architecture?.family ?? null],
          ["Model selection", v2 ? `best ${SELECTION_NAME[session?.selection_metric?.name ?? "val_loss"] ?? session?.selection_metric?.name}` : null],
          ["Optimizer", opt ? `${OPTIMIZER_LABEL[opt.name] ?? opt.name} · learning rate ${opt.learning_rate}` : null],
          ["Learning-rate schedule", opts?.lr_schedule ? SCHEDULE_LABEL[opts.lr_schedule.name] ?? opts.lr_schedule.name : null],
          ["Hardware", setup?.device ? `${setup.device}${setup.precision && setup.precision !== "float32" ? ` · ${setup.precision}` : ""}` : null],
          ["Resumed", setup?.resumed_from_epoch ? `from the checkpoint after epoch ${setup.resumed_from_epoch}` : null],
          ["Configuration", c ? (c.use_standard_config ? "Standard" : "Custom") : null],
          ["Started", session?.started_at ? fmtDateTime(session.started_at) : null],
          ["Finished", session?.finished_at ? fmtDateTime(session.finished_at) : null],
        ]}
      />
    </Panel>
  );
}

function describeOptimizer(o: NonNullable<TrainingSession["architecture"]>["optimizer"]): string {
  if (!o) return "not recorded";
  if (typeof o === "string") return o;
  const parts = [`${OPTIMIZER_LABEL[o.name] ?? o.name}, learning rate ${o.learning_rate}`];
  if (o.weight_decay) parts.push(`weight decay ${o.weight_decay}`);
  if (o.momentum) parts.push(`momentum ${o.momentum}`);
  if (o.clipnorm) parts.push(`gradient norm clipped at ${o.clipnorm}`);
  return parts.join(", ");
}

function ArchitecturePanel({ session, className }: { session: TrainingSession | null; className?: string }) {
  const arch = session?.architecture;
  const es = arch?.early_stopping;
  const reg = arch?.regularization;
  const params = session?.model?.parameters ?? arch?.total_params;
  return (
    <Panel
      title="Model"
      description={arch ? `${arch.family}${isFiniteNum(params) ? ` · ${fmtInt(params)} parameters` : ""}` : "Architecture not available for this run."}
      className={className}
    >
      {arch && !arch.layers?.length && arch.stages?.length ? (
        <ol className="space-y-1.5 text-[13px]">
          {arch.stages.map((s) => (
            <li key={s} className="border-t border-white/[0.06] pt-1.5 text-white/80">
              {s}
            </li>
          ))}
        </ol>
      ) : null}
      {arch ? (
        <>
          {arch.layers?.length ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12.5px] text-white/40">
                <th className="py-2 font-medium">Layer</th>
                <th className="py-2 font-medium">Output shape</th>
                <th className="py-2 text-right font-medium">Parameters</th>
              </tr>
            </thead>
            <tbody>
              {arch.layers.map((l, i) => (
                <tr key={i} className="border-t border-white/[0.06]">
                  <td className="py-2 text-white/85">
                    {l.name}
                    {l.activation ? <span className="ml-2 text-white/35">{l.activation}</span> : null}
                  </td>
                  <td className="py-2 font-digits tabular-nums text-white/60">{l.shape ? l.shape.join(" × ") : "—"}</td>
                  <td className="py-2 text-right font-digits tabular-nums text-white/60">{l.params ? fmtInt(l.params) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          ) : null}
          <Caveat>
            Loss {arch.loss}; optimizer {describeOptimizer(arch.optimizer)}
            {arch.lr_schedule && arch.lr_schedule.name !== "constant" ? `; learning rate ${SCHEDULE_LABEL[arch.lr_schedule.name]?.toLowerCase()}` : ""}
            {reg && (reg.dropout != null || reg.l2) ? `; ${[reg.dropout != null ? `dropout ${reg.dropout}` : null, reg.l2 ? `L2 ${reg.l2}` : null].filter(Boolean).join(", ")}` : ""}
            .{" "}
            {es
              ? es.enabled === false
                ? `No early stopping; the best ${SELECTION_NAME[es.monitor] ?? es.monitor} epoch is kept.`
                : `Early stopping monitors ${SELECTION_NAME[es.monitor] ?? es.monitor} with patience ${es.patience} and restores the best weights.`
              : null}
          </Caveat>
        </>
      ) : null}
    </Panel>
  );
}

function EpochLog({ session, message }: { session: TrainingSession | null; message?: string }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => [...(session?.history ?? [])].reverse(), [session?.history]);
  const hasV2 = rows.some((r) => isFiniteNum(r.val_auc) || isFiniteNum(r.learning_rate));
  return (
    <section className={surface}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-4 text-left" aria-expanded={open}>
        <PanelTitle muted>Epoch log</PanelTitle>
        <span className="flex items-center gap-3 text-[12.5px] text-white/40">
          {message ? <span className="hidden max-w-[40ch] truncate sm:inline">Latest: {message}</span> : null}
          <ChevronDown className={cx("h-4 w-4 transition", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
        <div className="max-h-80 overflow-y-auto border-t border-white/[0.07] px-5 py-3">
          {rows.length ? (
            <table className="w-full font-digits text-[12.5px] tabular-nums">
              <thead>
                <tr className="text-left text-white/40">
                  <th className="py-1.5 font-normal">Epoch</th>
                  <th className="py-1.5 font-normal">Finished</th>
                  <th className="py-1.5 text-right font-normal">Loss</th>
                  <th className="py-1.5 text-right font-normal">Accuracy</th>
                  <th className="py-1.5 text-right font-normal">Val. loss</th>
                  <th className="py-1.5 text-right font-normal">Val. accuracy</th>
                  {hasV2 ? (
                    <>
                      <th className="py-1.5 text-right font-normal">Val. bal. acc.</th>
                      <th className="py-1.5 text-right font-normal">Val. ROC-AUC</th>
                      <th className="py-1.5 text-right font-normal">Learning rate</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="text-white/75">
                {rows.map((r) => (
                  <tr key={r.epoch} className={cx("border-t border-white/[0.05]", r.epoch === session?.best_epoch && "text-white")}>
                    <td className="py-1.5">
                      {r.epoch}
                      {r.epoch === session?.best_epoch ? <span className="ml-2 text-[11.5px]" style={{ color: SEMANTIC.validation }}>best</span> : null}
                    </td>
                    <td className="py-1.5 text-white/45">{r.timestamp ? new Date(r.timestamp * 1000).toLocaleTimeString("en-GB") : MISSING}</td>
                    <td className="py-1.5 text-right">{fmtNum(r.loss, 4)}</td>
                    <td className="py-1.5 text-right">{fmtPct(r.accuracy, 1)}</td>
                    <td className="py-1.5 text-right">{fmtNum(r.val_loss, 4)}</td>
                    <td className="py-1.5 text-right">{fmtPct(r.val_accuracy, 1)}</td>
                    {hasV2 ? (
                      <>
                        <td className="py-1.5 text-right">{fmtPct(r.val_balanced_accuracy, 1)}</td>
                        <td className="py-1.5 text-right">{fmtNum(r.val_auc, 3)}</td>
                        <td className="py-1.5 text-right">{isFiniteNum(r.learning_rate) ? r.learning_rate.toExponential(2) : MISSING}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-2 text-[13px] text-white/40">No epochs recorded yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SessionSkeleton({ reconnecting }: { reconnecting: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5 pb-10" aria-busy="true">
      <div className="space-y-2 pt-1">
        <div className="h-4 w-40 rounded bg-white/[0.06]" />
        <div className="h-8 w-80 rounded bg-white/[0.08]" />
        <div className="h-4 w-64 rounded bg-white/[0.05]" />
      </div>
      <div className={cx(surface, "h-16")} />
      <div className={cx(surface, "h-56")} />
      <div className={cx(surface, "h-80")} />
      <p className="text-[13px] text-white/40">{reconnecting ? "Still trying to reach the server…" : "Restoring training session…"}</p>
    </div>
  );
}
