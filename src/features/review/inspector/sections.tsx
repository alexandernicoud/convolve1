import type { ReactNode } from "react";
import type { ReviewEdge, ReviewTrainingMetrics, ReviewTrainingSetup } from "@/lib/api";
import { useReview } from "../ReviewContext";
import { formatValue, humanizeKey, int, num, pctFrac } from "../lib/format";
import { NODE_KIND_LABEL, RELATION_LABEL, parseKey } from "../lib/graph";
import { AssetLink } from "../components/assets";
import { Caveat, KV, Missing, ProvenanceBadge, SectionLabel } from "../components/primitives";

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-white/[0.07] px-6 py-5 last:border-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-medium text-[#F5F5F5]">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Generic sanitized config rendering (keys humanized; nested objects summarised). */
export function ConfigKV({ obj, exclude = [] }: { obj?: Record<string, unknown> | null; exclude?: string[] }) {
  if (!obj) return <Missing text="Not recorded" />;
  const entries = Object.entries(obj).filter(([k, v]) => !exclude.includes(k) && v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v)));
  if (!entries.length) return <Missing text="Not recorded" />;
  return <KV rows={entries.map(([k, v]) => [humanizeKey(k), formatValue(v)])} />;
}

export function TrainingMetricsBlock({ metrics }: { metrics?: ReviewTrainingMetrics | null }) {
  if (!metrics || Object.keys(metrics).length === 0) return <Missing text="No training metrics recorded" />;
  return (
    <>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <SectionLabel>Validation set</SectionLabel>
          <div className="mt-1.5 font-digits text-[28px] font-semibold leading-none tracking-tight tabular-nums text-white">{pctFrac(metrics.val_accuracy)}</div>
          <div className="mt-1 text-[12.5px] text-white/45">accuracy</div>
          <div className="mt-3 space-y-1 font-digits text-[13.5px] tabular-nums text-white/75">
            <div className="flex justify-between"><span className="text-white/45">loss</span>{num(metrics.val_loss, 4)}</div>
            <div className="flex justify-between"><span className="text-white/45">label-1 recall</span>{pctFrac(metrics.val_label_1_recall)}</div>
          </div>
        </div>
        <div className="border-l border-white/[0.08] pl-6">
          <SectionLabel>Training set · in-sample</SectionLabel>
          <div className="mt-1.5 font-digits text-[28px] font-semibold leading-none tracking-tight tabular-nums text-white/50">{pctFrac(metrics.accuracy)}</div>
          <div className="mt-1 text-[12.5px] text-white/45">accuracy</div>
          <div className="mt-3 space-y-1 font-digits text-[13.5px] tabular-nums text-white/55">
            <div className="flex justify-between"><span className="text-white/35">loss</span>{num(metrics.loss, 4)}</div>
            <div className="flex justify-between"><span className="text-white/35">label-1 recall</span>{pctFrac(metrics.label_1_recall)}</div>
          </div>
        </div>
      </div>
      <Caveat>Final-epoch values. Classification accuracy on labelled charts — not a measure of trading profitability. Out-of-sample performance comes from backtests.</Caveat>
    </>
  );
}

export function TrainingSetupKV({ t }: { t?: Partial<ReviewTrainingSetup> | null }) {
  if (!t || Object.keys(t).length === 0) return <Missing text="No training configuration recorded" />;
  return (
    <KV
      rows={[
        ["Architecture", t.architecture],
        ["Train / val samples", t.train_samples != null ? `${int(t.train_samples)} / ${int(t.val_samples)}` : null],
        ["Validation split", t.val_split != null ? formatValue(t.val_split) : null],
        ["Epochs trained / max", t.epochs_trained != null || t.epochs != null ? `${int(t.epochs_trained)} / ${int(t.epochs)}` : null],
        ["Best epoch", t.best_epoch != null ? int(t.best_epoch) : null],
        ["Batch size", t.batch_size != null ? int(t.batch_size) : null],
        ["Image size", t.image_size ? formatValue(t.image_size) : null],
        ["Random seed", t.random_seed != null ? String(t.random_seed) : null],
        ["Learning rate", t.learning_rate != null ? String(t.learning_rate) : null],
        ["Optimizer", t.optimizer],
      ]}
    />
  );
}

/** Upstream / downstream links with provenance, from the overview graph. */
export function LinkedAssets({ nodeKey }: { nodeKey: string }) {
  const { graph, showLineage } = useReview();
  const up = graph.in.get(nodeKey) ?? [];
  const down = graph.out.get(nodeKey) ?? [];
  if (!up.length && !down.length) {
    return <p className="text-[13.5px] leading-relaxed text-white/45">No recorded links. This asset's origin and use were not written by the tools that touched it.</p>;
  }
  const row = (e: ReviewEdge, other: string, dir: "up" | "down") => {
    const n = graph.nodes.get(other);
    const p = parseKey(other);
    return (
      <li key={`${dir}:${e.source}>${e.relation}>${e.target}`} className="flex items-center gap-3 border-b border-white/[0.06] py-2 last:border-0">
        <span className="w-24 shrink-0 text-[12.5px] text-white/45">{RELATION_LABEL[e.relation] ?? e.relation}</span>
        <span className="w-20 shrink-0 text-[12.5px] text-white/35">{NODE_KIND_LABEL[n?.kind ?? "unresolved"]}</span>
        <span className="min-w-0 flex-1">
          {p.kind && !n?.unresolved ? <AssetLink refv={{ kind: p.kind, id: p.id }} /> : <span className="font-mono text-[12.5px] text-white/40">{p.id} · not in workspace</span>}
        </span>
        <ProvenanceBadge p={n?.unresolved ? "unresolved" : e.provenance} basis={e.basis} compact />
      </li>
    );
  };
  return (
    <div className="space-y-3">
      {up.length ? (
        <div>
          <p className="mb-1 text-[13px] font-medium text-white/55">Built from</p>
          <ul>{up.map((e) => row(e, e.source, "up"))}</ul>
        </div>
      ) : null}
      {down.length ? (
        <div>
          <p className="mb-1 text-[13px] font-medium text-white/55">Used by</p>
          <ul>{down.map((e) => row(e, e.target, "down"))}</ul>
        </div>
      ) : null}
      <button
        type="button"
        className="text-[13px] font-medium text-white/60 transition hover:text-white"
        onClick={() => showLineage(nodeKey)}
      >
        Show full lineage graph →
      </button>
    </div>
  );
}
