import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, Play, RotateCcw, Search } from "lucide-react";
import { improveApi, internalModelsApi, type ImproveExperiment, type ImproveSession, type InternalModel } from "@/lib/api";
import { RunCost } from "@/components/RunCostHint";
import { btn, btnSm, cx, EmptyState, surface } from "@/features/review/components/primitives";
import { fmtInt, fmtNum, fmtPct, MISSING } from "@/lib/viz/format";
import { VARIANT_COPY, type Variant } from "./variants";
import { changeLines, experimentTitle, VERDICT_COPY } from "./workspace";

export function Shell({ children, intro }: { children: React.ReactNode; intro?: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-5 pb-12">
      {intro ?? (
        <header data-help="improve-why">
          <h1 className="text-[22px] font-medium text-white">Improve model</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-white/50">
            Diagnose a model, test one controlled change at a time against it, and keep only what clearly helps.
          </p>
        </header>
      )}
      {children}
    </div>
  );
}

export function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-white/40">{k}</dt>
      <dd className="truncate text-white/80">{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- model selection

export function modelName(m: Pick<InternalModel, "display_name" | "auto_name" | "name" | "model_id">): string {
  return (m.display_name || m.auto_name || m.name || m.model_id).replace(/\.keras$/i, "");
}

function stocks(symbols?: string | null): string | null {
  if (!symbols) return null;
  const list = symbols.split(/[,\s]+/).filter(Boolean);
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} +${list.length - 3}` : list.join(", ");
}

export const TIMEFRAME: Record<string, string> = { "1d": "Daily", "1wk": "Weekly", "1mo": "Monthly", "1h": "Hourly" };

function created(at: InternalModel["created_at"]): string | null {
  if (at == null) return null;
  const ms = typeof at === "number" ? (at < 1e12 ? at * 1000 : at) : Date.parse(at);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
}

/** A quick read of the recorded train/validation accuracy; the full Model Health runs once a model is opened. */
function quickHealth(m: InternalModel): { text: string; tone: "ok" | "warn" | "muted" } {
  const tr = m.metrics?.accuracy;
  const va = m.metrics?.val_accuracy;
  if (va == null) return { text: "No validation metrics recorded", tone: "muted" };
  if (tr != null && tr - va > 0.1) return { text: `Validation ${fmtPct(va, 1)} · train–val gap ${fmtPct(tr - va, 0)}`, tone: "warn" };
  return { text: `Validation accuracy ${fmtPct(va, 1)}`, tone: "ok" };
}

export function ModelPicker({ onPick }: { onPick: (runId: string) => void }) {
  const [models, setModels] = useState<InternalModel[] | null>(null);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(9);
  const [technical, setTechnical] = useState(false);
  useEffect(() => {
    internalModelsApi.list().then(({ models }) => setModels(models)).catch(() => setModels([]));
  }, []);
  const trained = useMemo(
    () =>
      (models ?? [])
        .filter((m) => m.kind === "trained" && m.training_run_id && m.lifecycle !== "archived" && !m.archived)
        .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0)),
    [models],
  );
  const match = (m: InternalModel) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [modelName(m), m.symbols, m.timeframe, ...(m.tags ?? []), technical ? m.training_run_id : null].some((x) => x?.toLowerCase().includes(s));
  };
  const originals = trained.filter((m) => m.lifecycle !== "candidate" && match(m));
  const candidates = trained.filter((m) => m.lifecycle === "candidate" && match(m));

  return (
    <Shell
      intro={
        <header className="pt-2" data-help="improve-why">
          <h1 className="text-[28px] font-medium tracking-tight text-white sm:text-[32px]">
            Make your models better<span className="accent-period">.</span>
          </h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-white/55">
            Select a trained model. Convolve will diagnose its weaknesses and help you test improvements through controlled experiments.
          </p>
        </header>
      }
    >
      {!models ? (
        <p className="flex items-center gap-2 text-[13px] text-white/45">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your models…
        </p>
      ) : !trained.length ? (
        <EmptyState
          title="No trained models yet"
          body="Train a model first. Improve then diagnoses it and runs controlled experiments against it."
          action={<Link to="/tools/trainer" className={btn}>Open the Trainer</Link>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, stock or tag"
                aria-label="Search models"
                className="h-10 w-full rounded-xl border border-white/15 bg-white/[0.03] pl-9 pr-3 text-[14px] text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-white/45">
              <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} /> Show technical details
            </label>
          </div>

          <section aria-label="Your models">
            <p className="mb-3 text-[12px] uppercase tracking-wide text-white/40">{q ? `${originals.length} matching models` : "Recent models"}</p>
            {originals.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {originals.slice(0, limit).map((m) => (
                  <ModelCard key={m.model_id} m={m} technical={technical} cta="Improve Model" onPick={onPick} />
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-white/45">No models match “{q}”.</p>
            )}
            {originals.length > limit ? (
              <button type="button" className={cx(btnSm, "mt-3")} onClick={() => setLimit((n) => n + 12)}>
                Show more ({originals.length - limit})
              </button>
            ) : null}
          </section>

          {candidates.length ? (
            <details className="group">
              <summary className="cursor-pointer text-[12.5px] text-white/45 hover:text-white/75">
                Undecided experiments ({candidates.length}): open their original model's workspace
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {candidates.slice(0, 12).map((m) => (
                  <ModelCard key={m.model_id} m={m} technical={technical} cta="Open workspace" onPick={onPick} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </Shell>
  );
}

function ModelCard({ m, technical, cta, onPick }: { m: InternalModel; technical: boolean; cta: string; onPick: (id: string) => void }) {
  const h = quickHealth(m);
  const meta = [stocks(m.symbols), m.timeframe ? TIMEFRAME[m.timeframe] ?? m.timeframe : null, created(m.created_at)].filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onPick(m.training_run_id!)}
      className={cx(
        surface,
        "convolve-press group flex flex-col items-start gap-2 p-4 text-left transition hover:border-white/30 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--convolve-focus-ring)]",
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[15px] font-medium text-white">{modelName(m)}</p>
        {m.lifecycle === "kept" ? <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/55">Kept from Improve</span> : null}
      </div>
      <p className="truncate text-[12.5px] text-white/50">{meta.join(" · ") || "Market details not recorded"}</p>
      <p className={cx("text-[12.5px]", h.tone === "warn" ? "text-amber-200/80" : h.tone === "ok" ? "text-white/65" : "text-white/35")}>{h.text}</p>
      {technical ? <p className="font-digits text-[11px] text-white/35">{m.training_run_id}</p> : null}
      <span className="accent-text mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-white/85 group-hover:text-white">
        {cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- evidence

export function NoiseStrip({
  ws,
  seed,
  cost,
  launching,
  blocked,
  onConfigure,
}: {
  ws: ImproveSession;
  seed: Variant | null;
  cost: Record<string, unknown> | null;
  launching: boolean;
  blocked: boolean;
  onConfigure: (v: Variant) => void;
}) {
  const n = ws.noise;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3" data-help="improve-noise">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: Math.max(n.required, n.baseline_runs) }, (_, i) => (
            <span key={i} className={cx("h-2 w-5 rounded-full", i < n.baseline_runs ? "bg-white/70" : "bg-white/[0.1]")} />
          ))}
        </div>
        <p className="min-w-0 text-[13px] text-white/70">
          {n.sufficient ? (
            <>
              Seed evidence complete: {n.baseline_runs} runs of the original settings (ROC-AUC spread {fmtNum(n.seed_sd, 3)}).
            </>
          ) : (
            <>
              Seed evidence: {n.baseline_runs} of {n.required} runs of the original settings. Until there are {n.required}, no experiment can be called clearly better or worse.
            </>
          )}
        </p>
      </div>
      {seed?.available && !n.sufficient ? (
        <button type="button" className={btnSm} disabled={launching || blocked} onClick={() => onConfigure(seed)}>
          <Play className="h-3.5 w-3.5" aria-hidden /> Add seed run {cost ? <RunCost tool="trainer" params={cost} /> : null}
        </button>
      ) : null}
    </div>
  );
}

const TONE: Record<string, string> = {
  good: "border-emerald-300/30 bg-emerald-300/[0.06] text-emerald-200",
  bad: "border-red-300/30 bg-red-300/[0.05] text-red-200",
  neutral: "border-white/20 text-white/75",
  muted: "border-white/10 text-white/50",
};

export function VerdictBadge({ e, label, tone }: { e?: Pick<ImproveExperiment, "verdict">; label?: string; tone?: string }) {
  const c = e ? VERDICT_COPY[e.verdict.verdict] ?? VERDICT_COPY.pending : null;
  return <span className={cx("inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[12px]", TONE[tone ?? c?.tone ?? "muted"])}>{label ?? c?.label}</span>;
}

export const delta = (d: number | null | undefined, digits: number, higherBetter: boolean) => {
  if (d == null || Math.abs(d) < 10 ** -digits) return null;
  const good = higherBetter ? d > 0 : d < 0;
  return (
    <span className={cx("ml-1 text-[11px]", good ? "text-emerald-300/80" : "text-red-300/80")}>
      {d > 0 ? "+" : ""}
      {d.toFixed(digits)}
    </span>
  );
};

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
    <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-white/65">
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

// ---------------------------------------------------------------- advanced

export function ResultsTable({ ws }: { ws: ImproveSession }) {
  const done = ws.experiments.filter((e) => e.metrics && e.group !== "failed");
  const a = ws.anchor.metrics;
  return (
    <section data-help="improve-results">
      <p className="text-[14px] font-medium text-white">All results against the original (validation)</p>
      <p className="mt-0.5 text-[12.5px] text-white/45">Same validation charts for every controlled row. Differences are always relative to the original model.</p>
      {!done.length ? (
        <p className="mt-3 text-[13px] text-white/45">No completed experiments yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
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
                  <p className="text-[13px] text-white/85">Original</p>
                  <p className="font-digits text-[11.5px] text-white/35">{ws.anchor.run_id}</p>
                </td>
                <td className="py-2.5 pr-3 text-[12px] text-white/45">baseline</td>
                <Cells m={a} />
              </tr>
              {done.map((e) => (
                <tr key={e.run_id} className={cx("border-b border-white/[0.05] align-top", e.lifecycle === "archived" && "opacity-55")}>
                  <td className="max-w-[300px] py-2.5 pr-3">
                    <Link className="text-white/85 hover:underline" to={`/tools/trainer/runs/${e.run_id}`}>
                      {experimentTitle(e, VARIANT_COPY)}
                    </Link>
                    <p className="truncate text-[11.5px] text-white/40">{changeLines(e).join("; ") || "—"}</p>
                    <p className="font-digits text-[11px] text-white/30">{e.run_id}</p>
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
    </section>
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
