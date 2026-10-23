import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import type { Data, PlotMouseEvent, Shape } from "plotly.js";
import { btnSm } from "@/features/review/components/primitives";
import { flattenSurface, fmtFrac, fmtPct, quantileThreshold, signedLog, signedLogTicks, unpackIndex, type Model } from "../lib";
import { axis, baseLayout, Card, DIVERGING, Legend, PLOT_CONFIG, Segmented, SelectField, T, Unavailable } from "../ui";
import { useArtifact, useResults, type CellIdx } from "../state";
import { MODEL_LABEL } from "./OverviewTab";

/** Column arrays shared by the 3D view and the scatter. `index` links back to grid cells when available. */
type Points = {
  n: number;
  tp: ArrayLike<number>;
  sl: ArrayLike<number>;
  h: ArrayLike<number>;
  label: ArrayLike<number>;
  mtm: ArrayLike<number> | null;
  index: ArrayLike<number> | null;
  source: string;
};

type VoxelRaw = { tp?: number[]; sl?: number[]; h?: number[]; metric?: number[] } | { tp: number; sl: number; h: number; metric: number }[];

function pointsFromVoxel(raw: VoxelRaw | null): Points | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    return {
      n: raw.length,
      tp: raw.map((d) => d.tp),
      sl: raw.map((d) => d.sl),
      h: raw.map((d) => d.h),
      label: raw.map((d) => (Number.isFinite(d.metric) ? d.metric : NaN)),
      mtm: null,
      index: null,
      source: "voxel export",
    };
  }
  const { tp, sl, h, metric } = raw;
  if (!Array.isArray(tp) || !Array.isArray(sl) || !Array.isArray(h) || !Array.isArray(metric) || metric.length !== tp.length) return null;
  return { n: tp.length, tp, sl, h, label: metric, mtm: null, index: null, source: "voxel export" };
}

/** Full grid from the audit surface; older runs fall back to the optimizer's voxel export (label payoff only). */
function usePoints(): { points: Points | null; loading: boolean; complete: boolean } {
  const { surface, runId, artifacts, symbol } = useResults();
  const complete = surface?.source === "audit";
  const flat = useMemo(() => (complete && surface ? { ...flattenSurface(surface), source: "audit surface" } : null), [complete, surface]);
  const voxel = useArtifact<VoxelRaw>(runId, artifacts, [`${symbol}_voxel_cube_cagr`, "voxel_cube_cagr", "voxel_points", "voxel_points_top"], !complete);
  const fromVoxel = useMemo(() => pointsFromVoxel(voxel.data), [voxel.data]);
  return { points: flat ?? fromVoxel, loading: !flat && voxel.loading, complete };
}

function absMax(arr: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.abs(arr[i]!);
    if (Number.isFinite(v) && v > m) m = v;
  }
  return Math.max(m, 1);
}

export default function SearchSpaceTab() {
  const { points, loading, complete } = usePoints();
  const { metrics } = useResults();
  return (
    <div className="space-y-5">
      {points ? <VoxelCube points={points} complete={complete} /> : <Unavailable height={320}>{loading ? "Loading the parameter grid…" : "No 3D search-space export for this run."}</Unavailable>}
      {points ? <ParameterScatter points={points} /> : null}
      <div className="grid gap-5 xl:grid-cols-2">
        {points ? <ScoreDistribution points={points} /> : null}
        <Correlation metrics={metrics} />
      </div>
      <GridScatters metrics={metrics} />
    </div>
  );
}

// ------------------------------------------------------------------
// 3D voxel cube
// ------------------------------------------------------------------

const SHARES = [
  { value: "0.01", label: "Top 1%" },
  { value: "0.1", label: "Top 10%" },
  { value: "0.25", label: "Top 25%" },
  { value: "1", label: "All" },
] as const;
type Share = (typeof SHARES)[number]["value"];

function linkOf(points: Points, i: number, surfaceFor: (packed: number) => CellIdx | null): CellIdx | null {
  return points.index ? surfaceFor(points.index[i]!) : null;
}

function VoxelCube({ points, complete }: { points: Points; complete: boolean }) {
  const { surface, model, setModel, hIndex, cell, bestIdx, select } = useResults();
  const effModel: Model = model === "mtm" && points.mtm ? "mtm" : "label";
  const [share, setShare] = useState<Share>("0.1");
  const [logH, setLogH] = useState(true);
  const [context, setContext] = useState(false);
  const [rev, setRev] = useState(0);

  const vals = effModel === "mtm" && points.mtm ? points.mtm : points.label;
  const limit = useMemo(() => absMax(vals), [vals]);
  const ticks = useMemo(() => signedLogTicks(limit), [limit]);
  const thr = useMemo(() => quantileThreshold(vals, Number(share)), [vals, share]);

  const built = useMemo(() => {
    const shown: number[] = [];
    const rest: number[] = [];
    for (let i = 0; i < points.n; i++) {
      const v = vals[i]!;
      if (!Number.isFinite(v)) continue;
      (v >= thr ? shown : rest).push(i);
    }
    const pick = (idx: number[], f: (i: number) => number) => idx.map(f);
    return {
      shown,
      x: pick(shown, (i) => points.tp[i]! * 100),
      y: pick(shown, (i) => points.sl[i]! * 100),
      z: pick(shown, (i) => points.h[i]!),
      c: pick(shown, (i) => signedLog(vals[i]!)),
      cd: shown.map((i) => [points.label[i]!, points.mtm ? points.mtm[i]! : NaN]),
      rest,
    };
  }, [points, vals, thr]);

  const restTrace = useMemo(() => {
    if (!context) return null;
    const r = built.rest;
    return {
      type: "scatter3d",
      mode: "markers",
      x: r.map((i) => points.tp[i]! * 100),
      y: r.map((i) => points.sl[i]! * 100),
      z: r.map((i) => points.h[i]!),
      marker: { size: 1.2, color: "rgba(255,255,255,0.6)", opacity: 0.05 },
      hoverinfo: "skip",
    } as Data;
  }, [context, built.rest, points]);

  const unpack = (packed: number) => (surface ? unpackIndex(surface, packed) : null);

  const traces: Data[] = [
    {
      type: "scatter3d",
      mode: "markers",
      x: built.x,
      y: built.y,
      z: built.z,
      customdata: built.cd as unknown as number[],
      marker: {
        size: built.shown.length > 40000 ? 1.6 : built.shown.length > 8000 ? 2.2 : 3,
        opacity: 0.9,
        color: built.c,
        colorscale: DIVERGING,
        cmin: -signedLog(limit),
        cmax: signedLog(limit),
        colorbar: {
          title: { text: `${MODEL_LABEL[effModel]} CAGR`, side: "right", font: { size: 11, color: T.title } },
          thickness: 9,
          len: 0.7,
          outlinewidth: 0,
          tickvals: ticks.vals,
          ticktext: ticks.text,
          tickfont: { size: 10.5, color: T.tick },
        },
      },
      hovertemplate:
        "TP %{x:.2f}% · SL %{y:.2f}% · %{z} d<br>Label payoff: %{customdata[0]:.1f}% CAGR" + (points.mtm ? "<br>Market-valued: %{customdata[1]:.1f}% CAGR" : "") + "<extra></extra>",
    } as Data,
  ];
  if (restTrace) traces.push(restTrace);
  if (surface && bestIdx && complete) {
    traces.push({
      type: "scatter3d",
      mode: "markers",
      x: [surface.tp[bestIdx.ti]! * 100],
      y: [surface.sl[bestIdx.si]! * 100],
      z: [surface.horizons[bestIdx.hi]!],
      marker: { size: 6, symbol: "diamond", color: "#fff", line: { color: "#000", width: 1 } },
      hoverinfo: "skip",
    } as Data);
  }
  if (surface && cell && complete) {
    traces.push({
      type: "scatter3d",
      mode: "markers",
      x: [surface.tp[cell.ti]! * 100],
      y: [surface.sl[cell.si]! * 100],
      z: [surface.horizons[hIndex]!],
      marker: { size: 9, symbol: "circle-open", color: T.select, line: { color: T.select, width: 3 } },
      hoverinfo: "skip",
    } as Data);
  }

  const onClick = (e: Readonly<PlotMouseEvent>) => {
    const p = e.points?.[0];
    if (!p || p.curveNumber !== 0) return;
    const i = built.shown[p.pointNumber];
    if (i == null) return;
    const c = linkOf(points, i, unpack);
    if (c) select(c);
  };

  const axisStyle = (title: string, extra: Record<string, unknown> = {}) => ({
    title: { text: title, font: { size: 11.5, color: T.title } },
    tickfont: { size: 10.5, color: T.tick },
    gridcolor: "rgba(255,255,255,0.08)",
    zerolinecolor: "rgba(255,255,255,0.12)",
    linecolor: "rgba(255,255,255,0.16)",
    backgroundcolor: "rgba(0,0,0,0)",
    showbackground: false,
    ...extra,
  });

  const selTp = surface && cell ? surface.tp[cell.ti] : null;
  const selSl = surface && cell ? surface.sl[cell.si] : null;
  const selH = surface ? surface.horizons[hIndex] : null;

  return (
    <Card
      title="TP × SL × horizon search space"
      note={`Every evaluated cell of the grid (${points.n.toLocaleString("en-US")} from the ${points.source}). Colour uses the same signed-log scale as the heatmap. Drag to rotate, scroll to zoom${complete ? ", click a point to select that cell everywhere" : ""}.`}
      aside={
        <Segmented
          label="Payoff model"
          value={effModel}
          onChange={setModel}
          options={[
            { value: "label", label: "Label payoff" },
            { value: "mtm", label: "Market-valued", disabled: !points.mtm, title: points.mtm ? undefined : "Not available for this run" },
          ]}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.07] pb-3">
        <Segmented label="Cells shown" value={share} onChange={setShare} options={SHARES.map((s) => ({ ...s }))} />
        <label className="flex items-center gap-2 text-[12.5px] text-white/55">
          <input type="checkbox" checked={logH} onChange={(e) => setLogH(e.target.checked)} className="accent-white" />
          Log horizon axis
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-white/55">
          <input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} className="accent-white" />
          Show remaining cells faintly
        </label>
        <button type="button" className={btnSm} onClick={() => setRev((r) => r + 1)}>
          Reset view
        </button>
        <span className="font-digits text-[12px] tabular-nums text-white/40">
          {built.shown.length.toLocaleString("en-US")} cells{Number(share) < 1 ? ` · score ≥ ${fmtPct(thr, 1)}` : ""}
        </span>
      </div>
      <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="h-[460px] min-w-0 sm:h-[580px]">
          <Plot
            data={traces}
            layout={baseLayout({
              margin: { l: 0, r: 0, t: 0, b: 0 },
              uirevision: rev,
              scene: {
                bgcolor: "rgba(0,0,0,0)",
                xaxis: axisStyle("Take profit (%)", { ticksuffix: "%" }),
                yaxis: axisStyle("Stop loss (%)", { ticksuffix: "%" }),
                zaxis: axisStyle("Horizon (days)", logH ? { type: "log" } : {}),
                camera: { eye: { x: 1.35, y: -1.3, z: 0.75 } },
                aspectmode: "cube",
              },
            })}
            config={{ ...PLOT_CONFIG, scrollZoom: true }}
            style={{ width: "100%", height: "100%" }}
            onClick={onClick}
            useResizeHandler
          />
        </div>
        <div className="space-y-3 text-[12.5px]">
          <Legend
            items={[
              ...(complete ? [{ label: "highest optimizer score", color: "#fff", kind: "star" as const }, { label: "selected cell", color: T.select, kind: "ring" as const }] : []),
            ]}
          />
          {complete && selTp != null && selSl != null ? (
            <div className="rounded-lg border border-white/[0.08] p-3">
              <p className="text-white/45">Selected cell</p>
              <p className="mt-1 font-digits tabular-nums text-white">
                TP {fmtFrac(selTp)} · SL {fmtFrac(selSl)} · {selH} d
              </p>
              <button type="button" className={`${btnSm} mt-2.5`} onClick={() => cell && select({ hi: hIndex, ...cell }, true)}>
                Open in heatmap
              </button>
            </div>
          ) : null}
          <p className="leading-relaxed text-white/40">
            Filtering by score share keeps the rendering responsive; “All” draws every cell. The cube shows where high scores concentrate, not whether they hold out of
            sample.
          </p>
          {!complete ? <p className="leading-relaxed text-white/40">This run predates the methodology audit: only the label-payoff score is available and points cannot be linked to the heatmap.</p> : null}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Parameter scatter
// ------------------------------------------------------------------

type XKey = "h" | "tp" | "sl" | "spread" | "label";
type YKey = "label" | "mtm";
type ColourKey = "none" | "h" | "tp" | "sl";

const X_OPTS: { value: XKey; label: string }[] = [
  { value: "h", label: "Horizon (days)" },
  { value: "tp", label: "Take profit (%)" },
  { value: "sl", label: "Stop loss (%)" },
  { value: "spread", label: "Spread TP − SL (pp)" },
  { value: "label", label: "Label-payoff CAGR (%)" },
];

const H_RANGES = [
  { value: "all", label: "All horizons", lo: 0, hi: Infinity },
  { value: "1-5", label: "1–5 days", lo: 1, hi: 5 },
  { value: "6-20", label: "6–20 days", lo: 6, hi: 20 },
  { value: "21-60", label: "21–60 days", lo: 21, hi: 60 },
  { value: "61+", label: "61+ days", lo: 61, hi: Infinity },
] as const;
type HRange = (typeof H_RANGES)[number]["value"];

function ParameterScatter({ points }: { points: Points }) {
  const { surface, audit, cell, hIndex, select } = useResults();
  const [x, setX] = useState<XKey>(points.mtm ? "label" : "h");
  const [y, setY] = useState<YKey>(points.mtm ? "mtm" : "label");
  const [colour, setColour] = useState<ColourKey>("h");
  const [range, setRange] = useState<HRange>("all");
  const [share, setShare] = useState<Share>("1");
  const yKey: YKey = y === "mtm" && !points.mtm ? "label" : y;
  const yVals = yKey === "mtm" ? points.mtm! : points.label;

  const val = (k: XKey | ColourKey, i: number): number => {
    switch (k) {
      case "h":
        return points.h[i]!;
      case "tp":
        return points.tp[i]! * 100;
      case "sl":
        return points.sl[i]! * 100;
      case "spread":
        return (points.tp[i]! - points.sl[i]!) * 100;
      case "label":
        return points.label[i]!;
      default:
        return 0;
    }
  };

  const thr = useMemo(() => quantileThreshold(yVals, Number(share)), [yVals, share]);
  const built = useMemo(() => {
    const r = H_RANGES.find((o) => o.value === range)!;
    const idx: number[] = [];
    for (let i = 0; i < points.n; i++) {
      const hv = points.h[i]!;
      const yv = yVals[i]!;
      if (!Number.isFinite(yv) || hv < r.lo || hv > r.hi || yv < thr) continue;
      if (x === "label" && !Number.isFinite(points.label[i]!)) continue;
      idx.push(i);
    }
    return {
      idx,
      x: idx.map((i) => val(x, i)),
      y: idx.map((i) => yVals[i]!),
      c: colour === "none" ? null : idx.map((i) => val(colour, i)),
      cd: idx.map((i) => [points.tp[i]! * 100, points.sl[i]! * 100, points.h[i]!, points.label[i]!, points.mtm ? points.mtm[i]! : NaN]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, yVals, x, colour, range, thr]);

  const unpack = (packed: number) => (surface ? unpackIndex(surface, packed) : null);
  const xLabel = X_OPTS.find((o) => o.value === x)!.label;
  const yLabel = `${MODEL_LABEL[yKey]} CAGR (%)`;
  const colourLabel = colour === "h" ? "Horizon (d)" : colour === "tp" ? "TP (%)" : colour === "sl" ? "SL (%)" : "";

  const traces: Data[] = [
    {
      type: "scattergl",
      mode: "markers",
      x: built.x,
      y: built.y,
      customdata: built.cd as unknown as number[],
      marker: built.c
        ? {
            size: 3.5,
            color: built.c,
            colorscale: [
              [0, "rgba(255,255,255,0.12)"],
              [1, "rgba(255,255,255,0.95)"],
            ],
            ...(colour === "h" ? {} : {}),
            colorbar: { title: { text: colourLabel, side: "right", font: { size: 11, color: T.title } }, thickness: 8, len: 0.8, outlinewidth: 0, tickfont: { size: 10.5, color: T.tick } },
          }
        : { size: 3.5, color: "rgba(255,255,255,0.35)" },
      hovertemplate:
        "TP %{customdata[0]:.2f}% · SL %{customdata[1]:.2f}% · %{customdata[2]} d<br>Label payoff: %{customdata[3]:.1f}%" + (points.mtm ? "<br>Market-valued: %{customdata[4]:.1f}%" : "") + "<extra></extra>",
    } as Data,
  ];

  const shapes: Partial<Shape>[] = [];
  if (x === "label" && yKey === "mtm") {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of built.y) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (Number.isFinite(lo) && Number.isFinite(hi)) shapes.push({ type: "line", x0: lo, x1: hi, y0: lo, y1: hi, line: { color: "rgba(255,255,255,0.3)", width: 1, dash: "dot" } });
  }
  shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "rgba(255,255,255,0.2)", width: 1 } });

  if (audit?.candidates?.length && surface) {
    const cands = audit.candidates;
    const cx = (c: (typeof cands)[number]) => (x === "h" ? c.h : x === "tp" ? c.tp * 100 : x === "sl" ? c.sl * 100 : x === "spread" ? (c.tp - c.sl) * 100 : c.cagr_pct ?? NaN);
    traces.push({
      type: "scatter",
      mode: "markers",
      x: cands.map(cx),
      y: cands.map((c) => (yKey === "mtm" ? c.mtm_cagr_pct : c.cagr_pct) ?? NaN),
      customdata: cands.map((c) => c.rank) as unknown as number[],
      marker: { size: 10, symbol: "circle-open", color: "#fff", line: { width: 1.5, color: "#fff" } },
      hovertemplate: "Candidate #%{customdata}<extra></extra>",
    } as Data);
  }
  if (surface && cell && points.index) {
    const i = hIndex * surface.sl.length * surface.tp.length + cell.si * surface.tp.length + cell.ti;
    traces.push({
      type: "scatter",
      mode: "markers",
      x: [val(x, i)],
      y: [yVals[i]!],
      marker: { size: 14, symbol: "square-open", color: T.select, line: { width: 2, color: T.select } },
      hoverinfo: "skip",
    } as Data);
  }

  const onClick = (e: Readonly<PlotMouseEvent>) => {
    const p = e.points?.[0];
    if (!p) return;
    if (p.curveNumber === 0) {
      const i = built.idx[p.pointNumber];
      if (i != null && points.index) {
        const c = unpack(points.index[i]!);
        if (c) select(c);
      }
    } else if (p.curveNumber === 1 && audit && surface) {
      const c = audit.candidates[p.pointNumber];
      if (c) select({ hi: surface.horizons.indexOf(c.h), si: surface.sl.findIndex((v) => Math.abs(v - c.sl) < 1e-9), ti: surface.tp.findIndex((v) => Math.abs(v - c.tp) < 1e-9) });
    }
  };

  return (
    <Card
      title="Parameter-space scatter"
      note="Each point is one grid cell. Choose what to plot, filter by horizon or score, and click a point or a ringed candidate to select it in the heatmap and 3D view."
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.07] pb-3">
        <SelectField label="x" value={x} onChange={setX} options={X_OPTS.filter((o) => o.value !== "label" || yKey !== "label")} />
        <SelectField
          label="y"
          value={yKey}
          onChange={setY}
          options={[{ value: "label", label: "Label-payoff CAGR" }, ...(points.mtm ? [{ value: "mtm" as const, label: "Market-valued CAGR" }] : [])]}
        />
        <SelectField
          label="Colour"
          value={colour}
          onChange={setColour}
          options={[
            { value: "none", label: "None" },
            { value: "h", label: "Horizon" },
            { value: "tp", label: "Take profit" },
            { value: "sl", label: "Stop loss" },
          ]}
        />
        <SelectField label="Horizons" value={range} onChange={setRange} options={H_RANGES.map((r) => ({ value: r.value, label: r.label }))} />
        <Segmented label="Score share" value={share} onChange={setShare} options={SHARES.map((s) => ({ ...s }))} />
        <span className="font-digits text-[12px] tabular-nums text-white/40">{built.idx.length.toLocaleString("en-US")} cells</span>
      </div>
      <div className="mt-2 h-[380px] min-w-0">
        <Plot
          data={traces}
          layout={baseLayout({
            margin: { l: 64, r: 10, t: 8, b: 48 },
            xaxis: axis(xLabel, x === "h" ? { type: "log", tickvals: [1, 2, 5, 10, 20, 50, 100, 200] } : {}),
            yaxis: axis(yLabel, { ticksuffix: "%" }),
            shapes,
            hovermode: "closest",
          })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          onClick={onClick}
          useResizeHandler
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Legend
          items={[
            { label: "grid cell", color: "rgba(255,255,255,0.6)", kind: "box" },
            ...(audit?.candidates?.length ? [{ label: "ranked candidates", color: "#fff", kind: "ring" as const }] : []),
            ...(points.index ? [{ label: "selected", color: T.select, kind: "ring" as const }] : []),
            ...(x === "label" && yKey === "mtm" ? [{ label: "y = x (no inflation)", color: "rgba(255,255,255,0.4)", dash: "dot" as const }] : []),
          ]}
        />
      </div>
      {x === "label" && yKey === "mtm" ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/45">
          Points below the dotted line score lower once expired trades are valued at the close. The vertical spread shows how weakly the optimizer’s objective ranks
          cells by their market-valued result.
        </p>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------
// Distribution, correlation, sampled grid scatters
// ------------------------------------------------------------------

function ScoreDistribution({ points }: { points: Points }) {
  const { audit } = useResults();
  const toArr = (a: ArrayLike<number>) => Array.from(a).filter((v) => Number.isFinite(v));
  const label = useMemo(() => toArr(points.label), [points.label]);
  const mtm = useMemo(() => (points.mtm ? toArr(points.mtm) : null), [points.mtm]);
  const best = audit?.best.cagr_pct ?? (label.length ? label.reduce((m, v) => (v > m ? v : m), -Infinity) : null);
  const traces: Data[] = [
    { type: "histogram", x: label, name: "Label payoff", nbinsx: 90, marker: { color: "rgba(255,255,255,0.32)" }, hovertemplate: "%{x}<br>%{y:,} cells<extra>Label payoff</extra>" } as Data,
  ];
  if (mtm) traces.push({ type: "histogram", x: mtm, name: "Market-valued", nbinsx: 90, marker: { color: "rgba(255,255,255,0.85)" }, opacity: 0.75, hovertemplate: "%{x}<br>%{y:,} cells<extra>Market-valued</extra>" } as Data);
  return (
    <Card
      title="Distribution of scores across the grid"
      note={`All ${label.length.toLocaleString("en-US")} cells, not a sample. The highest score is the extreme right tail of this distribution, chosen in-sample.`}
      aside={
        <Legend
          items={[
            { label: "Label payoff", color: "rgba(255,255,255,0.32)", kind: "box" },
            ...(mtm ? [{ label: "Market-valued", color: "rgba(255,255,255,0.85)", kind: "box" as const }] : []),
          ]}
        />
      }
    >
      <div className="h-[280px]">
        <Plot
          data={traces}
          layout={baseLayout({
            barmode: "overlay",
            bargap: 0.02,
            margin: { l: 56, r: 10, t: 8, b: 46 },
            xaxis: axis("CAGR (%)", { ticksuffix: "%" }),
            yaxis: axis("Cells (log scale)", { type: "log" }),
            shapes: best != null ? [{ type: "line", xref: "x", yref: "paper", x0: best, x1: best, y0: 0, y1: 1, line: { color: "rgba(255,255,255,0.6)", width: 1, dash: "dot" } }] : [],
            annotations: best != null ? [{ x: best, y: 1, xref: "x", yref: "paper", text: `top cell ${fmtPct(best, 0)}`, showarrow: false, xanchor: "right", yanchor: "top", font: { size: 11, color: T.tick } }] : [],
          })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
    </Card>
  );
}

const CORR_SCALE: [number, string][] = [
  [0, "rgb(96,165,250)"],
  [0.5, "#0d0d11"],
  [1, "rgb(251,146,60)"],
];

const CORR_LABELS: Record<string, string> = {
  tp_frac: "Take profit",
  sl_frac: "Stop loss",
  h: "Horizon",
  compounded_cagr_pct: "Label CAGR",
  max_drawdown_pct: "Realised max DD",
};

function Correlation({ metrics }: { metrics: Record<string, any> | null }) {
  const corr = metrics?.correlation_data;
  if (!corr?.matrix || !corr?.labels) return <Unavailable>No parameter correlation matrix was exported for this run.</Unavailable>;
  const z = corr.matrix as number[][];
  const labels = (corr.labels as string[]).map((l) => CORR_LABELS[l] ?? l);
  return (
    <Card title="Parameter correlation" note="Pearson ρ across all grid cells, as exported by the optimizer. Linear association only.">
      <div className="h-[280px]">
        <Plot
          data={[
            {
              type: "heatmap",
              z,
              x: labels,
              y: labels,
              colorscale: CORR_SCALE,
              zmin: -1,
              zmax: 1,
              text: z.map((r) => r.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "—"))) as unknown as string[],
              texttemplate: "%{text}",
              textfont: { size: 11, color: "rgba(255,255,255,0.85)" },
              hovertemplate: "%{y} × %{x}<br>ρ = %{z:.3f}<extra></extra>",
              xgap: 2,
              ygap: 2,
              colorbar: { thickness: 8, outlinewidth: 0, tickfont: { size: 10.5, color: T.tick }, title: { text: "ρ", side: "right", font: { size: 11, color: T.title } } },
            } as Data,
          ]}
          layout={baseLayout({ margin: { l: 120, r: 10, t: 6, b: 90 }, xaxis: axis("", { tickangle: -30, showgrid: false }), yaxis: axis("", { autorange: "reversed", showgrid: false }) })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
    </Card>
  );
}

function sampleNote(d: { displayed_points?: number; total_points?: number; sampled?: boolean } | undefined) {
  if (!d?.total_points) return "";
  return d.sampled ? `${(d.displayed_points ?? 0).toLocaleString("en-US")} of ${d.total_points.toLocaleString("en-US")} cells (density-balanced sample exported by the optimizer)` : `All ${d.total_points.toLocaleString("en-US")} cells`;
}

function GridScatters({ metrics }: { metrics: Record<string, any> | null }) {
  const sc = metrics?.scatter_data;
  const pr = metrics?.prediction_data;
  if (!sc?.max_dd?.length && !pr?.l1_rate?.length) return null;
  const pointStyle = { size: 2.8, color: "rgba(255,255,255,0.4)" };
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {sc?.max_dd?.length ? (
        <Card title="CAGR vs realised drawdown" note={`${sampleNote(sc)}. Drawdown counts closed trades only, so it understates risk. Points carry no parameters, so they cannot be linked to cells.`}>
          <div className="h-[280px]">
            <Plot
              data={[{ type: "scattergl", mode: "markers", x: sc.max_dd, y: sc.cagr, marker: pointStyle, hovertemplate: "Drawdown %{x:.2f}%<br>CAGR %{y:.1f}%<extra></extra>" } as Data]}
              layout={baseLayout({ margin: { l: 60, r: 10, t: 8, b: 46 }, xaxis: axis("Realised max drawdown (%)", { ticksuffix: "%" }), yaxis: axis("Label-payoff CAGR (%)", { ticksuffix: "%" }), hovermode: "closest" })}
              config={PLOT_CONFIG}
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
            />
          </div>
        </Card>
      ) : null}
      {pr?.l1_rate?.length ? (
        <Card title="TP-hit share vs cumulative linear P/L" note={`${sampleNote(pr)}. TP-hit share = TP exits / (TP + SL exits); expired trades are excluded from it.`}>
          <div className="h-[280px]">
            <Plot
              data={[
                {
                  type: "scattergl",
                  mode: "markers",
                  x: pr.l1_rate,
                  y: (pr.pnl as number[]).map((p) => (Number.isFinite(p) ? p * 100 : NaN)),
                  marker: pointStyle,
                  hovertemplate: "TP-hit share %{x:.2f}<br>Linear P/L %{y:.1f}%<extra></extra>",
                } as Data,
              ]}
              layout={baseLayout({ margin: { l: 60, r: 10, t: 8, b: 46 }, xaxis: axis("TP-hit share", { tickformat: ".0%" }), yaxis: axis("Cumulative linear P/L (%)", { ticksuffix: "%" }), hovermode: "closest" })}
              config={PLOT_CONFIG}
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
