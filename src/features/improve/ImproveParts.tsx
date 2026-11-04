import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArrowLeft, Check, FlaskConical, Loader2, Play, RotateCcw } from "lucide-react";
import { improveApi, internalModelsApi, type ImproveExperiment, type ImproveSession, type InternalModel } from "@/lib/api";
import { RunCost } from "@/components/RunCostHint";
import { btn, btnPrimary, btnSm, cx, EmptyState, Panel } from "@/features/review/components/primitives";
import { fmtInt, fmtNum, fmtPct, MISSING } from "@/lib/viz/format";
import type { Variant } from "./variants";
import { changeLines, suggestion, VERDICT_COPY } from "./workspace";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-5 pb-10">
      <div>
        <Link to="/tools/run-log" className="inline-flex items-center gap-1 text-[13px] text-white/45 hover:text-white/80">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Search Hub
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-[22px] font-medium text-white">
          <FlaskConical className="h-5 w-5 text-white/60" aria-hidden /> Improve model
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-normal uppercase tracking-wide text-white/50">Experimental</span>
        </h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-white/50">
          Run controlled experiments against one original model: same data, same chronological split, one change at a time. Every result is judged against that
          original, with seed replicates to tell real gains from run-to-run noise. Validation results are not trading results; confirm any winner with a backtest on
          a later, untouched test period.
        </p>
      </div>
      {children}
    </div>
  );
}

export function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-white/40">{k}</dt>
      <dd className="truncate text-white/80">{v}</dd>
    </div>
  );
}

export function ModelPicker({ onPick }: { onPick: (runId: string) => void }) {
  const [models, setModels] = useState<InternalModel[] | null>(null);
  useEffect(() => {
    internalModelsApi.list().then(({ models }) => setModels(models)).catch(() => setModels([]));
  }, []);
  const trained = (models ?? []).filter((m) => m.kind === "trained" && m.training_run_id && m.lifecycle !== "archived");
  const originals = trained.filter((m) => m.lifecycle !== "candidate");
  const candidates = trained.filter((m) => m.lifecycle === "candidate");
  const row = (m: InternalModel, label: string) => (
    <li key={m.model_id} className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[14px] text-white/85">{m.display_name ?? m.name ?? m.model_id}</p>
        <p className="font-digits text-[12px] text-white/40">
          {m.training_run_id}
          {m.lifecycle === "kept" ? " · kept from Improve" : ""}
        </p>
      </div>
      <button type="button" className={btnSm} onClick={() => onPick(m.training_run_id!)}>
        {label}
      </button>
    </li>
  );
  return (
    <Shell>
      <Panel title="Choose a model to improve" description="Pick the original model. Every experiment you run is compared with it.">
        {!models ? (
          <p className="text-[13px] text-white/45">Loading your models…</p>
        ) : !trained.length ? (
          <EmptyState
            title="No trained models yet"
            body="Train a model first; Improve then runs controlled experiments against it."
            action={<Link to="/tools/trainer" className={btn}>Open the Trainer</Link>}
          />
        ) : (
          <>
            <ul className="divide-y divide-white/[0.06]">{originals.slice(0, 40).map((m) => row(m, "Improve"))}</ul>
            {candidates.length ? (
              <>
                <p className="mt-4 text-[12px] uppercase tracking-wide text-white/40">Undecided experiments (opens their original's workspace)</p>
                <ul className="divide-y divide-white/[0.06]">{candidates.slice(0, 20).map((m) => row(m, "Open workspace"))}</ul>
              </>
            ) : null}
          </>
        )}
      </Panel>
    </Shell>
  );
}

export function NoisePanel({
  ws,
  seed,
  cost,
  launching,
  blocked,
  onLaunch,
}: {
  ws: ImproveSession;
  seed: Variant | null;
  cost: Record<string, unknown> | null;
  launching: string | null;
  blocked: boolean;
  onLaunch: (v: Variant) => void;
}) {
  const n = ws.noise;
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <p className="text-[14px] font-medium text-white">
            Run-to-run noise: {n.baseline_runs} of {n.required} runs of the original settings
            {n.sufficient ? <span className="ml-2 text-[12.5px] font-normal text-emerald-200/85">enough for verdicts</span> : null}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">
            {n.sufficient
              ? `Seed-to-seed spread of ROC-AUC: ${fmtNum(n.seed_sd, 3)}. Verdicts compare each experiment with this spread and with the validation sampling error.`
              : "Training the same settings with another seed gives a different model. Until the original settings have run with at least three seeds, no experiment can be called clearly better or worse; every verdict stays \"insufficient evidence\"."}
          </p>
        </div>
        {seed && seed.available ? (
          <button type="button" className={cx(n.sufficient ? btn : btnPrimary, "h-8 px-3 text-[13px]")} disabled={!!launching || blocked} onClick={() => onLaunch(seed)}>
            {launching === `seed:${seed.replicate}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            Add seed replicate (seed {seed.request.random_seed}) {cost ? <RunCost tool="trainer" params={cost} /> : null}
          </button>
        ) : null}
      </div>
    </section>
  );
}

const TONE: Record<string, string> = {
  good: "border-emerald-300/30 text-emerald-200",
  bad: "border-red-300/30 text-red-200",
  neutral: "border-white/20 text-white/75",
  muted: "border-white/10 text-white/50",
};

export function VerdictBadge({ e }: { e: Pick<ImproveExperiment, "verdict"> }) {
  const c = VERDICT_COPY[e.verdict.verdict] ?? VERDICT_COPY.pending;
  return <span className={cx("inline-flex rounded-full border px-2 py-0.5 text-[12px]", TONE[c.tone])}>{c.label}</span>;
}

const delta = (d: number | null | undefined, digits: number, higherBetter: boolean) => {
  if (d == null || Math.abs(d) < 10 ** -digits) return null;
  const good = higherBetter ? d > 0 : d < 0;
  return (
    <span className={cx("ml-1 text-[11px]", good ? "text-emerald-300/80" : "text-red-300/80")}>
      {d > 0 ? "+" : ""}
      {d.toFixed(digits)}
    </span>
  );
};

export function DecisionCard({
  e,
  onDone,
  onRepeat,
  repeatCost,
  launching,
}: {
  e: ImproveExperiment;
  onDone: () => void;
  onRepeat: () => void;
  repeatCost: Record<string, unknown> | null;
  launching: boolean;
}) {
  const [confirming, setConfirming] = useState<"keep" | "discard" | null>(null);
  const [preferred, setPreferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = suggestion(e);
  const m = e.metrics;
  const decide = async (action: "keep" | "discard") => {
    setBusy(true);
    setErr(null);
    try {
      await improveApi.decide(e.run_id, action, action === "keep" && preferred);
      setConfirming(null);
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not save the decision");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={cx("rounded-xl border p-4", s.action === "keep" ? "border-emerald-300/25 bg-emerald-300/[0.03]" : "border-white/[0.08]")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/tools/trainer/runs/${e.run_id}`} className="text-[14.5px] font-medium text-white hover:underline">
            {e.display_name ?? e.name ?? e.run_id}
          </Link>
          <p className="font-digits text-[11.5px] text-white/35">{e.run_id}</p>
        </div>
        <VerdictBadge e={e} />
      </div>
      <ul className="mt-2 space-y-0.5 font-digits text-[12.5px] text-white/70">
        {changeLines(e).map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {!e.direct && e.parent_run_id ? (
        <p className="mt-1 text-[12px] text-amber-200/80">Built on another experiment ({e.parent_run_id}); its changes stack on the original.</p>
      ) : null}
      {m ? (
        <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1 text-[12.5px]">
          <Metric k="ROC-AUC" v={fmtNum(m.roc_auc, 3)} d={delta(e.deltas?.roc_auc, 3, true)} />
          <Metric k="PR-AUC" v={fmtNum(m.pr_auc, 3)} d={delta(e.deltas?.pr_auc, 3, true)} />
          <Metric k="Balanced acc." v={fmtNum(m.balanced_accuracy, 3)} d={delta(e.deltas?.balanced_accuracy, 3, true)} />
          <Metric k="Log loss" v={fmtNum(m.log_loss, 3)} d={delta(e.deltas?.log_loss, 3, false)} />
          <Metric k="Train − val" v={m.train_val_gap == null ? MISSING : fmtPct(m.train_val_gap, 1)} d={null} />
          <Metric k="Parameters" v={fmtInt(m.parameters)} d={null} />
        </dl>
      ) : null}
      <p className="mt-3 text-[12.5px] leading-relaxed text-white/60">{e.verdict.reason}</p>
      {e.verdict.efficiency ? <p className="mt-1 text-[12.5px] text-white/50">{e.verdict.efficiency}</p> : null}
      {s.text ? <p className="mt-2 text-[12.5px] text-white/75">{s.text}</p> : null}
      {confirming ? (
        <div className="mt-3 rounded-lg border border-white/15 bg-black/30 p-3 text-[13px]">
          {confirming === "keep" ? (
            <>
              <p className="text-white/80">Keep this model? It moves into your model library with its full experiment and lineage record.</p>
              <label className="mt-2 flex items-center gap-2 text-white/65">
                <input type="checkbox" checked={preferred} onChange={(x) => setPreferred(x.target.checked)} /> Mark as the preferred version of the original
              </label>
            </>
          ) : (
            <p className="text-white/80">Archive this experiment? It disappears from your library and tools. Its files are kept and you can restore it here.</p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" className={cx(btnPrimary, "h-8 px-3 text-[13px]")} disabled={busy} onClick={() => void decide(confirming)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {confirming === "keep" ? "Confirm keep" : "Confirm archive"}
            </button>
            <button type="button" className={btnSm} disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={cx(s.action === "keep" ? btnPrimary : btn, "h-8 px-3 text-[13px]")} onClick={() => setConfirming("keep")}>
            <Check className="h-3.5 w-3.5" aria-hidden /> Keep
          </button>
          <button type="button" className={cx(s.action === "discard" ? btnPrimary : btn, "h-8 px-3 text-[13px]")} onClick={() => setConfirming("discard")}>
            <Archive className="h-3.5 w-3.5" aria-hidden /> Archive
          </button>
          {e.variant_key && !e.is_replicate ? (
            <button type="button" className={btnSm} disabled={launching} onClick={onRepeat}>
              Repeat with a new seed {repeatCost ? <RunCost tool="trainer" params={repeatCost} /> : null}
            </button>
          ) : null}
        </div>
      )}
      {err ? <p className="mt-2 text-[12.5px] text-red-300">{err}</p> : null}
    </article>
  );
}

function Metric({ k, v, d }: { k: string; v: string; d: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-white/40">{k}</dt>
      <dd className="font-digits tabular-nums text-white/80">
        {v}
        {d}
      </dd>
    </div>
  );
}

export function RestoreButton({ runId, onDone }: { runId: string; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirm)
    return (
      <button type="button" className={btnSm} onClick={() => setConfirm(true)}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
      </button>
    );
  return (
    <span className="flex items-center gap-2 text-[12.5px] text-white/65">
      Back to awaiting decision?
      <button
        type="button"
        className={btnSm}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await improveApi.decide(runId, "restore");
            onDone();
          } finally {
            setBusy(false);
            setConfirm(false);
          }
        }}
      >
        Confirm
      </button>
      <button type="button" className={btnSm} onClick={() => setConfirm(false)}>
        Cancel
      </button>
    </span>
  );
}

export function ResultsTable({ ws }: { ws: ImproveSession }) {
  const done = ws.experiments.filter((e) => e.metrics && e.group !== "failed");
  const a = ws.anchor.metrics;
  return (
    <Panel
      title="All results against the original (validation)"
      description="Same validation charts for every controlled row. Differences are always relative to the original model, never to another experiment."
    >
      {!done.length ? (
        <p className="text-[13px] text-white/45">No completed experiments yet. Launched experiments appear here as soon as they finish.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left text-[12px] text-white/45">
                <th className="py-2 pr-3 font-normal">Model</th>
                <th className="py-2 pr-3 font-normal">Verdict</th>
                <th className="py-2 pr-3 text-right font-normal">ROC-AUC</th>
                <th className="py-2 pr-3 text-right font-normal">PR-AUC</th>
                <th className="py-2 pr-3 text-right font-normal">Bal. acc.</th>
                <th className="py-2 pr-3 text-right font-normal">Log loss</th>
                <th className="py-2 pr-3 text-right font-normal">Val loss</th>
                <th className="py-2 pr-3 text-right font-normal">Train − val</th>
                <th className="py-2 pr-3 text-right font-normal">Saved epoch</th>
                <th className="py-2 text-right font-normal">Parameters</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/[0.05] align-top">
                <td className="py-2.5 pr-3">
                  <p className="text-white/85">Original</p>
                  <p className="font-digits text-[11.5px] text-white/35">{ws.anchor.run_id}</p>
                </td>
                <td className="py-2.5 pr-3 text-[12px] text-white/45">baseline</td>
                <Cells m={a} />
              </tr>
              {done.map((e) => (
                <tr key={e.run_id} className={cx("border-b border-white/[0.05] align-top", e.lifecycle === "archived" && "opacity-55")}>
                  <td className="max-w-[300px] py-2.5 pr-3">
                    <Link className="text-white/85 hover:underline" to={`/tools/trainer/runs/${e.run_id}`}>
                      {e.display_name ?? e.name ?? e.run_id}
                    </Link>
                    <p className="truncate text-[11.5px] text-white/40">{changeLines(e).join("; ") || "—"}</p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <VerdictBadge e={e} />
                  </td>
                  <Cells m={e.metrics} d={e.deltas} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Cells({ m, d }: { m: ImproveSession["anchor"]["metrics"]; d?: ImproveExperiment["deltas"] }) {
  const cell = "py-2.5 pr-3 text-right font-digits tabular-nums text-white/80";
  return (
    <>
      <td className={cell}>{fmtNum(m?.roc_auc, 3)}{delta(d?.roc_auc, 3, true)}</td>
      <td className={cell}>{fmtNum(m?.pr_auc, 3)}{delta(d?.pr_auc, 3, true)}</td>
      <td className={cell}>{fmtNum(m?.balanced_accuracy, 3)}{delta(d?.balanced_accuracy, 3, true)}</td>
      <td className={cell}>{fmtNum(m?.log_loss, 3)}{delta(d?.log_loss, 3, false)}</td>
      <td className={cell}>{fmtNum(m?.val_loss, 3)}{delta(d?.val_loss, 3, false)}</td>
      <td className={cell}>{m?.train_val_gap == null ? MISSING : fmtPct(m.train_val_gap, 1)}</td>
      <td className={cell}>{m?.saved_epoch ?? MISSING} / {m?.epochs_trained ?? MISSING}</td>
      <td className="py-2.5 text-right font-digits tabular-nums text-white/70">{fmtInt(m?.parameters)}</td>
    </>
  );
}
