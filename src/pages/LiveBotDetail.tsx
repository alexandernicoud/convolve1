import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Radio } from "lucide-react";
import { botsApi, type BotTrade, type BotTradingDetailFull } from "@/lib/api";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import { SingleBotEquityChart } from "@/components/dashboard/SingleBotEquityChart";
import { botStatusBadgeDetailClass } from "@/components/dashboard/botStatusStyles";
import { formatConfidence, formatSignal } from "@/components/dashboard/dashboardMetrics";
import { cn } from "@/lib/utils";
import Button from "@/components/ui/button";

function fmtMoney(n: number) {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Calendar days between entry and exit (proxy when bar count is unavailable). */
function calendarDaysHeld(entryDate: string, exitDate: string | null | undefined): number | null {
  if (!exitDate) return null;
  const a = new Date(entryDate).getTime();
  const b = new Date(exitDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export default function LiveBotDetail() {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<BotTradingDetailFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!botId) return;
    setError(null);
    const d = await botsApi.getTrading(botId);
    setData(d);
  }, [botId]);

  useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load bot.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [botId, load]);

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setActionLoading(key);
    setError(null);
    try {
      const result = await fn();
      if (key === "close" && result && typeof result === "object" && result !== null && "performance" in result) {
        setData(result as BotTradingDetailFull);
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setActionLoading(null);
    }
  };

  const runArchive = async () => {
    if (!botId) return;
    if (!window.confirm("Archive this bot? It will disappear from the active dashboard overview.")) return;
    setActionLoading("archive");
    setError(null);
    try {
      await botsApi.archiveBot(botId);
      navigate("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed.");
    } finally {
      setActionLoading(null);
    }
  };

  if (!botId) {
    return (
      <div className="p-6 text-white">
        <p>Invalid bot.</p>
        <Link to="/dashboard" className="text-white/80 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const summary = data?.summary;
  const perf = data?.performance;
  const cfg = data?.config;
  const bot = data?.bot;
  const st = summary?.derived_status ?? bot?.derived_status ?? "—";
  const stClass = botStatusBadgeDetailClass(typeof st === "string" ? st : "active");
  const ls = summary?.lifecycle_state ?? bot?.lifecycle_state ?? "active";

  const canPause = ls === "active";
  const canResume = ls === "paused";
  const canClose = ls !== "closed" && ls !== "archived";
  const canArchive = ls !== "archived";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-auto p-4">
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-[12px] font-medium text-white/80 hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>
      </div>

      {error && (
        <div className="mb-3 border border-[#f87171]/25 bg-[#f87171]/10 px-4 py-2 text-sm text-[#fecaca]">{error}</div>
      )}

      {loading && !data && <p className="text-white/80">Loading…</p>}

      {data && summary && perf && cfg && bot && (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-8">
          {/* Header */}
          <div className={cn(dashboardCard, "p-4 md:p-5")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="font-sans text-[20px] font-semibold text-white">{bot.name || bot.symbol}</h1>
                <p className="mt-1 font-mono text-[12px] text-white/80">
                  {bot.symbol} · {bot.model_filename || "model"}
                </p>
                <p className="mt-2 text-[12px] text-[#9CA3AF]">
                  Lifecycle: <span className="font-mono text-white/80">{ls}</span>
                  {summary.started_at ? (
                    <>
                      {" "}
                      · Started <span className="font-mono text-white">{fmtTime(summary.started_at)}</span>
                    </>
                  ) : null}
                  {summary.days_running != null ? (
                    <>
                      {" "}
                      · Running ~{summary.days_running}d
                    </>
                  ) : null}
                  {summary.runtime_days != null ? ` · Runtime cap ${summary.runtime_days}d` : ""}
                </p>
                <p className="mt-1 text-[12px] text-white/80">
                  Next scheduled run:{" "}
                  <span className="font-mono text-white">{fmtTime(summary.next_scheduled_run_iso)}</span>
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 lg:items-end">
                <span className={stClass}>
                  <Radio className="h-3 w-3" />
                  {st}
                </span>
                <div className="flex flex-wrap gap-2">
                  {canPause && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="border border-white/15 text-[12px] text-[#E8ECFF]"
                      disabled={!!actionLoading}
                      onClick={() => void runAction("pause", () => botsApi.pauseBot(botId))}
                    >
                      {actionLoading === "pause" ? "…" : "Pause"}
                    </Button>
                  )}
                  {canResume && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="border border-white/15 text-[12px] text-[#E8ECFF]"
                      disabled={!!actionLoading}
                      onClick={() => void runAction("resume", () => botsApi.resumeBot(botId))}
                    >
                      {actionLoading === "resume" ? "…" : "Resume"}
                    </Button>
                  )}
                  {canClose && (
                    <Button
                      size="sm"
                      variant="danger"
                      className="text-[12px]"
                      disabled={!!actionLoading}
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Close all open positions at market prices and stop this bot? Future scheduled runs will not execute."
                          )
                        )
                          return;
                        void runAction("close", () => botsApi.closeBot(botId));
                      }}
                    >
                      {actionLoading === "close" ? "…" : "Close bot"}
                    </Button>
                  )}
                  {canArchive && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-[12px] text-zinc-300"
                      disabled={!!actionLoading}
                      onClick={() => void runArchive()}
                    >
                      {actionLoading === "archive" ? "…" : "Archive"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Key metrics */}
          <div className={cn(dashboardCard, "p-4")}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E8ECFF]">Performance</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
              <div>
                <dt className="text-[10px] font-medium text-white/80">Current equity</dt>
                <dd className="mt-1 font-mono text-[15px] font-semibold text-white">${perf.current_equity.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-white/80">Realized PnL</dt>
                <dd className="mt-1 font-mono text-emerald-300">{fmtMoney(perf.realized_pnl)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-white/80">Unrealized PnL</dt>
                <dd className="mt-1 font-mono text-white">
                  {perf.unrealized_pnl != null ? fmtMoney(perf.unrealized_pnl) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-white/80">Total return</dt>
                <dd className="mt-1 font-mono text-white">{perf.total_return_pct.toFixed(2)}%</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-white/80">Win rate</dt>
                <dd className="mt-1 font-mono text-white" title="Winning closed trades / all closed">
                  {fmtPct(perf.accuracy_winning_trades_over_total_closed)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-white/80">Open trades</dt>
                <dd className="mt-1 font-mono text-white">{perf.open_trades_count}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-white/80">Closed trades</dt>
                <dd className="mt-1 font-mono text-white">{perf.closed_trades_count}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-white/80">Predictions</dt>
                <dd className="mt-1 font-mono text-white">{perf.predictions_count}</dd>
              </div>
            </dl>
          </div>

          {/* Equity chart */}
          <div className={cn(dashboardCard, "p-3 md:p-4")}>
            <SingleBotEquityChart points={data.equity_history} title="Equity history" />
          </div>

          {/* Config — before position tables */}
          <div className={cn(dashboardCard, "p-4")}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E8ECFF]">Configuration</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[12px] md:grid-cols-3">
              <div>
                <dt className="text-white/80">Bot ID</dt>
                <dd className="break-all font-mono text-[11px] text-white">{bot.id}</dd>
              </div>
              <div>
                <dt className="text-white/80">Model file</dt>
                <dd className="font-mono text-white">{bot.model_filename ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-white/80">Starting capital</dt>
                <dd className="font-mono text-white">${cfg.starting_capital.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-white/80">Take profit %</dt>
                <dd className="font-mono text-white">
                  {cfg.tp_pct != null ? `${cfg.tp_pct}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-white/80">Stop loss %</dt>
                <dd className="font-mono text-white">
                  {cfg.sl_pct != null ? `${cfg.sl_pct}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-white/80">Horizon (days)</dt>
                <dd className="font-mono text-white">{cfg.horizon_days}</dd>
              </div>
              <div>
                <dt className="text-white/80">Position size %</dt>
                <dd className="font-mono text-white">{cfg.position_size_pct}</dd>
              </div>
              <div>
                <dt className="text-white/80">Commission %</dt>
                <dd className="font-mono text-white">{cfg.commission_pct}</dd>
              </div>
              <div>
                <dt className="text-white/80">Slippage %</dt>
                <dd className="font-mono text-white">{cfg.slippage_pct}</dd>
              </div>
              <div>
                <dt className="text-white/80">Runtime days</dt>
                <dd className="font-mono text-white">{summary.runtime_days ?? bot.runtime_days ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-white/80">Run time</dt>
                <dd className="font-mono text-white">{cfg.run_time ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-white/80">Timezone</dt>
                <dd className="font-mono text-white">{cfg.timezone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-white/80">Confidence threshold</dt>
                <dd className="font-mono text-white">{bot.confidence_threshold}</dd>
              </div>
            </dl>
          </div>

          {/* Open trades */}
          <div className={cn(dashboardCard, "p-4")}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E8ECFF]">Open trades</h2>
            {data.open_trades_detail.length === 0 ? (
              <p className="mt-2 text-[13px] text-white/80">None</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[11px]">
                  <thead>
                    <tr className="text-white/80">
                      <th className="pb-2 pr-2">Status</th>
                      <th className="pb-2 pr-2">Entry</th>
                      <th className="pb-2 pr-2">Entry px</th>
                      <th className="pb-2 pr-2">TP</th>
                      <th className="pb-2 pr-2">SL</th>
                      <th className="pb-2 pr-2">Current</th>
                      <th className="pb-2 pr-2">Days held</th>
                      <th className="pb-2 text-right">Unreal PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.open_trades_detail.map((t) => (
                      <tr key={t.id} className="border-t border-white/[0.06] font-mono text-white">
                        <td className="py-2 pr-2 capitalize text-white/80">Open</td>
                        <td className="py-2 pr-2">{t.entry_date}</td>
                        <td className="py-2 pr-2">{t.entry_price.toFixed(4)}</td>
                        <td className="py-2 pr-2">{t.tp_price?.toFixed(4) ?? "—"}</td>
                        <td className="py-2 pr-2">{t.sl_price?.toFixed(4) ?? "—"}</td>
                        <td className="py-2 pr-2">{t.current_price?.toFixed(4) ?? "—"}</td>
                        <td className="py-2 pr-2">{t.days_held}</td>
                        <td
                          className={cn(
                            "py-2 text-right",
                            t.unrealized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                          )}
                        >
                          {fmtMoney(t.unrealized_pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Closed trades */}
          <div className={cn(dashboardCard, "p-4")}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E8ECFF]">Closed trades</h2>
            <div className="mt-2 max-h-[360px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[880px] text-left text-[11px]">
                <thead className="sticky top-0 bg-[#0a0a0a]">
                  <tr className="text-white/80">
                    <th className="pb-2 pr-2">Entry</th>
                    <th className="pb-2 pr-2">Exit</th>
                    <th className="pb-2 pr-2">Entry px</th>
                    <th className="pb-2 pr-2">Exit px</th>
                    <th className="pb-2 pr-2">Days held</th>
                    <th className="pb-2 pr-2">Reason</th>
                    <th className="pb-2 pr-2">Status</th>
                    <th className="pb-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.closed_trades.map((t: BotTrade) => {
                    const dh = calendarDaysHeld(String(t.entry_date), t.exit_date);
                    return (
                      <tr key={t.id} className="border-t border-white/[0.05] font-mono text-white">
                        <td className="py-1.5 pr-2">{String(t.entry_date)}</td>
                        <td className="py-1.5 pr-2">{t.exit_date != null ? String(t.exit_date) : "—"}</td>
                        <td className="py-1.5 pr-2">{t.entry_price.toFixed(4)}</td>
                        <td className="py-1.5 pr-2">{t.exit_price != null ? t.exit_price.toFixed(4) : "—"}</td>
                        <td className="py-1.5 pr-2">{dh != null ? dh : "—"}</td>
                        <td className="py-1.5 pr-2 text-white/80">{t.exit_reason ?? "—"}</td>
                        <td className="py-1.5 pr-2">{t.status}</td>
                        <td
                          className={cn(
                            "py-1.5 text-right",
                            (t.pnl_amount ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                          )}
                        >
                          {t.pnl_amount != null ? fmtMoney(t.pnl_amount) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Predictions */}
          <div className={cn(dashboardCard, "p-4")}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E8ECFF]">Prediction history</h2>
            <div className="mt-2 max-h-[280px] overflow-auto">
              <table className="w-full min-w-[720px] text-left text-[11px]">
                <thead className="sticky top-0 bg-[#0a0a0a]">
                  <tr className="text-white/80">
                    <th className="pb-2 pr-2">Time</th>
                    <th className="pb-2 pr-2">Chart date</th>
                    <th className="pb-2 pr-2">Signal</th>
                    <th className="pb-2 pr-2">Conf</th>
                    <th className="pb-2 pr-2">Run status</th>
                    <th className="pb-2 pr-2">Trade opened</th>
                    <th className="pb-2 pr-2">Linked trade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.prediction_history.map((r) => (
                    <tr key={r.run_id} className="border-t border-white/[0.05] text-white">
                      <td className="py-1.5 pr-2 font-mono text-[10px] text-white/80">
                        {new Date(r.run_at).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-[10px]">
                        {r.chart_date ? new Date(r.chart_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-1.5 pr-2">{formatSignal(r.label)}</td>
                      <td className="py-1.5 pr-2">{formatConfidence(r.confidence ?? null)}</td>
                      <td className="py-1.5 pr-2">{r.status}</td>
                      <td className="py-1.5 pr-2">{r.trade_opened ? "Yes" : "No"}</td>
                      <td className="py-1.5 font-mono text-[10px] text-[#9CA3AF]">{r.linked_trade_id ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
