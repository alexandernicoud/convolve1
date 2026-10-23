import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { btnSm, cx, Panel, StatusPill, surface } from "@/features/review/components/primitives";
import { fmtDateTime } from "@/lib/viz/format";
import { backtestApi, isV2, TERMINAL, type BacktestStatus, type EquityPayload, type MetricsPayload, type Summary, type Trade, type V2Summary } from "./api";
import { EvaluationBadge, MethodologyBadge } from "./ui";
import OverviewTab from "./tabs/OverviewTab";
import PerformanceTab from "./tabs/PerformanceTab";
import ThresholdTab from "./tabs/ThresholdTab";
import TradesTab from "./tabs/TradesTab";
import RobustnessTab from "./tabs/RobustnessTab";
import FindingsTab from "./tabs/FindingsTab";
import LegacyView from "./LegacyView";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "threshold", label: "Threshold lab" },
  { id: "trades", label: "Trade explorer" },
  { id: "robustness", label: "Robustness" },
  { id: "findings", label: "Findings" },
] as const;

export interface WorkspaceData {
  runId: string;
  summary: V2Summary;
  equity: EquityPayload | null;
  metrics: MetricsPayload | null;
  trades: Trade[] | null;
  loadTrades: () => void;
  goTab: (t: string) => void;
}

const Ctx = createContext<WorkspaceData | null>(null);
export function useWorkspace(): WorkspaceData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside BacktestWorkspace");
  return v;
}

const POLL_MS = 2000;
const MAX_POLL_FAILURES = 3;

export default function BacktestWorkspace() {
  const { runId = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "overview";
  const [status, setStatus] = useState<BacktestStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [equity, setEquity] = useState<EquityPayload | null>(null);
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const tradesRequested = useRef(false);
  const [pollNonce, setPollNonce] = useState(0);

  // Status polling: stops on any terminal state, and after repeated request failures (no silent retry loop).
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await backtestApi.status(runId);
        if (!alive) return;
        failures = 0;
        setStatus(s);
        setPollError(null);
        if (s.terminal || TERMINAL.includes(s.status)) return;
      } catch (e) {
        failures += 1;
        if (!alive) return;
        if (failures >= MAX_POLL_FAILURES) {
          setPollError(e instanceof Error ? e.message : "Could not reach the server");
          return;
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, pollNonce]);

  const succeeded = status?.status === "succeeded" && status.result_ready;
  useEffect(() => {
    if (!succeeded) return;
    let alive = true;
    backtestApi
      .summary(runId)
      .then((s) => {
        if (!alive) return;
        setSummary(s);
        if (isV2(s)) {
          backtestApi.equity(runId).then((e) => alive && setEquity(e)).catch(() => {});
          backtestApi.metrics(runId).then((m) => alive && setMetrics(m)).catch(() => {});
        }
      })
      .catch((e) => alive && setLoadErr(e instanceof Error ? e.message : "Could not load results"));
    return () => {
      alive = false;
    };
  }, [succeeded, runId]);

  const loadTrades = useCallback(() => {
    if (tradesRequested.current) return;
    tradesRequested.current = true;
    backtestApi.allTrades(runId).then(setTrades).catch(() => (tradesRequested.current = false));
  }, [runId]);

  const goTab = useCallback((t: string) => setSp((cur) => {
    const n = new URLSearchParams(cur);
    n.set("tab", t);
    return n;
  }), [setSp]);

  const data: WorkspaceData | null = useMemo(
    () => (summary && isV2(summary) ? { runId, summary, equity, metrics, trades, loadTrades, goTab } : null),
    [runId, summary, equity, metrics, trades, loadTrades, goTab],
  );

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          <Link to="/tools/backtester" className="inline-flex items-center gap-1 text-[13px] text-white/45 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Backtester
          </Link>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-tight text-white">Backtest research workspace</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/50">
            {summary ? <MethodologyBadge id={summary.methodology.id} /> : status?.methodology ? <MethodologyBadge id={status.methodology.id} /> : null}
            {summary && isV2(summary) ? <EvaluationBadge cls={summary.evaluation_class} /> : null}
            <span className="font-digits">{runId.slice(0, 8)}</span>
            {status?.started_at ? <span>· started {fmtDateTime(status.started_at)}</span> : null}
          </div>
        </div>
        {summary && isV2(summary) ? (
          <div className="flex flex-wrap gap-2">
            {(["trades", "equity", "predictions"] as const).map((a) => (
              <button key={a} type="button" className={btnSm} onClick={() => void backtestApi.downloadArtifact(runId, a)}>
                <Download className="h-3.5 w-3.5" /> {a}.csv
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {!succeeded ? (
        <RunState status={status} pollError={pollError} onRecheck={() => setPollNonce((n) => n + 1)} />
      ) : loadErr ? (
        <p className="rounded-xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3 text-[13.5px] text-red-200/90">{loadErr}</p>
      ) : !summary ? (
        <div className={cx(surface, "h-40 animate-pulse")} />
      ) : !isV2(summary) ? (
        <LegacyView summary={summary} />
      ) : data ? (
        <Ctx.Provider value={data}>
          <nav className="flex gap-1 overflow-x-auto border-b border-white/[0.08]" aria-label="Backtest modules">
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
          {tab === "performance" ? <PerformanceTab /> : null}
          {tab === "threshold" ? <ThresholdTab /> : null}
          {tab === "trades" ? <TradesTab /> : null}
          {tab === "robustness" ? <RobustnessTab /> : null}
          {tab === "findings" ? <FindingsTab /> : null}
        </Ctx.Provider>
      ) : null}
    </div>
  );
}

function RunState({ status, pollError, onRecheck }: { status: BacktestStatus | null; pollError: string | null; onRecheck: () => void }) {
  if (pollError) {
    return (
      <Panel title="Status unavailable">
        <p className="pl-4 text-[13.5px] text-white/60">Polling stopped after repeated errors: {pollError}</p>
        <button type="button" className={cx(btnSm, "ml-4 mt-3")} onClick={onRecheck}>
          Check status again
        </button>
        <p className="mt-2 pl-4 text-[12.5px] text-white/40">This only re-reads the status; it never restarts the backtest.</p>
      </Panel>
    );
  }
  if (!status) return <div className={cx(surface, "h-32 animate-pulse")} />;
  const live = !TERMINAL.includes(status.status);
  return (
    <Panel title={live ? "Backtest running" : "Backtest did not complete"} aside={<StatusPill status={status.status} progress={status.progress} />}>
      <div className="space-y-3 pl-4">
        {live ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-white/80 transition-all" style={{ width: `${Math.round((status.progress || 0) * 100)}%` }} />
          </div>
        ) : null}
        <p className="text-[13.5px] text-white/70">{status.message || (live ? "Working…" : "No message recorded.")}</p>
        {status.status === "succeeded" && !status.result_ready ? <p className="text-[13px] text-white/50">The run finished but wrote no results file.</p> : null}
        {status.log_tail ? (
          <pre className="max-h-64 overflow-auto rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-white/50">{status.log_tail}</pre>
        ) : null}
      </div>
    </Panel>
  );
}
