import { useMemo, type ReactNode } from "react";
import Plot from "react-plotly.js";
import type { Data, PlotMouseEvent } from "plotly.js";
import { btnSm, cx } from "@/features/review/components/primitives";
import { cellProfile, classifyRegion, fmtFrac, fmtPct, maxAbs, nearestIndex, neighbourhood2D, percentileInSlice, REGION_COPY, signedLog, signedLogTicks, sliceFor, type Model, type Tone } from "../lib";
import { axis, baseLayout, Card, DIVERGING, horizonAxis, Legend, MethodTag, PLOT_CONFIG, Segmented, SEQUENTIAL, T, TONE_TEXT, Unavailable } from "../ui";
import { useResults } from "../state";
import { RANK_MODES, type RankMode } from "../research";
import { CandidateTable, CellDiagnostics, GenerateDatasetLink } from "./ResearchPanels";

export const MODEL_LABEL: Record<Model, string> = { label: "Label payoff", mtm: "Market-valued" };
export const RANK_LABEL: Record<RankMode, string> = { profitability: "optimizer score", suitability: "CNN suitability", robustness: "robustness" };

export default function OverviewTab() {
  const { surface } = useResults();
  if (!surface) return <Unavailable>No TP × SL surface was exported for this run.</Unavailable>;
  return (
    <div className="space-y-5">
      <SurfaceExplorer />
      <CandidateTable />
    </div>
  );
}

function signTone(v: number | null | undefined): Tone {
  return v != null && Number.isFinite(v) && v < 0 ? "bad" : "neutral";
}

function SurfaceExplorer() {
  const { surface: s, model, setModel, hIndex, setHIndex, cell, setCell, bestIdx, goTab, rankMode, setRankMode, research, candidates } = useResults();
  const surface = s!;
  const effModel: Model = model === "mtm" && !surface.mtm ? "label" : model;
  const otherModel: Model = effModel === "label" ? "mtm" : "label";
  const grid = sliceFor(surface, effModel, hIndex);
  const other = sliceFor(surface, otherModel, hIndex);
  const tpPct = useMemo(() => surface.tp.map((v) => +(v * 100).toFixed(3)), [surface.tp]);
  const slPct = useMemo(() => surface.sl.map((v) => +(v * 100).toFixed(3)), [surface.sl]);
  const limit = useMemo(() => maxAbs(effModel === "mtm" ? surface.mtm ?? [] : surface.label), [surface, effModel]);
  const ticks = useMemo(() => signedLogTicks(limit), [limit]);
  const h = surface.horizons[hIndex]!;

  const scoreGrid = rankMode !== "profitability" ? research?.metrics[rankMode]?.[hIndex] ?? null : null;
  const shareGrid = research?.metrics.label1_share?.[hIndex] ?? null;
  const samplesGrid = research?.metrics.samples?.[hIndex] ?? null;
  const zLog = useMemo(
    () => (scoreGrid ? scoreGrid.map((row) => row.slice()) : grid?.map((row) => row.map((v) => (v == null ? null : signedLog(v)))) ?? []),
    [grid, scoreGrid],
  );
  const customdata = useMemo(
    () =>
      grid?.map((row, si) =>
        row.map((v, ti) => [
          v ?? NaN,
          other?.[si]?.[ti] ?? NaN,
          scoreGrid?.[si]?.[ti] ?? NaN,
          shareGrid?.[si]?.[ti] != null ? shareGrid[si]![ti]! * 100 : NaN,
          samplesGrid?.[si]?.[ti] ?? NaN,
        ]),
      ) ?? [],
    [grid, other, scoreGrid, shareGrid, samplesGrid],
  );
  const scoreName = RANK_MODES.find((m) => m.value === rankMode)!.label;

  const sel = cell ?? (bestIdx ? { si: bestIdx.si, ti: bestIdx.ti } : { si: 0, ti: 0 });
  const selVal = grid?.[sel.si]?.[sel.ti] ?? null;
  const selOther = other?.[sel.si]?.[sel.ti] ?? null;
  const selNb = grid ? neighbourhood2D(grid, sel.si, sel.ti) : null;
  const selRegion = classifyRegion(selNb);
  const selPct = grid ? percentileInSlice(grid, sel.si, sel.ti) : null;
  const isBest = bestIdx && bestIdx.hi === hIndex && bestIdx.si === sel.si && bestIdx.ti === sel.ti;

  const profLabel = cellProfile(surface, "label", sel.si, sel.ti);
  const profMtm = surface.mtm ? cellProfile(surface, "mtm", sel.si, sel.ti) : [];

  const traces: Data[] = [
    {
      type: "heatmap",
      x: tpPct,
      y: slPct,
      z: zLog,
      customdata: customdata as unknown as number[][],
      colorscale: scoreGrid ? SEQUENTIAL : DIVERGING,
      zmin: scoreGrid ? 0 : -signedLog(limit),
      zmax: scoreGrid ? 100 : signedLog(limit),
      xgap: 1,
      ygap: 1,
      hovertemplate:
        `TP %{x:.2f}% · SL %{y:.2f}% · ${h} d` +
        (scoreGrid ? `<br>${scoreName}: %{customdata[2]:.0f} / 100` : "") +
        `<br>${MODEL_LABEL[effModel]}: %{customdata[0]:.1f}% CAGR` +
        (other ? `<br>${MODEL_LABEL[otherModel]}: %{customdata[1]:.1f}%` : "") +
        (shareGrid ? "<br>Label 1: %{customdata[3]:.0f}% of %{customdata[4]:,} samples" : "") +
        "<extra></extra>",
      colorbar: scoreGrid
        ? {
            title: { text: `${scoreName} (0–100)`, side: "right", font: { size: 11, color: T.title } },
            thickness: 9,
            len: 0.9,
            outlinewidth: 0,
            tickvals: [0, 25, 50, 75, 100],
            tickfont: { size: 10.5, color: T.tick },
          }
        : {
            title: { text: "CAGR (signed log scale)", side: "right", font: { size: 11, color: T.title } },
            thickness: 9,
            len: 0.9,
            outlinewidth: 0,
            tickvals: ticks.vals,
            ticktext: ticks.text,
            tickfont: { size: 10.5, color: T.tick },
          },
    } as Data,
  ];
  if (bestIdx && bestIdx.hi === hIndex) {
    traces.push({
      type: "scatter",
      mode: "markers",
      x: [tpPct[bestIdx.ti]],
      y: [slPct[bestIdx.si]],
      marker: { symbol: "star", size: 13, color: "#ffffff", line: { color: "#000", width: 1 } },
      hoverinfo: "skip",
    });
  }
  traces.push({
    type: "scatter",
    mode: "markers",
    x: [tpPct[sel.ti]],
    y: [slPct[sel.si]],
    marker: { symbol: "square-open", size: 17, color: T.select, line: { width: 2 } },
    hoverinfo: "skip",
  });

  const onHeatClick = (e: Readonly<PlotMouseEvent>) => {
    const p = e.points?.[0];
    if (p) setCell({ ti: nearestIndex(tpPct, Number(p.x)), si: nearestIndex(slPct, Number(p.y)) });
  };
  const onProfileClick = (e: Readonly<PlotMouseEvent>) => {
    const p = e.points?.[0];
    if (p) setHIndex(nearestIndex(surface.horizons, Number(p.x)));
  };

  const profileTraces: Data[] = [
    { type: "scatter", mode: "lines", x: surface.horizons, y: profLabel, name: "Label payoff", line: { color: T.label, width: 1.5, dash: "dash" }, hovertemplate: "%{x} d · %{y:.1f}%<extra>Label payoff</extra>" },
  ];
  if (profMtm.length) {
    profileTraces.push({ type: "scatter", mode: "lines", x: surface.horizons, y: profMtm, name: "Market-valued", line: { color: T.mtm, width: 1.6 }, hovertemplate: "%{x} d · %{y:.1f}%<extra>Market-valued</extra>" });
  }

  return (
    <div id="tp-sl-heatmap" className="scroll-mt-24">
      <Card
        title="TP × SL score at a fixed horizon"
        note={`Each cell is one take-profit / stop-loss pair at the chosen holding horizon, coloured by its ${scoreGrid ? `${scoreName.toLowerCase()} score (0–100)` : `${MODEL_LABEL[effModel].toLowerCase()} CAGR`}. Scores are in-sample${candidates?.periods.evaluation ? " (research period)" : ""}.`}
        aside={
          <>
            {candidates ? (
              <Segmented
                label="Ranking"
                value={rankMode}
                onChange={setRankMode}
                options={RANK_MODES.map((m) => ({ value: m.value, label: m.label, title: m.title, disabled: m.value !== "profitability" && !research?.metrics[m.value] }))}
              />
            ) : null}
            <Segmented
              label="Payoff model"
              value={effModel}
              onChange={setModel}
              options={[
                { value: "label", label: "Label payoff", title: "The optimizer's own objective: expiries booked at 0%" },
                { value: "mtm", label: "Market-valued", disabled: !surface.mtm, title: surface.mtm ? "Audit: expiries valued at the close" : "Not available for this run" },
              ]}
            />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.07] pb-3">
          <label className="flex w-full min-w-0 items-center gap-3 text-[12.5px] text-white/50 sm:w-auto sm:flex-1">
            <span className="shrink-0">Horizon</span>
            <input
              type="range"
              min={0}
              max={surface.horizons.length - 1}
              value={hIndex}
              onChange={(e) => setHIndex(Number(e.target.value))}
              className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
              aria-label="Holding horizon"
            />
            <span className="w-16 shrink-0 text-right font-digits text-[13px] tabular-nums text-white">
              {h} day{h === 1 ? "" : "s"}
            </span>
          </label>
          <div className="flex items-center gap-1.5">
            <StepButton onClick={() => setHIndex(Math.max(0, hIndex - 1))} disabled={hIndex === 0} label="Previous horizon">
              ‹
            </StepButton>
            <StepButton onClick={() => setHIndex(Math.min(surface.horizons.length - 1, hIndex + 1))} disabled={hIndex >= surface.horizons.length - 1} label="Next horizon">
              ›
            </StepButton>
            {bestIdx ? (
              <button
                type="button"
                className={btnSm}
                onClick={() => {
                  setHIndex(bestIdx.hi);
                  setCell({ si: bestIdx.si, ti: bestIdx.ti });
                }}
              >
                ★ Highest {rankMode === "profitability" ? "score" : RANK_LABEL[rankMode]}
              </button>
            ) : null}
          </div>
          {surface.source === "heatmaps" ? (
            <span className="w-full text-[12px] text-white/40">Older run: only {surface.horizons.length} horizon slices were exported; the market-valued surface is unavailable.</span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 overflow-x-auto">
            <div className="h-[360px] min-w-[420px] sm:h-[420px]">
              <Plot
                data={traces}
                layout={baseLayout({
                  margin: { l: 62, r: 8, t: 6, b: 48 },
                  xaxis: axis("Take profit (% above entry)", { ticksuffix: "%", showgrid: false }),
                  yaxis: axis("Stop loss (% below entry)", { ticksuffix: "%", showgrid: false }),
                })}
                config={PLOT_CONFIG}
                style={{ width: "100%", height: "100%" }}
                onClick={onHeatClick}
                useResizeHandler
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-white/45">
              <span>Click a cell to inspect it.</span>
              <Legend
                items={[
                  { label: `highest ${RANK_LABEL[rankMode]}`, color: "#fff", kind: "star" },
                  { label: "selected", color: T.select, kind: "ring" },
                ]}
              />
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-8 rounded-sm"
                  style={{ background: `linear-gradient(90deg, ${(scoreGrid ? SEQUENTIAL : DIVERGING).map(([p, c]) => `${c} ${p * 100}%`).join(", ")})` }}
                />
                {scoreGrid ? "0 · 100" : "loss · 0 · gain"}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-lg border border-white/[0.08] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] text-white/45">Selected cell</p>
                {isBest ? <MethodTag>Highest {rankMode === "profitability" ? "score" : RANK_LABEL[rankMode]}</MethodTag> : null}
              </div>
              <p className="mt-1.5 font-digits text-[14px] tabular-nums text-white">
                TP {fmtFrac(surface.tp[sel.ti])} · SL {fmtFrac(surface.sl[sel.si])} · {h} d
              </p>
              <dl className="mt-2.5 space-y-1.5 text-[12.5px]">
                <Row k={`${MODEL_LABEL[effModel]} CAGR`} v={fmtPct(selVal, 1, true)} tone={signTone(selVal)} />
                {other ? <Row k={`${MODEL_LABEL[otherModel]} CAGR`} v={fmtPct(selOther, 1, true)} tone={signTone(selOther)} /> : null}
                <Row k="Beats share of this slice" v={selPct != null ? `${selPct.toFixed(0)}%` : "—"} />
                <Row k="Neighbours at this horizon" v={selNb ? `${Math.round(selNb.median_ratio * 100)}% of cell` : "—"} />
                <Row k="Shape at this horizon" v={REGION_COPY[selRegion].label} tone={selRegion === "isolated" ? "bad" : "neutral"} />
              </dl>
              <CellDiagnostics at={{ hi: hIndex, ...sel }} />
              <GenerateDatasetLink at={{ hi: hIndex, ...sel }} className="mt-3 w-full justify-center" />
              <button type="button" onClick={() => goTab("search")} className="mt-3 text-[12.5px] text-white/50 underline-offset-4 transition hover:text-white hover:underline">
                Locate in 3D search space →
              </button>
            </div>
            <div className="rounded-lg border border-white/[0.08] p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-[12.5px] text-white/45">This cell across horizons</p>
                <span className="text-[11.5px] text-white/35">click to jump</span>
              </div>
              <div className="mt-1 h-[160px]">
                <Plot
                  data={profileTraces}
                  layout={baseLayout({
                    margin: { l: 44, r: 6, t: 6, b: 30 },
                    xaxis: axis("", horizonAxis(surface.horizons, { tickfont: { size: 10, color: T.tick } })),
                    yaxis: axis("", { tickfont: { size: 10, color: T.tick }, ticksuffix: "%" }),
                    shapes: [{ type: "line", xref: "x", yref: "paper", x0: h, x1: h, y0: 0, y1: 1, line: { color: T.select, width: 1, dash: "dot" } }],
                    hovermode: "x unified",
                  })}
                  config={PLOT_CONFIG}
                  style={{ width: "100%", height: "100%" }}
                  onClick={onProfileClick}
                  useResizeHandler
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Legend
                  items={[
                    { label: "Label payoff", color: T.label, dash: "dash" },
                    ...(profMtm.length ? [{ label: "Market-valued", color: T.mtm }] : []),
                  ]}
                />
                <span className="text-[11.5px] text-white/35">Horizon (days{surface.horizons.length > 20 ? ", log" : ""})</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StepButton({ children, onClick, disabled, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={cx(btnSm, "w-8 justify-center px-0")}>
      {children}
    </button>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-white/45">{k}</dt>
      <dd className={cx("font-digits tabular-nums", tone ? TONE_TEXT[tone] : "text-white/85")}>{v}</dd>
    </div>
  );
}
