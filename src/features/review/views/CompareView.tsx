import { AlertTriangle, X } from "lucide-react";
import { useMemo } from "react";
import type { ReviewModel, ReviewRun } from "@/lib/api";
import { useReview, type AssetRef } from "../ReviewContext";
import { compareBacktests, compareModels, formatDelta, formatUnit, type Comparison } from "../lib/compare";
import { useAssetDetails } from "../useAssetDetail";
import { OverlayChart } from "../components/Charts";
import { btn, cx, EmptyState, Panel, surface } from "../components/primitives";

export function CompareView() {
  const { compare, find, titleOf, setCompare, setTab, modelFor, data } = useReview();

  const assets = compare.map((r) => ({ ref: r, a: find(r) })).filter((x) => x.a);
  const models = assets.filter((x) => x.a!.kind === "model").map((x) => x.a!.item as ReviewModel);
  const backtests = assets
    .filter((x) => x.a!.kind === "run" && (x.a!.item as ReviewRun).tool === "backtester")
    .map((x) => x.a!.item as ReviewRun);
  const mode: "model" | "backtest" | null = models.length >= backtests.length ? (models.length ? "model" : null) : "backtest";
  const items = mode === "model" ? models : mode === "backtest" ? backtests : [];
  const refs: AssetRef[] = items.map((i): AssetRef => ({ kind: mode === "model" ? "model" : "run", id: i.id }));

  const comparison: Comparison | null = useMemo(() => {
    if (items.length < 2) return null;
    return mode === "model"
      ? compareModels(items as ReviewModel[])
      : compareBacktests(items as ReviewRun[], (id) => (modelFor(id) ? titleOf({ kind: "model", id: modelFor(id)!.id }) : `model ${id?.slice(-6)}`));
  }, [items, mode, modelFor, titleOf]);

  const details = useAssetDetails(
    refs.map((r) => {
      const m = r.kind === "model" ? (find(r)?.item as ReviewModel | undefined) : undefined;
      return r.kind === "model" && m?.training_run_id ? { kind: "run" as const, id: m.training_run_id } : { kind: r.kind as "model" | "run", id: r.id };
    }),
  );

  if (items.length < 2) {
    const candidates = (data?.models.length ?? 0) + (data?.runs.filter((r) => r.tool === "backtester").length ?? 0);
    return (
      <EmptyState
        title="Select two to four models or backtests to compare"
        body={
          candidates < 2
            ? "There are not yet enough models or backtests in the workspace to compare."
            : "Tick the checkboxes in the Models or Backtests tab (or press Space on a row). Comparison shows setup differences first, and only computes deltas when results were produced under the same conditions."
        }
        action={
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => setTab("models")}>
              Models
            </button>
            <button type="button" className={btn} onClick={() => setTab("backtests")}>
              Backtests
            </button>
          </div>
        }
      />
    );
  }

  const cols = items.length;
  const grid = { gridTemplateColumns: `minmax(170px, 1.1fr) repeat(${cols}, minmax(150px, 1fr))` };
  const groups = [...new Set(comparison!.rows.map((r) => r.def.group))];

  return (
    <div className="space-y-4">
      <div className={cx(surface, "overflow-x-auto")}>
        <div className="min-w-[640px]">
          <div className="grid border-b border-white/[0.1]" style={grid}>
            <div className="flex items-end px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-medium text-[#F5F5F5]">
                <span className="h-2 w-2 rounded-full bg-white" />
                {mode === "model" ? "Models" : "Backtests"}
              </h2>
            </div>
            {refs.map((r, i) => (
              <div key={r.id} className="flex items-start justify-between gap-2 border-l border-white/[0.08] px-4 py-4">
                <div className="min-w-0">
                  <div className="font-digits text-[12.5px] text-white/40">#{i + 1}{i === 0 ? " · baseline" : ""}</div>
                  <div className="mt-0.5 truncate text-[15px] font-medium text-white" title={titleOf(r)}>
                    {titleOf(r)}
                  </div>
                </div>
                <button type="button" aria-label="Remove from comparison" className="text-white/35 hover:text-white" onClick={() => setCompare(compare.filter((c) => c.id !== r.id))}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="border-b border-white/[0.06] px-5 pb-2 pt-5 text-[13.5px] font-medium text-white/70">Setup</div>
          {comparison!.setup.map((s) => (
            <div key={s.label} className={cx("grid border-b border-white/[0.05] text-[13.5px]", s.differs && "bg-white/[0.03]")} style={grid}>
              <div className="flex items-center gap-2 px-5 py-2.5 text-white/55">
                {s.differs ? <span className="h-1.5 w-1.5 rounded-full bg-white/70" title="Differs between columns" /> : <span className="h-1.5 w-1.5" />}
                {s.label}
              </div>
              {s.values.map((v, i) => (
                <div key={i} className={cx("truncate border-l border-white/[0.05] px-4 py-2.5 font-digits tabular-nums", v === "—" ? "text-white/25" : "text-white/85")} title={v}>
                  {v}
                </div>
              ))}
            </div>
          ))}

          {groups.map((g) => (
            <div key={g}>
              <div className="border-b border-white/[0.06] px-5 pb-2 pt-6 text-[13.5px] font-medium text-white/70">{g}</div>
              {comparison!.rows
                .filter((r) => r.def.group === g)
                .map((r) => (
                  <div key={r.def.key} className="grid border-b border-white/[0.05] text-[14px] last:border-0" style={grid}>
                    <div className="px-5 py-2.5 text-white/60">{r.def.label}</div>
                    {r.values.map((v, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-2 border-l border-white/[0.05] px-4 py-2.5 font-digits tabular-nums">
                        <span className={v == null ? "text-white/25" : "text-white"}>{formatUnit(v, r.def.unit)}</span>
                        {r.deltas?.[i] != null ? <span className="text-[12.5px] text-white/45">{formatDelta(r.deltas[i], r.def.unit)}</span> : null}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Comparability" className="lg:col-span-1">
          {comparison!.warnings.length === 0 ? (
            <p className="text-[14px] leading-relaxed text-white/65">Setups match on every recorded dimension. Deltas are shown against the baseline (#1).</p>
          ) : (
            <ul className="space-y-2">
              {comparison!.warnings.map((w, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-white/75">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white/45" />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          )}
          {!comparison!.comparable ? (
            <p className="mt-4 border-t border-white/[0.08] pt-3 text-[13px] leading-relaxed text-white/45">Deltas are hidden because the results were not produced under the same conditions. No ranking is implied.</p>
          ) : null}
        </Panel>
        <Panel title={mode === "model" ? "Validation accuracy by epoch" : "Indexed equity (net)"} className="lg:col-span-2">
          {mode === "model" ? (
            details.some((d) => d?.history?.length) ? (
              <OverlayChart
                xLabel="epoch"
                fmt={(v) => `${(v * 100).toFixed(0)}%`}
                series={refs.map((r, i) => ({ name: `#${i + 1}`, points: (details[i]?.history ?? []).map((p) => ({ x: p.epoch, y: p.val_accuracy })) }))}
              />
            ) : (
              <p className="text-[14px] text-white/45">{details.every((d) => d) ? "No per-epoch history recorded for these models." : "Loading training histories…"}</p>
            )
          ) : details.some((d) => d?.backtest?.equity?.length) ? (
            <>
              <OverlayChart
                xLabel="step"
                series={refs.map((r, i) => ({
                  name: `#${i + 1}`,
                  points: (details[i]?.backtest?.equity ?? []).map((p, j) => ({ x: j, y: p.strategy_indexed ?? p.equity })),
                }))}
              />
              <p className="mt-2 text-[13px] text-white/40">Plotted by observation index; calendar periods may differ (see Setup).</p>
            </>
          ) : (
            <p className="text-[14px] text-white/45">{details.every((d) => d) ? "No equity series recorded for these backtests." : "Loading equity curves…"}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
