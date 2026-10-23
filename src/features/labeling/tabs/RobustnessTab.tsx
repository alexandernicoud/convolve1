import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import type { Data } from "plotly.js";
import { cx } from "@/features/review/components/primitives";
import {
  classifyRegion,
  fmtFrac,
  fmtPct,
  fmtSlRange,
  horizonEnvelope,
  nearestIndex,
  neighbourhood2D,
  REGION_COPY,
  sliceFor,
  type AuditCandidate,
  type Neighbourhood,
} from "../lib";
import { axis, baseLayout, Card, horizonAxis, Legend, MethodTag, PLOT_CONFIG, Segmented, T, Unavailable } from "../ui";
import { useArtifact, useResults } from "../state";

export default function RobustnessTab() {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Neighbourhoods />
        <Holdout />
      </div>
      <SpreadCurves />
      <Envelope />
      <Candidates />
    </div>
  );
}

// ------------------------------------------------------------------
// Neighbourhood stability
// ------------------------------------------------------------------

function NbBlock({ title, nb, tag }: { title: string; nb: Neighbourhood | null; tag?: string }) {
  const region = classifyRegion(nb);
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.08] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-white/80">{title}</p>
        {tag ? <MethodTag kind="dashed">{tag}</MethodTag> : null}
      </div>
      {nb ? (
        <>
          <p className={cx("mt-2 text-[15px] font-medium", region === "plateau" ? "text-white" : region === "unknown" ? "text-white/60" : "text-amber-200/85")}>
            {REGION_COPY[region].label}
          </p>
          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
            {[
              ["Peak", fmtPct(nb.best, 1)],
              ["Neighbour median", fmtPct(nb.median, 1)],
              ["Median / peak", nb.best > 0 ? `${(nb.median_ratio * 100).toFixed(0)}%` : "—"],
              ["Within 25% of peak", `${Math.round(nb.share_within_25pct * nb.count)} of ${nb.count}`],
              ["Within 50% of peak", `${Math.round(nb.share_within_50pct * nb.count)} of ${nb.count}`],
              ["Neighbour range", `${fmtPct(nb.min, 0)} … ${fmtPct(nb.max, 0)}`],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-white/45">{k}</dt>
                <dd className="text-right font-digits tabular-nums text-white/85">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-2 text-[12.5px] text-white/40">{REGION_COPY.unknown.detail}</p>
      )}
    </div>
  );
}

function Neighbourhoods() {
  const { audit, surface, bestIdx } = useResults();
  const local = useMemo(() => {
    if (!surface || !bestIdx) return null;
    const g = sliceFor(surface, "label", bestIdx.hi);
    return g ? neighbourhood2D(g, bestIdx.si, bestIdx.ti) : null;
  }, [surface, bestIdx]);
  const r = audit?.robustness;
  return (
    <Card
      title="Stability around the top cell"
      note={
        r
          ? `Scores of the cells adjacent to the top cell in TP, SL and horizon. A plateau suggests the result is not a single lucky cell; ${r.cells_within_10pct_of_best ?? "—"} of ${r.grid_cells.toLocaleString("en-US")} cells score within 10% of the peak.`
          : "Scores of the eight TP/SL cells adjacent to the top cell, at its horizon."
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {r ? (
          <>
            <NbBlock title="Label payoff" nb={r.label_model} tag="in-sample" />
            <NbBlock title="Market-valued" nb={r.mark_to_market} tag="in-sample" />
          </>
        ) : (
          <NbBlock title="Label payoff (TP × SL neighbours)" nb={local} tag="in-sample" />
        )}
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-white/45">
        {REGION_COPY[r ? r.region : classifyRegion(local)].detail} Stability is measured on the same data used for selection, so it is necessary but not sufficient
        evidence.
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------
// Chronological holdout
// ------------------------------------------------------------------

function Holdout() {
  const { audit } = useResults();
  const wf = audit?.walk_forward;
  if (!audit) return <Unavailable>This run predates the methodology audit; no chronological holdout was computed.</Unavailable>;
  if (!wf) return <Unavailable>Chronological holdout not computed for this run.</Unavailable>;
  if ("reason" in wf || !wf.available) return <Unavailable>Chronological holdout not available{"reason" in wf ? `: ${wf.reason}` : "."}</Unavailable>;
  const bars = [
    { name: "Train · in-sample (label payoff)", v: wf.train.in_sample_return_pct, kind: "train" },
    { name: "Test · label payoff", v: wf.test.label_model_return_pct, kind: "test" },
    { name: "Test · market-valued", v: wf.test.mark_to_market_return_pct, kind: "test" },
    { name: "Test · buy & hold", v: wf.test.buy_and_hold_return_pct, kind: "ref" },
  ];
  const colour = (b: (typeof bars)[number]) =>
    b.v != null && b.v < 0 ? "rgba(252,165,165,0.75)" : b.kind === "train" ? "rgba(255,255,255,0.28)" : b.kind === "ref" ? "rgba(190,190,190,0.45)" : "rgba(255,255,255,0.88)";
  const s = wf.train.selected;
  return (
    <Card
      title="Chronological holdout"
      note={`Parameters re-selected on the first ${Math.round(wf.train_fraction * 100)}% (${wf.train.start} → ${wf.train.end}, ${wf.train.bars} bars), then applied unchanged to ${wf.test.start} → ${wf.test.end} (${wf.test.bars} bars). Total returns over each window, not annualised.`}
      aside={<MethodTag>out-of-sample</MethodTag>}
    >
      <div className="h-[220px]">
        <Plot
          data={[
            {
              type: "bar",
              orientation: "h",
              y: bars.map((b) => `${b.name}   ${fmtPct(b.v, 1, true)}`),
              x: bars.map((b) => b.v),
              marker: { color: bars.map(colour) },
              hovertemplate: "%{y}<extra></extra>",
            } as Data,
          ]}
          layout={baseLayout({
            margin: { l: 10, r: 16, t: 4, b: 34 },
            xaxis: axis("Total return over the window (%)", { ticksuffix: "%", zeroline: true }),
            yaxis: axis("", { autorange: "reversed", showgrid: false, automargin: true }),
          })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-white/45">
        Selected on the training window: TP {fmtFrac(s.tp)} · SL {fmtFrac(s.sl)} · {s.h} d. Test exits: {wf.test.tp_hits} TP, {wf.test.sl_hits} SL, {wf.test.expiries} expired.
        {wf.test_percentile_label_model != null ? ` Its test-window label-payoff return beats ${fmtPct(wf.test_percentile_label_model, 1)} of all cells over the same window.` : ""}
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------
// CAGR vs horizon, grouped by spread
// ------------------------------------------------------------------

type SpreadGroup = { label: string; spread_pct_label?: string; spread_min?: number; spread_max?: number; horizons: number[]; cagr_values: (number | null)[] };

function SpreadCurves() {
  const { runId, artifacts } = useResults();
  const art = useArtifact<{ spread_groups?: SpreadGroup[] }>(runId, artifacts, ["cagr_vs_horizon_spread"]);
  const groups = art.data?.spread_groups?.filter((g) => Array.isArray(g.horizons) && g.horizons.length) ?? [];
  const [logX, setLogX] = useState(true);
  const [focus, setFocus] = useState<Set<number>>(new Set());
  if (!groups.length) {
    return art.loading ? <Unavailable height={320}>Loading CAGR vs horizon…</Unavailable> : <Unavailable>No CAGR-vs-horizon export for this run.</Unavailable>;
  }
  const n = groups.length;
  const toggle = (i: number) =>
    setFocus((f) => {
      const next = new Set(f);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const colourOf = (i: number) => {
    if (focus.size && !focus.has(i)) return "rgba(255,255,255,0.1)";
    const a = 0.3 + (0.66 * i) / Math.max(1, n - 1);
    return `rgba(255,255,255,${a.toFixed(2)})`;
  };
  const nameOf = (g: SpreadGroup) => `TP − SL ${g.spread_pct_label ?? g.label}`;
  const traces: Data[] = groups.map(
    (g, i) =>
      ({
        type: "scatter",
        mode: "lines",
        x: g.horizons,
        y: g.cagr_values,
        name: nameOf(g),
        line: { color: colourOf(i), width: focus.has(i) ? 2.4 : 1.5, dash: i % 2 ? "4px,3px" : undefined },
        connectgaps: false,
        hovertemplate: `%{x} d · %{y:,.1f}%<extra>${nameOf(g)}</extra>`,
      }) as Data,
  );
  const maxH = Math.max(...groups.map((g) => g.horizons[g.horizons.length - 1] ?? 1));
  return (
    <Card
      title="Label-payoff CAGR vs horizon, by TP − SL spread"
      note="Each line is the mean label-payoff CAGR at each horizon over all cells whose spread (take profit minus stop loss) falls in that band, as exported by the optimizer. Click a band to highlight it; lighter lines have wider spreads."
      aside={
        <Segmented
          label="Horizon axis"
          value={logX ? "log" : "linear"}
          onChange={(v) => setLogX(v === "log")}
          options={[
            { value: "log", label: "Log horizon" },
            { value: "linear", label: "Linear" },
          ]}
        />
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g, i) => (
          <button
            key={g.label}
            type="button"
            aria-pressed={focus.has(i)}
            onClick={() => toggle(i)}
            className={cx(
              "inline-flex items-center gap-2 rounded-md border px-2 py-1 font-digits text-[11.5px] tabular-nums transition",
              focus.has(i) ? "border-white/40 bg-white/[0.08] text-white" : "border-white/[0.1] text-white/55 hover:text-white/85",
            )}
          >
            <svg width="16" height="6" aria-hidden>
              <line x1="0" y1="3" x2="16" y2="3" stroke={`rgba(255,255,255,${(0.3 + (0.66 * i) / Math.max(1, n - 1)).toFixed(2)})`} strokeWidth="2" strokeDasharray={i % 2 ? "4 3" : undefined} />
            </svg>
            {g.spread_pct_label ?? g.label}
          </button>
        ))}
        {focus.size ? (
          <button type="button" onClick={() => setFocus(new Set())} className="px-2 py-1 text-[11.5px] text-white/45 hover:text-white/80">
            Clear
          </button>
        ) : null}
      </div>
      <div className="mt-2 h-[380px]">
        <Plot
          data={traces}
          layout={baseLayout({
            margin: { l: 64, r: 12, t: 8, b: 48 },
            hovermode: "closest",
            xaxis: axis("Horizon (days)", logX ? { type: "log", tickvals: [1, 2, 5, 10, 20, 50, 100, 200, 500].filter((t) => t <= maxH) } : {}),
            yaxis: axis("Mean label-payoff CAGR in band (%)", { ticksuffix: "%" }),
            shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "rgba(255,255,255,0.2)", width: 1 } }],
          })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Best score per horizon
// ------------------------------------------------------------------

function Envelope() {
  const { surface, hIndex, setHIndex } = useResults();
  if (!surface || surface.horizons.length < 2) return null;
  const lab = horizonEnvelope(surface, "label");
  const mtm = surface.mtm ? horizonEnvelope(surface, "mtm") : null;
  const traces: Data[] = [
    { type: "scatter", mode: "lines", x: surface.horizons, y: lab, name: "Label payoff", line: { color: T.label, width: 1.6, dash: "5px,4px" }, hovertemplate: "%{x} d · %{y:,.1f}%<extra>Label payoff</extra>" } as Data,
  ];
  if (mtm) traces.push({ type: "scatter", mode: "lines", x: surface.horizons, y: mtm, name: "Market-valued", line: { color: T.mtm, width: 2 }, hovertemplate: "%{x} d · %{y:,.1f}%<extra>Market-valued</extra>" } as Data);
  const h = surface.horizons[hIndex]!;
  return (
    <Card
      title="Best score at each horizon"
      note={`Highest CAGR in each horizon's TP × SL slice. Different horizons may peak at different TP/SL cells. Click to open that horizon in the heatmap (currently ${h} d).`}
      aside={<Legend items={[{ label: "Label payoff", color: T.label, dash: "dash" }, ...(mtm ? [{ label: "Market-valued", color: T.mtm }] : [])]} />}
    >
      <div className="h-[260px]">
        <Plot
          data={traces}
          layout={baseLayout({
            margin: { l: 64, r: 12, t: 8, b: 48 },
            hovermode: "x unified",
            xaxis: axis("Horizon (days)", horizonAxis(surface.horizons)),
            yaxis: axis("Best CAGR in slice (%)", { ticksuffix: "%" }),
            shapes: [
              { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "rgba(255,255,255,0.2)", width: 1 } },
              { type: "line", yref: "paper", x0: h, x1: h, y0: 0, y1: 1, line: { color: T.select, width: 1, dash: "dot" } },
            ],
          })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          onClick={(e) => {
            const x = e.points?.[0]?.x;
            if (typeof x === "number") setHIndex(nearestIndex(surface.horizons, x));
          }}
          useResizeHandler
        />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Ranked candidates
// ------------------------------------------------------------------

function Candidates() {
  const { audit, surface, select } = useResults();
  if (!audit?.candidates?.length) return null;
  const open = (c: AuditCandidate) => {
    if (!surface) return;
    const hi = surface.horizons.indexOf(c.h);
    const si = nearestIndex(surface.sl, c.sl);
    const ti = nearestIndex(surface.tp, c.tp);
    if (hi >= 0) select({ hi, si, ti }, true);
  };
  return (
    <Card
      title="Ranked candidates"
      note="Top distinct cells by the optimizer's label-payoff score. Cells with tied scores across stop-loss values are collapsed into one row with their SL range. Click a row to open it in the heatmap."
    >
      <div className="-mx-4 overflow-x-auto sm:-mx-5">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead>
            <tr className="border-b border-white/[0.08] text-left text-white/45">
              {["#", "TP", "SL", "Horizon", "Label CAGR", "Market-valued CAGR", "Trades", "TP-hit share", "Realised max DD", "Neighbours", "Region"].map((h, i) => (
                <th key={h} className={cx("whitespace-nowrap py-2 font-normal", i === 0 ? "pl-4 sm:pl-5" : "pl-3", i >= 4 && i <= 9 ? "text-right" : "", i === 10 ? "pr-4 sm:pr-5" : "")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-digits tabular-nums">
            {audit.candidates.map((c) => (
              <tr key={c.rank} onClick={() => open(c)} className="cursor-pointer border-b border-white/[0.05] transition hover:bg-white/[0.03]">
                <td className="py-2 pl-4 text-white/45 sm:pl-5">{c.rank}</td>
                <td className="py-2 pl-3 text-white/85">{fmtFrac(c.tp)}</td>
                <td className="py-2 pl-3 text-white/85">{fmtSlRange(c)}</td>
                <td className="py-2 pl-3 text-white/85">{c.h} d</td>
                <td className="py-2 pl-3 text-right text-white/70">{fmtPct(c.cagr_pct, 1)}</td>
                <td className={cx("py-2 pl-3 text-right", c.mtm_cagr_pct == null ? "text-white/30" : c.mtm_cagr_pct < 0 ? "text-red-300/90" : "text-emerald-300/90")}>{fmtPct(c.mtm_cagr_pct, 1, true)}</td>
                <td className="py-2 pl-3 text-right text-white/70">{c.trades}</td>
                <td className="py-2 pl-3 text-right text-white/70">{c.tp_share == null ? "—" : `${(c.tp_share * 100).toFixed(0)}%`}</td>
                <td className="py-2 pl-3 text-right text-white/70">{fmtPct(c.max_dd_pct, 1)}</td>
                <td className="py-2 pl-3 text-right text-white/70">{c.neighbour_median_ratio == null ? "—" : `${(c.neighbour_median_ratio * 100).toFixed(0)}%`}</td>
                <td className="whitespace-nowrap py-2 pl-3 pr-4 font-sans text-white/60 sm:pr-5">{REGION_COPY[c.region]?.label ?? c.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] text-white/45">“Neighbours” is the median neighbouring label score as a share of the cell's own score. Realised drawdown counts closed trades only.</p>
    </Card>
  );
}
