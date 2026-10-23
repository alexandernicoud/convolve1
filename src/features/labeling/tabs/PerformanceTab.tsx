import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import type { Data } from "plotly.js";
import { cx } from "@/features/review/components/primitives";
import { fmtFrac, fmtPct, yearlyReturns, type Cell } from "../lib";
import { axis, baseLayout, Card, Legend, PLOT_CONFIG, Segmented, T, Unavailable } from "../ui";
import { useArtifact, useResults } from "../state";

type Line = { key: "label" | "mtm" | "asset"; name: string; values: Cell[]; color: string; dash?: "dash" | "dashdot"; width: number };

/** Prefer the audit's three aligned series; older runs only have the optimizer's label-payoff curve and the asset. */
function useSeries(): { dates: string[]; lines: Line[]; audited: boolean } | null {
  const { audit, timeseries } = useResults();
  return useMemo(() => {
    if (audit?.series?.dates?.length) {
      const s = audit.series;
      return {
        dates: s.dates,
        audited: true,
        lines: [
          { key: "mtm", name: "Market-valued", values: s.mark_to_market_pct, color: T.mtm, width: 2 },
          { key: "label", name: "Label payoff (optimizer)", values: s.label_model_pct, color: T.label, dash: "dash", width: 1.6 },
          { key: "asset", name: "Buy & hold", values: s.asset_pct, color: T.asset, dash: "dashdot", width: 1.4 },
        ],
      };
    }
    if (timeseries?.dates?.length && timeseries.strategy_compounded_pct) {
      return {
        dates: timeseries.dates,
        audited: false,
        lines: [
          { key: "label", name: "Label payoff (optimizer)", values: timeseries.strategy_compounded_pct, color: T.mtm, width: 2 },
          ...(timeseries.asset_normalized_pct ? [{ key: "asset" as const, name: "Buy & hold", values: timeseries.asset_normalized_pct, color: T.asset, dash: "dashdot" as const, width: 1.4 }] : []),
        ],
      };
    }
    return null;
  }, [audit, timeseries]);
}

const toGrowth = (v: Cell) => (v == null || !Number.isFinite(v) ? null : 100 * (1 + v / 100));

function drawdown(values: Cell[]): (number | null)[] {
  let peak = -Infinity;
  return values.map((v) => {
    const g = toGrowth(v);
    if (g == null) return null;
    peak = Math.max(peak, g);
    return peak > 0 ? (g / peak - 1) * 100 : null;
  });
}

const dashOf = (d?: "dash" | "dashdot") => (d === "dash" ? "5px,4px" : d === "dashdot" ? "6px,2px,1px,2px" : undefined);

export default function PerformanceTab() {
  const series = useSeries();
  if (!series) return <Unavailable height={320}>No equity series was exported for this run.</Unavailable>;
  return (
    <div className="space-y-5">
      <Equity {...series} />
      <Yearly {...series} />
    </div>
  );
}

function Equity({ dates, lines, audited }: { dates: string[]; lines: Line[]; audited: boolean }) {
  const { audit } = useResults();
  const [scale, setScale] = useState<"growth" | "total">("growth");
  const traces: Data[] = lines.map(
    (l) =>
      ({
        type: "scatter",
        mode: "lines",
        x: dates,
        y: scale === "growth" ? l.values.map(toGrowth) : l.values,
        name: l.name,
        line: { color: l.color, width: l.width, dash: dashOf(l.dash) },
        connectgaps: false,
        hovertemplate: scale === "growth" ? `%{y:,.1f}<extra>${l.name}</extra>` : `%{y:+,.1f}%<extra>${l.name}</extra>`,
      }) as Data,
  );
  const dd: Data[] = lines.map(
      (l) =>
        ({
          type: "scatter",
          mode: "lines",
          x: dates,
          y: drawdown(l.values),
          name: l.name,
          line: { color: l.color, width: 1.3, dash: dashOf(l.dash) },
          fill: l.key === "asset" ? undefined : "tozeroy",
          fillcolor: "rgba(252,165,165,0.08)",
          hovertemplate: `%{y:.1f}%<extra>${l.name}</extra>`,
        }) as Data,
    );
  const p = audit?.best;
  return (
    <Card
      title="Equity of the selected labels"
      note={
        <>
          Daily compounded equity of the highest-scoring cell{p ? ` (TP ${fmtFrac(p.tp)} · SL ${fmtFrac(p.sl)} · ${p.h} d)` : ""}, in-sample.{" "}
          {audited
            ? "Label payoff books every expired trade at 0% (cost only); market-valued books it at the actual close-to-entry move."
            : "This run predates the market-valued audit, so only the optimizer's label payoff is shown."}
        </>
      }
      aside={
        <Segmented
          label="Scale"
          value={scale}
          onChange={setScale}
          options={[
            { value: "growth", label: "Growth of 100 (log)" },
            { value: "total", label: "Total return (%)" },
          ]}
        />
      }
    >
      <Legend items={lines.map((l) => ({ label: l.name, color: l.color, dash: l.dash ?? "solid" }))} />
      <div className="mt-2 h-[340px]">
        <Plot
          data={traces}
          layout={baseLayout({
            margin: { l: 64, r: 12, t: 8, b: 30 },
            hovermode: "x unified",
            xaxis: axis("", { type: "date", showgrid: false }),
            yaxis: axis(scale === "growth" ? "Value of 100 (log scale)" : "Total return (%)", scale === "growth" ? { type: "log" } : { ticksuffix: "%" }),
            shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: scale === "growth" ? 100 : 0, y1: scale === "growth" ? 100 : 0, line: { color: "rgba(255,255,255,0.22)", width: 1 } }],
          })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
      <p className="mt-3 text-[12.5px] text-white/45">
        Drawdown from the running peak of each curve above.
      </p>
      <div className="h-[150px]">
        <Plot
          data={dd}
          layout={baseLayout({
            margin: { l: 64, r: 12, t: 6, b: 30 },
            hovermode: "x unified",
            xaxis: axis("", { type: "date", showgrid: false }),
            yaxis: axis("Drawdown (%)", { ticksuffix: "%", rangemode: "tozero" }),
          })}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      </div>
    </Card>
  );
}

type YearRow = { year: string; first: string; last: string; sessions: number; values: Record<string, number | null> };

function Yearly({ dates, lines }: { dates: string[]; lines: Line[] }) {
  const { runId, artifacts, symbol } = useResults();
  const derived = useMemo<YearRow[]>(() => {
    const per = lines.map((l) => ({ key: l.key, rows: yearlyReturns(dates, l.values) }));
    const base = per[0]?.rows ?? [];
    return base.map((r, i) => ({
      year: r.year,
      first: r.first,
      last: r.last,
      sessions: r.sessions,
      values: Object.fromEntries(per.map((p) => [p.key, p.rows[i]?.value ?? null])),
    }));
  }, [dates, lines]);
  const exported = useArtifact<{ years?: number[]; strategy_yearly_compounded?: number[]; asset_yearly?: number[] }>(runId, artifacts, [`${symbol}_yearly_returns`, "yearly_returns"], derived.length === 0);
  const rows: YearRow[] = derived.length
    ? derived
    : (exported.data?.years ?? []).map((y, i) => ({
        year: String(y),
        first: "",
        last: "",
        sessions: 0,
        values: { label: exported.data?.strategy_yearly_compounded?.[i] ?? null, asset: exported.data?.asset_yearly?.[i] ?? null },
      }));
  if (!rows.length) return <Unavailable>No calendar-year breakdown is available for this run.</Unavailable>;

  const shown = lines.filter((l) => rows.some((r) => r.values[l.key] != null));
  const barColour: Record<string, string> = { mtm: "rgba(255,255,255,0.92)", label: "rgba(255,255,255,0.42)", asset: "rgba(190,190,190,0.22)" };
  const traces: Data[] = shown.map(
    (l) =>
      ({
        type: "bar",
        name: l.name,
        x: rows.map((r) => r.year),
        y: rows.map((r) => r.values[l.key]),
        marker: { color: barColour[l.key], line: l.key === "asset" ? { color: "rgba(190,190,190,0.7)", width: 1 } : { width: 0 } },
        hovertemplate: `%{x}: %{y:+,.1f}%<extra>${l.name}</extra>`,
      }) as Data,
  );
  const partial = rows.filter((r) => r.sessions > 0 && r.sessions < 240);
  return (
    <Card
      title="Calendar-year returns"
      note={
        partial.length
          ? `Partial years: ${partial.map((r) => `${r.year} (${r.first.slice(5)} → ${r.last.slice(5)}, ${r.sessions} sessions)`).join(", ")}. Each year chains from the previous year's last close, so years compound to the total.`
          : "Each year chains from the previous year's last close, so years compound to the total."
      }
      aside={<Legend items={shown.map((l) => ({ label: l.name, color: barColour[l.key]!, kind: "box" as const }))} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="h-[280px] min-w-0">
          <Plot
            data={traces}
            layout={baseLayout({
              barmode: "group",
              bargap: 0.35,
              bargroupgap: 0.08,
              margin: { l: 60, r: 10, t: 8, b: 30 },
              xaxis: axis("", { type: "category", showgrid: false }),
              yaxis: axis("Return (%)", { ticksuffix: "%" }),
            })}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: "100%" }}
            useResizeHandler
          />
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left text-white/45">
                <th className="py-2 pr-3 font-normal">Year</th>
                {shown.map((l) => (
                  <th key={l.key} className="py-2 pl-3 text-right font-normal">
                    {l.name.replace(" (optimizer)", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-digits tabular-nums">
              {rows.map((r) => (
                <tr key={r.year} className="border-b border-white/[0.05]">
                  <td className="py-2 pr-3 text-white/80">
                    {r.year}
                    {r.sessions > 0 && r.sessions < 240 ? <span className="ml-1.5 text-[11px] text-white/35">partial</span> : null}
                  </td>
                  {shown.map((l) => {
                    const v = r.values[l.key];
                    return (
                      <td key={l.key} className={cx("py-2 pl-3 text-right", v == null ? "text-white/30" : v < 0 ? "text-red-300/90" : "text-emerald-300/90")}>
                        {fmtPct(v, 1, true)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
