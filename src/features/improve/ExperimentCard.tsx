import { useState } from "react";
import { Link } from "react-router-dom";
import { Archive, Check, ChevronDown, ExternalLink, Loader2, RefreshCw, Star } from "lucide-react";
import { improveApi, type ImproveExperiment, type ImproveMetrics, type ImproveSession } from "@/lib/api";
import { btnPrimary, btnSm, cx, StatusPill } from "@/features/review/components/primitives";
import { fmtInt, fmtNum, fmtPct, MISSING } from "@/lib/viz/format";
import { VARIANT_COPY } from "./variants";
import { changeLines, experimentTitle, resultCopy } from "./workspace";
import { delta, RestoreButton, VerdictBadge } from "./ImproveParts";

const anchorLink = (runId: string) => `/tools/improve?model=${encodeURIComponent(`trained:${runId}`)}&anchor=self`;

export function RunningCard({ e }: { e: ImproveExperiment }) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-white/[0.1] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-[14.5px] font-medium text-white">{experimentTitle(e, VARIANT_COPY)}</p>
        <StatusPill status={e.status} />
      </div>
      <p className="text-[12.5px] text-white/50">{changeLines(e).join("; ") || "Same settings as the original"}</p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <div className="h-full w-1/3 animate-indeterminate rounded-full bg-[rgba(var(--convolve-accent-rgb),0.6)] motion-reduce:animate-none" />
      </div>
      <p className="text-[12px] text-white/40">
        Training on the original's data and split. The result is compared automatically when it finishes; you can leave this page.{" "}
        <Link to={`/tools/trainer/runs/${e.run_id}`} className="text-white/65 underline-offset-2 hover:underline">
          Watch training
        </Link>
      </p>
    </article>
  );
}

export function ExperimentCard({
  e,
  ws,
  onDone,
  onSeedOriginal,
  onRepeat,
  busy,
}: {
  e: ImproveExperiment;
  ws: ImproveSession;
  onDone: () => void;
  onSeedOriginal: () => void;
  onRepeat: (() => void) | null;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<"keep" | "discard" | null>(null);
  const [preferred, setPreferred] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = resultCopy(e, ws.noise);
  const a = ws.anchor.metrics;
  const m = e.metrics;
  const awaiting = e.group === "awaiting_decision";
  const d = e.deltas?.roc_auc ?? null;

  const decide = async (action: "keep" | "discard") => {
    setSaving(true);
    setErr(null);
    try {
      await improveApi.decide(e.run_id, action, action === "keep" && preferred);
      setConfirming(null);
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not save the decision");
    } finally {
      setSaving(false);
    }
  };

  const primary = (() => {
    if (!awaiting) return null;
    switch (c.next.kind) {
      case "keep":
        return (
          <button type="button" className={btnPrimary} onClick={() => setConfirming("keep")}>
            <Check className="h-4 w-4" aria-hidden /> {c.next.label}
          </button>
        );
      case "archive":
        return (
          <button type="button" className={btnPrimary} onClick={() => setConfirming("discard")}>
            <Archive className="h-4 w-4" aria-hidden /> {c.next.label}
          </button>
        );
      case "seed_original":
        return (
          <button type="button" className={btnPrimary} disabled={busy} onClick={onSeedOriginal}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {c.next.label}
          </button>
        );
      case "repeat":
        return onRepeat ? (
          <button type="button" className={btnPrimary} disabled={busy} onClick={onRepeat}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {c.next.label}
          </button>
        ) : null;
      default:
        return null;
    }
  })();

  return (
    <article
      className={cx(
        "flex flex-col rounded-xl border p-4 transition-colors",
        c.tone === "good" && awaiting ? "border-emerald-300/25 bg-emerald-300/[0.025]" : "border-white/[0.1] bg-white/[0.015]",
        e.group === "archived" && "opacity-70",
      )}
      data-help="improve-verdict"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-white">{experimentTitle(e, VARIANT_COPY)}</p>
          <p className="mt-0.5 text-[12px] text-white/45">
            {e.group === "kept" ? (
              <span className="inline-flex items-center gap-1 text-white/70">
                Kept in your library
                {e.decision?.preferred ? (
                  <>
                    {" "}
                    · <Star className="h-3 w-3 text-amber-200/90" aria-hidden /> preferred version
                  </>
                ) : null}
              </span>
            ) : e.group === "archived" ? (
              "Archived"
            ) : (
              "Awaiting your decision"
            )}
          </p>
        </div>
        <VerdictBadge label={c.label} tone={c.tone} />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[12px] text-white/45">Validation ROC-AUC</span>
        <span className="font-digits text-[18px] tabular-nums text-white">
          {fmtNum(a?.roc_auc, 3)} <span className="text-white/35">→</span> {fmtNum(m?.roc_auc, 3)}
        </span>
        {d != null ? (
          <span className={cx("font-digits text-[13px] tabular-nums", c.tone === "good" ? "text-emerald-300/85" : c.tone === "bad" ? "text-red-300/85" : "text-white/55")}>
            {d > 0 ? "+" : ""}
            {d.toFixed(3)}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-white/75">{c.meaning}</p>
      {e.verdict.reason ? <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">{e.verdict.reason}</p> : null}
      {awaiting && c.next.why ? <p className="mt-2 text-[12.5px] text-white/60">Next: {c.next.why}</p> : null}
      {!e.direct && e.parent_run_id ? <p className="mt-1 text-[12px] text-amber-200/80">Built on another experiment, so its changes stack on the original.</p> : null}

      {confirming ? (
        <div className="mt-3 rounded-lg border border-white/15 bg-black/30 p-3 text-[13px]">
          {confirming === "keep" ? (
            <>
              <p className="text-[13px] text-white/80">
                Keep this model? It joins your model library with its full experiment and lineage record. The original stays unchanged and stays the reference for
                this session.
              </p>
              {c.next.kind !== "keep" ? <p className="text-[13px] mt-1 text-amber-200/80">The evidence does not show a clear improvement over the original.</p> : null}
              <label className="mt-2 flex items-center gap-2 text-white/65">
                <input type="checkbox" checked={preferred} onChange={(x) => setPreferred(x.target.checked)} /> Mark as the preferred version of the original
              </label>
            </>
          ) : (
            <p className="text-[13px] text-white/80">Archive this experiment? It is hidden from your library and tools, never deleted, and you can restore it here at any time.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={saving} onClick={() => void decide(confirming)}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {confirming === "keep" ? "Confirm keep" : "Confirm archive"}
            </button>
            <button type="button" className={btnSm} disabled={saving} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {primary}
          {awaiting && c.next.kind !== "keep" && !e.is_replicate ? (
            <button type="button" className={btnSm} onClick={() => setConfirming("keep")}>
              Keep anyway
            </button>
          ) : null}
          {awaiting && c.next.kind !== "archive" ? (
            <button type="button" className={btnSm} onClick={() => setConfirming("discard")}>
              <Archive className="h-3.5 w-3.5" aria-hidden /> Archive
            </button>
          ) : null}
          {e.group === "archived" ? <RestoreButton runId={e.run_id} onDone={onDone} /> : null}
          {e.group === "kept" ? (
            <Link className={btnSm} to={anchorLink(e.run_id)} title="Opens a new session in which this kept model is the fixed original">
              Start new session with this model
            </Link>
          ) : null}
        </div>
      )}
      {err ? <p className="mt-2 text-[12.5px] text-red-300">{err}</p> : null}

      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 self-start text-[12.5px] text-white/50 transition hover:text-white/85"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden /> View detailed comparison
      </button>
      {open ? <Detail e={e} a={a} /> : null}
    </article>
  );
}

function Detail({ e, a }: { e: ImproveExperiment; a: ImproveMetrics | null }) {
  const m = e.metrics;
  const v = e.verdict;
  const rows: [string, string, string, React.ReactNode][] = [
    ["ROC-AUC", fmtNum(a?.roc_auc, 3), fmtNum(m?.roc_auc, 3), delta(e.deltas?.roc_auc, 3, true)],
    ["PR-AUC", fmtNum(a?.pr_auc, 3), fmtNum(m?.pr_auc, 3), delta(e.deltas?.pr_auc, 3, true)],
    ["Balanced accuracy", fmtNum(a?.balanced_accuracy, 3), fmtNum(m?.balanced_accuracy, 3), delta(e.deltas?.balanced_accuracy, 3, true)],
    ["Log loss", fmtNum(a?.log_loss, 3), fmtNum(m?.log_loss, 3), delta(e.deltas?.log_loss, 3, false)],
    ["Validation loss", fmtNum(a?.val_loss, 3), fmtNum(m?.val_loss, 3), delta(e.deltas?.val_loss, 3, false)],
    ["Train − val accuracy", pct(a?.train_val_gap), pct(m?.train_val_gap), delta(e.deltas?.train_val_gap, 3, false)],
    ["Parameters", fmtInt(a?.parameters), fmtInt(m?.parameters), null],
    ["Saved epoch / trained", `${a?.saved_epoch ?? MISSING} / ${a?.epochs_trained ?? MISSING}`, `${m?.saved_epoch ?? MISSING} / ${m?.epochs_trained ?? MISSING}`, null],
  ];
  return (
    <div className="mt-3 space-y-4 border-t border-white/[0.07] pt-3 text-[12.5px]">
      <table className="w-full">
        <thead>
          <tr className="text-left text-[11.5px] text-white/40">
            <th className="pb-1.5 font-normal">Validation metric</th>
            <th className="pb-1.5 text-right font-normal">Original</th>
            <th className="pb-1.5 text-right font-normal">Experiment</th>
          </tr>
        </thead>
        <tbody className="font-digits tabular-nums">
          {rows.map(([k, x, y, dd]) => (
            <tr key={k} className="border-t border-white/[0.04]">
              <td className="py-1 font-sans text-white/55">{k}</td>
              <td className="py-1 text-right text-white/60">{x}</td>
              <td className="py-1 text-right text-white/85">
                {y}
                {dd}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <p className="text-[12.5px] text-white/45">Seed replicates and uncertainty</p>
        <p className="text-[12.5px] mt-1 text-white/70">
          {v.baseline_runs != null ? `${v.baseline_runs} run${v.baseline_runs === 1 ? "" : "s"} of the original` : "Original runs not recorded"}
          {v.variant_runs != null ? ` · ${v.variant_runs} run${v.variant_runs === 1 ? "" : "s"} of this change` : ""}
          {v.margin != null ? ` · noise margin ±${v.margin.toFixed(3)}` : ""}
          {v.seed_sd != null ? ` · seed spread ${v.seed_sd.toFixed(3)}` : ""}
          {v.sampling_se != null ? ` · sampling error ${v.sampling_se.toFixed(3)}` : ""}
        </p>
        {v.efficiency ? <p className="text-[12.5px] mt-1 text-white/50">{v.efficiency}</p> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[12.5px] text-white/45">Changed</p>
          <ul className="mt-1 space-y-0.5 font-digits text-white/75">
            {(changeLines(e).length ? changeLines(e) : ["Nothing (same settings, new seed)"]).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[12.5px] text-white/45">Kept identical</p>
          <p className="text-[12.5px] mt-1 text-white/60">{e.unchanged.length ? e.unchanged.join(", ") : "All other settings"}</p>
        </div>
      </div>

      <div>
        <p className="text-[12.5px] text-white/45">Lineage</p>
        <p className="mt-1 font-digits text-[11.5px] text-white/50">
          Original {e.chain[0] ?? e.parent_run_id ?? MISSING} → {e.run_id}
          {e.seed != null ? ` · seed ${e.seed}` : ""}
          {e.origin ? ` · opened from ${e.origin}` : ""}
        </p>
        <Link to={`/tools/trainer/runs/${e.run_id}`} className="mt-1 inline-flex items-center gap-1 text-white/60 hover:text-white">
          Training results <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

const pct = (x: number | null | undefined) => (x == null ? MISSING : fmtPct(x, 1));
