import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Plus } from "lucide-react";
import { btn, btnPrimary, cx, surface as surfaceClass } from "@/features/review/components/primitives";
import { fetchApi } from "@/lib/api";
import { buildConclusion, classifyRegion, fmtPct, nearestIndex, neighbourhood2D, REGION_COPY, sliceFor, type Audit, type Conclusion, type Model, type Tone } from "./lib";
import { MethodTag, StatusBadge, TONE_DOT, TONE_TEXT } from "./ui";
import { ResultsCtx, useRunData, type CellIdx, type Metrics, type ResultsCtxValue, type RunInfo, type TabId } from "./state";
import { parseRankMode, type RankMode, type ResearchCandidates } from "./research";
import OverviewTab from "./tabs/OverviewTab";
import SearchSpaceTab from "./tabs/SearchSpaceTab";
import PerformanceTab from "./tabs/PerformanceTab";
import RobustnessTab from "./tabs/RobustnessTab";
import FindingsTab from "./tabs/FindingsTab";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "search", label: "Search space" },
  { id: "performance", label: "Performance" },
  { id: "robustness", label: "Robustness" },
  { id: "findings", label: "Findings" },
];

export default function LabelingResultsPage() {
  const { runId } = useParams<{ runId: string }>();
  const location = useLocation();
  const backHref = (location.state as { fromRunHistory?: string } | null)?.fromRunHistory || "/products/labeling-optimizer/technical";
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "overview") as TabId;
  const data = useRunData(runId);
  const { audit, metrics, surface } = data;

  const [model, setModel] = useState<Model>("label");
  const rankMode: RankMode = data.candidates ? parseRankMode(params.get("rank")) : "profitability";
  const [hIndex, setHIndex] = useState(0);
  const [cell, setCell] = useState<{ si: number; ti: number } | null>(null);
  const tabsRef = useRef<HTMLElement>(null);

  const bestIdx = useMemo<CellIdx | null>(() => {
    if (!surface) return null;
    const best = rankMode === "profitability" ? surface.best : data.candidates?.best[rankMode];
    if (!best || !Number.isFinite(best.tp)) return null;
    return { hi: nearestIndex(surface.horizons, best.h), si: nearestIndex(surface.sl, best.sl), ti: nearestIndex(surface.tp, best.tp) };
  }, [surface, rankMode, data.candidates]);

  useEffect(() => {
    if (bestIdx) {
      setHIndex(bestIdx.hi);
      setCell({ si: bestIdx.si, ti: bestIdx.ti });
    }
  }, [bestIdx]);

  const localNb = useMemo(() => {
    if (!surface || !Number.isFinite(surface.best.tp)) return null;
    const b = { hi: nearestIndex(surface.horizons, surface.best.h), si: nearestIndex(surface.sl, surface.best.sl), ti: nearestIndex(surface.tp, surface.best.tp) };
    const g = sliceFor(surface, "label", b.hi);
    return g ? neighbourhood2D(g, b.si, b.ti) : null;
  }, [surface]);
  const conclusion = useMemo(() => buildConclusion(audit, metrics, localNb), [audit, metrics, localNb]);

  const goTab = useCallback(
    (t: TabId) => {
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (t === "overview") n.delete("tab");
        else n.set("tab", t);
        return n;
      }, { replace: true });
    },
    [setParams],
  );

  const setRankMode = useCallback(
    (m: RankMode) => {
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (m === "profitability") n.delete("rank");
        else n.set("rank", m);
        return n;
      }, { replace: true });
    },
    [setParams],
  );

  const select = useCallback(
    (c: CellIdx, openHeatmap = false) => {
      setHIndex(c.hi);
      setCell({ si: c.si, ti: c.ti });
      if (openHeatmap) {
        goTab("overview");
        requestAnimationFrame(() => document.getElementById("tp-sl-heatmap")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    },
    [goTab],
  );

  if (!runId) return <div className="flex min-h-[60vh] items-center justify-center text-white/60">No run ID provided.</div>;

  const symbol: string | undefined = audit?.symbol ?? metrics?.symbol;
  const ctx: ResultsCtxValue = { ...data, runId, symbol, conclusion, model, setModel, rankMode, setRankMode, hIndex, setHIndex, cell, setCell, bestIdx, select, goTab };

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5 pb-10">
      <Header runId={runId} backHref={backHref} audit={audit} metrics={metrics} conclusion={data.loading ? null : conclusion} runInfo={data.runInfo} candidates={data.loading ? undefined : data.candidates} />

      {data.loading ? <div className={cx(surfaceClass, "h-48 animate-pulse")} aria-busy /> : null}
      {data.error ? <p className="rounded-xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3 text-[13.5px] text-red-200/90">{data.error}</p> : null}

      {!data.loading && !data.error ? (
        <ResultsCtx.Provider value={ctx}>
          <Summary conclusion={conclusion} audit={audit} metrics={metrics} localNb={localNb} goTab={goTab} />
          <nav ref={tabsRef} className="flex gap-1 overflow-x-auto border-b border-white/[0.08]" aria-label="Optimizer results">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => goTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cx(
                  "relative whitespace-nowrap px-3.5 py-2.5 text-[14px] transition",
                  tab === t.id ? "text-white after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-white" : "text-white/50 hover:text-white/85",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {tab === "overview" ? <OverviewTab /> : null}
          {tab === "search" ? <SearchSpaceTab /> : null}
          {tab === "performance" ? <PerformanceTab /> : null}
          {tab === "robustness" ? <RobustnessTab /> : null}
          {tab === "findings" ? <FindingsTab /> : null}
        </ResultsCtx.Provider>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------

function Header({
  runId,
  backHref,
  audit,
  metrics,
  conclusion,
  runInfo,
  candidates,
}: {
  runId: string;
  backHref: string;
  audit: Audit | null;
  metrics: Metrics | null;
  conclusion: Conclusion | null;
  runInfo: RunInfo | null;
  candidates: ResearchCandidates | null | undefined;
}) {
  const symbol = audit?.symbol ?? metrics?.symbol;
  const periods = runInfo?.periods ?? candidates?.periods;
  const start = periods?.research.start ?? audit?.start ?? metrics?.start;
  const end = periods?.research.end ?? audit?.end ?? metrics?.end;
  const evaluation = periods?.evaluation;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pt-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] text-white/45">
          <Link to="/products/labeling-optimizer/technical" className="transition hover:text-white">
            Labeling optimizer
          </Link>
          <span>/</span>
          <span>Results</span>
        </div>
        <h1 className="mt-1.5 truncate text-[26px] font-semibold tracking-tight text-white">{symbol ? `${symbol} label search` : "Label search"}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13.5px] text-white/55">
          {conclusion ? <StatusBadge tone={conclusion.status.tone}>{conclusion.status.label}</StatusBadge> : null}
          {audit || metrics ? (
            <MethodTag kind="dashed">{audit?.evaluation === "out_of_sample" ? "Independently evaluated" : "In-sample search"}</MethodTag>
          ) : null}
          {start && end ? (
            <span className="font-digits tabular-nums" title={periods?.boundary}>
              {periods ? "Research " : ""}
              {start} → {end}
            </span>
          ) : null}
          {evaluation ? (
            <span className="font-digits tabular-nums text-white/55" title="Shown separately; never used for ranking">
              Evaluation {evaluation.start} → {evaluation.end}
            </span>
          ) : null}
          {candidates === null ? (
            <MethodTag kind="dashed">
              <span title="Run made before methodology v2: no CNN-suitability or robustness diagnostics, and the whole date range was searched.">Legacy run · methodology v1</span>
            </MethodTag>
          ) : null}
          {audit ? (
            <span className="text-white/45">
              {audit.bars} daily bars · {audit.robustness.grid_cells.toLocaleString("en-US")} parameter cells
            </span>
          ) : null}
          <span className="font-mono text-[12px] text-white/35" title="Run id">
            {runId}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={backHref} className={btn}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <DownloadButton runId={runId} />
        <Link to="/products/labeling-optimizer/technical" className={btnPrimary}>
          <Plus className="h-4 w-4" /> New optimization
        </Link>
      </div>
    </header>
  );
}

function DownloadButton({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={btn}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetchApi(`/api/labeling-optimizer/download-visuals/${runId}`, { method: "GET" });
          if (!res.ok) throw new Error("download failed");
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement("a");
          a.href = url;
          a.download = `labeling_optimizer_${runId}.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch {
          alert("Download failed. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="h-4 w-4" /> {busy ? "Preparing…" : "Export ZIP"}
    </button>
  );
}

// ------------------------------------------------------------------
// Research summary
// ------------------------------------------------------------------

function Summary({
  conclusion: c,
  audit,
  metrics,
  localNb,
  goTab,
}: {
  conclusion: Conclusion;
  audit: Audit | null;
  metrics: Metrics | null;
  localNb: ReturnType<typeof neighbourhood2D>;
  goTab: (t: TabId) => void;
}) {
  const item = (k: string) => c.items.find((i) => i.key === k);
  const evidence = ["params", "evaluation", "stability", "recommendation"].map(item).filter(Boolean) as Conclusion["items"];
  const assumptions = item("assumptions");
  const limits = assumptions?.detail ? assumptions.detail.split(" · ") : [];
  return (
    <section className={cx(surfaceClass, "overflow-hidden")} aria-label="Research summary">
      <div className="px-5 pb-4 pt-4">
        <p className="text-[12.5px] text-white/45">Research conclusion{audit ? " · methodology audit" : " · not audited"}</p>
        <h2 className="mt-1.5 max-w-5xl text-[18px] font-medium leading-snug tracking-tight text-white">{c.headline}</h2>
        <p className="mt-2 max-w-5xl text-[13.5px] leading-relaxed text-white/60">{c.summary}</p>
      </div>

      <MetricGrid audit={audit} metrics={metrics} localNb={localNb} />

      <div className="grid border-t border-white/[0.07] lg:grid-cols-12">
        <div className="px-5 py-4 lg:col-span-5 lg:border-r lg:border-white/[0.07]">
          <p className="text-[12.5px] text-white/45">Evidence</p>
          <dl className="mt-2 space-y-1.5">
            {evidence.map((it) => (
              <div key={it.key} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-3 text-[13px]">
                <dt className="flex items-center gap-2 text-white/50">
                  <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[it.tone])} />
                  {it.label}
                </dt>
                <dd className={cx("min-w-0", TONE_TEXT[it.tone])} title={it.detail}>
                  {it.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="border-t border-white/[0.07] px-5 py-4 lg:col-span-4 lg:border-r lg:border-t-0">
          <p className="text-[12.5px] text-white/45">Limiting assumptions</p>
          {assumptions ? <p className={cx("mt-2 text-[13px]", TONE_TEXT[assumptions.tone])}>{assumptions.value}</p> : null}
          <ul className="mt-1 space-y-0.5 text-[12.5px] leading-relaxed text-white/50">
            {limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        <div className="border-t border-white/[0.07] px-5 py-4 lg:col-span-3 lg:border-t-0">
          <p className="text-[12.5px] text-white/45">Next action</p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/80">{c.nextSteps[0]}</p>
          {c.nextSteps.length > 1 ? (
            <button type="button" onClick={() => goTab("findings")} className="mt-2 text-[12.5px] text-white/50 underline-offset-4 transition hover:text-white hover:underline">
              {c.nextSteps.length - 1} more step{c.nextSteps.length > 2 ? "s" : ""} and all findings →
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function signTone(v: number | null | undefined): Tone {
  return v != null && Number.isFinite(v) && v < 0 ? "bad" : "neutral";
}

function Figure({ label, value, tag, tagKind, sub, tone }: { label: string; value: string; tag?: string; tagKind?: "solid" | "dashed"; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 bg-black px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-[13px] text-white/50">{label}</p>
        {tag ? <MethodTag kind={tagKind}>{tag}</MethodTag> : null}
      </div>
      <p className={cx("mt-2 font-digits text-[24px] font-semibold leading-none tabular-nums tracking-tight", tone === "bad" ? "text-red-300/90" : "text-white")}>{value}</p>
      {sub ? <div className="mt-2 text-[12px] leading-snug text-white/40">{sub}</div> : null}
    </div>
  );
}

function MetricGrid({ audit, metrics, localNb }: { audit: Audit | null; metrics: Metrics | null; localNb: ReturnType<typeof neighbourhood2D> }) {
  const grid = "grid grid-cols-1 gap-px border-t border-white/[0.07] bg-white/[0.06] min-[480px]:grid-cols-2 md:grid-cols-3";
  if (audit) {
    const wf = audit.walk_forward;
    const nb = audit.robustness.label_model;
    const region = audit.robustness.region;
    return (
      <div className={cx(grid, "xl:grid-cols-6")}>
        <Figure label="Optimizer score" value={fmtPct(audit.best.cagr_pct, 1)} tag="In-sample" tagKind="dashed" sub="CAGR of the label payoff (expiries booked at 0%)" />
        <Figure
          label="Market-valued"
          value={fmtPct(audit.mark_to_market.cagr_pct, 1, true)}
          tone={signTone(audit.mark_to_market.cagr_pct)}
          tag="Audit · in-sample"
          tagKind="dashed"
          sub={`Same trades, expiries at the close · max DD ${fmtPct(audit.mark_to_market.max_dd_marked_pct, 1)}`}
        />
        <Figure label="Buy & hold" value={fmtPct(audit.asset.cagr_pct, 1, true)} tone={signTone(audit.asset.cagr_pct)} tag="Same window" sub={`Total ${fmtPct(audit.asset.total_return_pct, 1, true)}`} />
        {wf.available ? (
          <Figure
            label={`Holdout · last ${wf.test.bars} bars`}
            value={fmtPct(wf.test.mark_to_market_return_pct, 1, true)}
            tone={signTone(wf.test.mark_to_market_return_pct)}
            tag="Out-of-sample"
            sub={`Market-valued total · buy & hold ${fmtPct(wf.test.buy_and_hold_return_pct, 1, true)}`}
          />
        ) : (
          <Figure label="Holdout" value="—" tag="Unavailable" sub={"reason" in wf ? wf.reason : undefined} />
        )}
        <Figure label="Neighbour stability" value={nb ? `${Math.round(nb.median_ratio * 100)}%` : "—"} tag={REGION_COPY[region].label} sub="Median neighbour score as share of the peak" />
        <Figure
          label="Exits of the top cell"
          value={`${audit.exits.tp_hits} · ${audit.exits.sl_hits} · ${audit.exits.expiries}`}
          tag="TP · SL · expired"
          sub={audit.exits.expiry_negative_share != null ? `${Math.round(audit.exits.expiry_negative_share * 100)}% of expiries were losing` : undefined}
        />
      </div>
    );
  }
  const m = metrics ?? {};
  const region = classifyRegion(localNb);
  return (
    <div className={cx(grid, "xl:grid-cols-4")}>
      <Figure label="Optimizer score" value={fmtPct(m.best_cagr, 1)} tag="In-sample" tagKind="dashed" sub="CAGR of the label payoff" />
      <Figure label="Linear P/L per year" value={fmtPct(m.best_linear_annual_pl, 1)} tag="In-sample" tagKind="dashed" />
      <Figure label="Buy & hold" value={fmtPct(m.asset_annual_cagr_pct, 1, true)} tag="Same window" />
      <Figure label="Neighbour stability" value={localNb ? `${Math.round(localNb.median_ratio * 100)}%` : "—"} tag={REGION_COPY[region].label} sub="Same horizon only" />
    </div>
  );
}
