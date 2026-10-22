/**
 * Human-readable, metadata-derived names. Internal ids are never replaced, only
 * shown as secondary identifiers. User-defined display names always win.
 */
import type { ReviewDataset, ReviewModel, ReviewRun } from "@/lib/api";
import { fracLabel, shortId } from "./format";

export const TOOL_LABELS: Record<string, string> = {
  backtester: "Backtest",
  "labeling-optimizer": "Label search",
  "training-chart-generator": "Generator",
  testdata: "Test set",
  trainer: "Training",
  analysis: "Analysis",
};

const OPAQUE_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{6,}$/i,
  /^model_\d{8}_\d{6}_[0-9a-f]+(\.keras)?$/i,
  /^dataset_\d{8}_\d{6}_[0-9a-f]+$/i,
  /^\d{8}_\d{6}_[0-9a-f]+$/i,
  /^training-dataset-.+\.zip$/i,
  /^generator run /i,
  /^generated:/i,
];

export function isOpaqueName(name?: string | null): boolean {
  if (!name) return true;
  const n = name.trim();
  return OPAQUE_PATTERNS.some((re) => re.test(n));
}

export function formatSymbols(symbols?: string | null, max = 3): string | null {
  if (!symbols) return null;
  const list = String(symbols)
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (list.length === 0) return null;
  return list.length > max ? `${list.slice(0, max).join(",")}+${list.length - max}` : list.join(",");
}

export function labelingTag(tp?: number | null, sl?: number | null, horizon?: number | null): string | null {
  const t = fracLabel(tp);
  const s = fracLabel(sl);
  const parts: string[] = [];
  if (t != null || s != null) parts.push(`TP${t ?? "?"}/SL${s ?? "?"}`);
  if (horizon != null) parts.push(`H${horizon}`);
  return parts.length ? parts.join(" · ") : null;
}

const stripExt = (n: string) => n.replace(/\.(keras|h5|zip)$/i, "");

export interface AssetName {
  /** Primary label (user name, else metadata-derived, else cleaned machine name). */
  title: string;
  /** Metadata-derived label regardless of user rename, used as secondary line when renamed. */
  derived: string;
  /** True when no meaningful metadata exists and the title is an identifier fallback. */
  opaque: boolean;
}

function compose(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(" · ");
}

export function modelName(m: ReviewModel): AssetName {
  const meta = compose([
    formatSymbols(m.symbols),
    m.timeframe ? m.timeframe.toUpperCase() : null,
    labelingTag(m.take_profit_fraction, m.stop_loss_fraction, m.horizon_bars),
  ]);
  const machine = m.auto_name ?? (m.display_name ? null : m.name) ?? null;
  const cleanMachine = machine && !isOpaqueName(machine) ? stripExt(machine) : null;
  const kind = m.source === "uploaded" ? "Uploaded CNN" : "CNN";
  const derived = meta
    ? compose([meta, cleanMachine && cleanMachine.toLowerCase() !== "model" ? cleanMachine : kind])
    : cleanMachine
      ? compose([cleanMachine, kind])
      : `${kind} ${shortId(m.id)}`;
  return { title: m.display_name || derived, derived, opaque: !meta && !cleanMachine };
}

export function datasetName(d: ReviewDataset): AssetName {
  const userGiven = d.auto_name ?? (d.display_name ? null : d.name) ?? null;
  const given = userGiven && !isOpaqueName(userGiven) && userGiven !== d.dataset_id ? userGiven : null;
  const meta = compose([
    formatSymbols(d.symbols),
    d.timeframe ? d.timeframe.toUpperCase() : null,
    labelingTag(d.take_profit_fraction, d.stop_loss_fraction, d.horizon_bars),
  ]);
  const kind = d.kind === "test" ? "Test set" : d.kind === "training" ? "Training set" : "Dataset";
  const form = d.representation === "archive" ? "archive" : null;
  const derived = given
    ? compose([given, meta && !given.includes(meta) ? meta : null])
    : meta
      ? compose([meta, form ? `${kind} ${form}` : kind])
      : compose([kind, form, shortId(d.dataset_id || d.generator_run_id || d.id)]);
  return { title: d.display_name || derived, derived, opaque: !given && !meta };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : v != null && typeof v !== "object" ? String(v) : null;
}

export function runName(r: ReviewRun, modelTitles?: Map<string, string>): AssetName {
  const tool = TOOL_LABELS[r.tool] || r.tool;
  const d = r.details || {};
  let ctx: string | null = null;
  if (r.tool === "backtester") {
    const model = r.links?.trainer_run_id || r.links?.model_id;
    ctx = compose([
      r.backtest?.symbol ?? null,
      model ? modelTitles?.get(model) ?? `model ${shortId(model)}` : null,
    ]);
  } else if (r.tool === "labeling-optimizer") {
    const c = r.optimizer?.config || {};
    ctx = compose([str(c.symbol), str(c.timeframe)?.toUpperCase(), c.start ? `${String(c.start).slice(0, 7)}→${String(c.end ?? "").slice(0, 7)}` : null]);
  } else if (r.tool === "training-chart-generator") {
    const c = r.generator?.config || {};
    ctx = compose([
      formatSymbols(str(c.symbols)),
      str(c.timeframe)?.toUpperCase(),
      labelingTag(c.takeProfitFraction as number, c.stopLossFraction as number, c.horizonBars as number),
    ]);
  } else if (r.tool === "trainer") {
    const mt = modelTitles?.get(r.id);
    ctx = mt ?? (str(d.model_name) ? stripExt(String(d.model_name)) : null);
  } else if (r.tool === "testdata") {
    ctx = compose([str(d.dataset_name), formatSymbols(str(d.symbols))]);
  } else if (r.tool === "analysis") {
    const model = r.links?.model_id || r.links?.trainer_run_id;
    ctx = model ? modelTitles?.get(model) ?? `model ${shortId(model)}` : null;
  }
  const derived = ctx ? `${tool} · ${ctx}` : `${tool} ${shortId(r.id)}`;
  return { title: r.display_name || derived, derived, opaque: !ctx };
}

/**
 * Append a stable short-id suffix to titles shared by more than one asset so no two
 * rows read identically. Ordinals are avoided: they would imply a version order.
 */
export function disambiguate<T extends { id: string }>(items: T[], title: (t: T) => string): Map<string, string> {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const t = title(it);
    const g = groups.get(t);
    if (g) g.push(it);
    else groups.set(t, [it]);
  }
  const out = new Map<string, string>();
  for (const [t, group] of groups) {
    if (group.length === 1) out.set(group[0].id, t);
    else for (const it of group) out.set(it.id, `${t} · ${shortId(it.id, 4)}`);
  }
  return out;
}
