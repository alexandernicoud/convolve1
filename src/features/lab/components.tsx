import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Play, Square } from "lucide-react";
import { btn, btnPrimary, btnSm, Caveat, Chip, cx, Hint, Panel, StatusPill } from "@/features/review/components/primitives";
import { downloadText, fmtDateTime, fmtDuration, fmtInt, fmtPct, isFiniteNum, MISSING, toCsv } from "@/lib/viz/format";
import { CLASS_COLORS, SEMANTIC, VIZ } from "@/lib/viz/tokens";
import type { EncodedMap, ExperimentKind, LabContext, LabJob, ModelRef, Prop } from "./api";
import { labApi } from "./api";
import { describeFilters, EMPTY_FILTERS, fmtProp, isActive, type Filters } from "./lib";
import { MapCanvas, useAuthedObjectUrl, type Palette } from "./maps";
import type { LabSessionState } from "./useLabSession";

// --------------------------------------------------------------------------- shared context

export type LabShared = {
  ref: ModelRef;
  context: LabContext;
  sessionId: string | null;
  session: LabSessionState;
  run: (kind: ExperimentKind, params: Record<string, unknown>) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  openImage: (imageId: string) => void;
  goTab: (tab: string) => void;
};

export const LabCtx = createContext<LabShared | null>(null);

export function useLab(): LabShared {
  const v = useContext(LabCtx);
  if (!v) throw new Error("useLab outside LabCtx");
  return v;
}

export const classLabel = (c: number | null | undefined) => (c == null ? MISSING : `Label ${c}`);

// --------------------------------------------------------------------------- form fields

export const inputCls =
  "h-9 w-full rounded-lg border border-white/[0.14] bg-black px-3 text-[13.5px] text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1 text-[12.5px] text-white/55">
        {label}
        {hint ? <Hint text={hint} /> : null}
      </span>
      {children}
    </label>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      className={cx(inputCls, "font-digits tabular-nums")}
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(max != null ? Math.min(max, min != null ? Math.max(min, v) : v) : v);
      }}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <select className={inputCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function LayerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { context } = useLab();
  return (
    <Select
      value={value}
      onChange={onChange}
      options={context.model.conv_layers.map((c, i) => ({
        value: c.name,
        label: `${c.name} · ${c.output_shape.join("×")}${i === context.model.conv_layers.length - 1 ? " (last)" : ""}`,
      }))}
    />
  );
}

/** Sampling filters shared by every multi-image experiment. */
export function FilterEditor({ value, onChange, allowPrediction = true }: { value: Filters; onChange: (f: Filters) => void; allowPrediction?: boolean }) {
  const { context } = useLab();
  const [open, setOpen] = useState(false);
  const ds = context.dataset;
  const splitOk = ds?.split.status === "recorded" || ds?.split.status === "reconstructed";
  const toggle = (arr: number[], v: number) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const classes = Array.from({ length: context.model.n_classes }, (_, i) => i);
  const active = describeFilters(Object.fromEntries(Object.entries(value).filter(([, v]) => (Array.isArray(v) ? v.length : v && v !== "all"))));
  return (
    <div className="rounded-xl border border-white/[0.08]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-white/80">Sample filters</span>
          <span className="block truncate text-[12.5px] text-white/45">{active}</span>
        </span>
        <ChevronDown className={cx("h-4 w-4 shrink-0 text-white/40 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-white/[0.08] px-4 py-4 sm:grid-cols-2">
          <Field label="True label">
            <div className="flex gap-2">
              {classes.map((c) => (
                <Chip key={c} active={value.labels.includes(c)} onClick={() => onChange({ ...value, labels: toggle(value.labels, c) })}>
                  {c}
                </Chip>
              ))}
            </div>
          </Field>
          {allowPrediction ? (
            <Field label="Predicted class" hint="Applied after inference: candidates are scanned in seeded order (at most 3,000).">
              <div className="flex gap-2">
                {classes.map((c) => (
                  <Chip key={c} active={value.predicted.includes(c)} onClick={() => onChange({ ...value, predicted: toggle(value.predicted, c) })}>
                    {c}
                  </Chip>
                ))}
              </div>
            </Field>
          ) : null}
          {allowPrediction ? (
            <Field label="Outcome">
              <Select
                value={value.outcome}
                onChange={(v) => onChange({ ...value, outcome: v })}
                options={[
                  { value: "", label: "Correct and incorrect" },
                  { value: "correct", label: "Correct only" },
                  { value: "incorrect", label: "Incorrect only" },
                ]}
              />
            </Field>
          ) : null}
          <Field label="Split" hint={ds?.split.note}>
            <Select
              value={value.split}
              disabled={!splitOk}
              onChange={(v) => onChange({ ...value, split: v })}
              options={[
                { value: "all", label: splitOk ? "All images" : "All images (split unavailable)" },
                { value: "validation", label: "Validation (held out)" },
                { value: "training", label: "Training" },
              ]}
            />
          </Field>
          {ds && ds.symbols.length > 1 ? (
            <Field label="Symbol">
              <Select
                value={(value.symbols[0] ?? "") as string}
                onChange={(v) => onChange({ ...value, symbols: v ? [v] : [] })}
                options={[{ value: "", label: "All symbols" }, ...ds.symbols.map((s) => ({ value: s.symbol, label: `${s.symbol} (${s.n})` }))]}
              />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Window ends from">
              <input type="date" className={inputCls} value={value.date_from} onChange={(e) => onChange({ ...value, date_from: e.target.value })} />
            </Field>
            <Field label="to">
              <input type="date" className={inputCls} value={value.date_to} onChange={(e) => onChange({ ...value, date_to: e.target.value })} />
            </Field>
          </div>
          {allowPrediction ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Confidence ≥" hint="Confidence = probability of the predicted class (0.5–1).">
                <input className={inputCls} inputMode="decimal" placeholder="0.5" value={value.confidence_min} onChange={(e) => onChange({ ...value, confidence_min: e.target.value })} />
              </Field>
              <Field label="Confidence ≤">
                <input className={inputCls} inputMode="decimal" placeholder="1.0" value={value.confidence_max} onChange={(e) => onChange({ ...value, confidence_max: e.target.value })} />
              </Field>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <button type="button" className={btnSm} onClick={() => onChange(EMPTY_FILTERS)}>
              Clear filters
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- job panel

/** Configuration form + run button + live status of the newest job of this kind. */
export function JobPanel({
  kind,
  title,
  description,
  children,
  params,
  runLabel = "Run",
  estimate,
}: {
  kind: ExperimentKind;
  title: string;
  description: ReactNode;
  children: ReactNode;
  params: Record<string, unknown>;
  runLabel?: string;
  estimate?: string;
}) {
  const { run, cancel, session } = useLab();
  const { latest, resultJob } = session.forKind(kind);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = isActive(latest);

  const start = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      await run(kind, params);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the experiment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel title={title} description={description}>
      <div className="space-y-4">
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimary} disabled={submitting || live} onClick={() => void start()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {runLabel}
          </button>
          {estimate ? <span className="text-[12.5px] text-white/40">{estimate}</span> : null}
        </div>
        {err ? (
          <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/[0.06] px-3 py-2 text-[13px] text-red-200/90">
            {err}
          </p>
        ) : null}
        {latest && live ? (
          <div className="space-y-2 rounded-xl border border-white/[0.1] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <StatusPill status={latest.status} />
              <button type="button" className={btnSm} onClick={() => void cancel(latest.job_id)}>
                <Square className="h-3 w-3" /> Cancel
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              {isFiniteNum(latest.progress) ? (
                <div className="h-full rounded-full bg-white/80 transition-[width] duration-500" style={{ width: `${Math.max(2, latest.progress * 100)}%` }} />
              ) : (
                <div className="h-full w-1/3 animate-indeterminate rounded-full bg-white/70" />
              )}
            </div>
            <p className="text-[12.5px] text-white/50">{latest.message || "Working…"}</p>
          </div>
        ) : null}
        {latest && (latest.status === "failed" || latest.status === "interrupted" || latest.status === "cancelled") ? (
          <div className={cx("rounded-xl border px-4 py-3 text-[13px]", latest.status === "cancelled" ? "border-white/[0.1] text-white/55" : "border-red-400/25 bg-red-400/[0.05] text-red-200/90")}>
            <StatusPill status={latest.status} />
            <p className="mt-1">{latest.message}</p>
            {resultJob ? <p className="mt-1 text-white/45">Showing the previous successful result below.</p> : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function JobMeta({ job, result }: { job: LabJob | null; result: Record<string, unknown> | null }) {
  if (!job || !result) return null;
  const sample = (result.sample ?? {}) as { requested?: number; seed?: number; filters?: Record<string, unknown>; pool_size?: number; scanned?: number; exhausted?: boolean };
  return (
    <p className="text-[12.5px] leading-relaxed text-white/40">
      Computed {fmtDateTime(job.finished_at ?? job.created_at)} in {fmtDuration(result.seconds as number)} · seed {sample.seed ?? MISSING} ·{" "}
      {describeFilters(sample.filters)} · pool {fmtInt(sample.pool_size)} images, {fmtInt(sample.scanned)} scanned
      {sample.exhausted ? <span className="text-amber-200/80"> · fewer images matched than requested</span> : null}
      <span className="font-mono text-white/30"> · {job.job_id}</span>
    </p>
  );
}

// --------------------------------------------------------------------------- sample summary

type Summary = {
  n: number;
  by_predicted: Record<string, number>;
  by_label: Record<string, number>;
  accuracy: Prop | null;
  confidence: { mean: number | null };
  near_chance: Prop | null;
  split_status: string;
  splits: Record<string, number> | null;
};

export function SampleSummary({ summary, items, filename }: { summary?: Summary; items?: Record<string, unknown>[]; filename?: string }) {
  if (!summary) return null;
  const counts = (m: Record<string, number>) =>
    Object.entries(m)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ") || MISSING;
  return (
    <div className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
      <MiniKV label="Images" value={fmtInt(summary.n)} />
      <MiniKV label="Predicted class" value={counts(summary.by_predicted)} />
      <MiniKV label="True label" value={counts(summary.by_label)} />
      <MiniKV label="Split" value={summary.splits ? `validation ${summary.splits.validation} · training ${summary.splits.training}` : "Not available"} />
      <MiniKV label="Label agreement" value={fmtProp(summary.accuracy)} hint="Share of sampled images where the predicted class equals the filename label (Wilson 95% interval). Classification on this sample, not trading performance." />
      <MiniKV label="Mean confidence" value={fmtPct(summary.confidence?.mean)} />
      <MiniKV label="Confidence < 55%" value={fmtProp(summary.near_chance)} hint="Predictions close to 50/50. Attributions for these explain small evidence differences." />
      {items?.length ? (
        <div className="flex items-end">
          <button
            type="button"
            className={btnSm}
            onClick={() =>
              downloadText(
                filename ?? "sample.csv",
                toCsv(items, Object.keys(items[0]).filter((k) => typeof items[0][k] !== "object" || items[0][k] === null).map((key) => ({ key }))),
              )
            }
          >
            Sample ids (CSV)
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function MiniKV({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-white/[0.06] py-1.5">
      <span className="flex shrink-0 items-center gap-1 text-white/50">
        {label}
        {hint ? <Hint text={hint} /> : null}
      </span>
      <span className="min-w-0 truncate text-right font-digits tabular-nums text-white/85">{value}</span>
    </div>
  );
}

// --------------------------------------------------------------------------- interval plot

export type IntervalRow = { key: string; label: ReactNode; mean: number | null; lo: number | null; hi: number | null; note?: ReactNode; color?: string; muted?: boolean };

/**
 * Forest plot: one row per estimate with its 95% interval and a dashed reference line.
 * Missing estimates render as an em dash, never as zero.
 */
export function IntervalPlot({ rows, domain, reference, format, referenceLabel }: { rows: IntervalRow[]; domain: [number, number] | null; reference?: number; format: (v: number) => string; referenceLabel?: string }) {
  if (!domain) return <p className="text-[13px] text-white/40">No estimates.</p>;
  const [d0, d1] = domain;
  const pct = (v: number) => `${((v - d0) / (d1 - d0 || 1)) * 100}%`;
  const showRef = reference != null && reference >= d0 && reference <= d1;
  const grid = "grid grid-cols-[minmax(8rem,15rem)_minmax(8rem,1fr)_auto] items-center gap-x-5";
  return (
    <div>
      {rows.map((r) => (
        <div key={r.key} className={cx(grid, "border-b border-white/[0.05] py-1.5")}>
          <div className={cx("min-w-0 text-[13px] leading-snug", r.muted ? "text-white/40" : "text-white/75")}>
            {r.label}
            {r.note ? <span className="ml-1.5 text-[12px] text-white/35">{r.note}</span> : null}
          </div>
          <div className="relative h-[18px]" aria-hidden>
            {showRef ? <div className="absolute inset-y-0 border-l border-dashed" style={{ left: pct(reference!), borderColor: VIZ.axisLine }} /> : null}
            {isFiniteNum(r.lo) && isFiniteNum(r.hi) ? (
              <div className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full" style={{ left: pct(r.lo), width: `calc(${pct(r.hi)} - ${pct(r.lo)})`, background: r.color ?? "rgba(255,255,255,0.55)" }} />
            ) : null}
            {isFiniteNum(r.mean) ? <div className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pct(r.mean), background: r.color ?? SEMANTIC.highlight }} /> : null}
          </div>
          <span className="whitespace-nowrap text-right font-digits text-[12.5px] tabular-nums text-white/70">
            {isFiniteNum(r.mean) ? format(r.mean) : MISSING}
            {isFiniteNum(r.lo) && isFiniteNum(r.hi) ? <span className="text-white/35"> [{format(r.lo)}, {format(r.hi)}]</span> : null}
          </span>
        </div>
      ))}
      <div className={cx(grid, "pt-1.5")}>
        <span className="text-[11.5px] text-white/35">{referenceLabel ? `Dashed line: ${referenceLabel}` : ""}</span>
        <div className="flex justify-between font-digits text-[11px] tabular-nums" style={{ color: VIZ.tick }}>
          <span>{format(d0)}</span>
          <span>{format(d1)}</span>
        </div>
        <span className="whitespace-nowrap text-right text-[11.5px] text-white/35">mean [95% interval]</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- predictions & thumbnails

export function ProbBars({ probs, predicted, target, label }: { probs: number[]; predicted: number; target?: number; label?: number | null }) {
  return (
    <div className="space-y-2.5">
      {probs.map((p, c) => (
        <div key={c}>
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="flex items-center gap-2 text-white/70">
              <span className="h-2 w-2 rounded-full" style={{ background: CLASS_COLORS[String(c)] ?? SEMANTIC.highlight }} />
              Label {c}
              {c === predicted ? <span className="text-[11.5px] text-white/45">predicted</span> : null}
              {c === target && target !== predicted ? <span className="text-[11.5px] text-white/45">explained</span> : null}
              {c === label ? <span className="text-[11.5px] text-white/45">actual</span> : null}
            </span>
            <span className="font-digits tabular-nums text-white">{fmtPct(p, 1)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: CLASS_COLORS[String(c)] ?? SEMANTIC.highlight }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Thumb({
  imageId,
  map,
  palette = "sequential",
  caption,
  onClick,
  selected,
  opacity = 0.65,
}: {
  imageId: string;
  map?: EncodedMap | null;
  palette?: Palette;
  caption?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  opacity?: number;
}) {
  const { ref } = useLab();
  const path = useMemo(() => labApi.imagePath(ref, imageId), [ref, imageId]);
  const url = useAuthedObjectUrl(path);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={imageId}
      className={cx(
        "group flex min-w-0 flex-col gap-1.5 rounded-lg p-1 text-left transition",
        onClick && "hover:bg-white/[0.05] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
        selected && "bg-white/[0.08] ring-1 ring-white/40",
      )}
    >
      {url ? <MapCanvas base={url} map={map ?? null} palette={palette} opacity={opacity} /> : <div className="aspect-square w-full animate-pulse rounded-lg bg-white/[0.06]" />}
      {caption ? <div className="min-w-0 px-0.5 text-[11.5px] leading-snug text-white/55">{caption}</div> : null}
    </Tag>
  );
}

export function ResultEmpty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/[0.1] px-6 py-10 text-center text-[13.5px] leading-relaxed text-white/45">{children}</div>;
}

export function Limitations({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-[12.5px] font-medium text-white/50">Limitations</p>
      <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] leading-relaxed text-white/40">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export { btn, btnSm, Caveat };
