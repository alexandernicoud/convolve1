import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { botsApi, dashboardApi, type Bot, type DashboardTradeRow } from "@/lib/api";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import { formatSignedUsd } from "@/components/dashboard/dashboardMetrics";
import { cn } from "@/lib/utils";

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function DashboardTradeHistory() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [trades, setTrades] = useState<DashboardTradeRow[]>([]);
  const [filterBotId, setFilterBotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, t] = await Promise.all([botsApi.listBots(), dashboardApi.listTrades()]);
      setBots(list);
      setTrades(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trades");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!filterBotId) return trades;
    return trades.filter((x) => x.bot_id === filterBotId);
  }, [trades, filterBotId]);

  const byBot = useMemo(() => {
    const m = new Map<string, DashboardTradeRow[]>();
    for (const t of trades) {
      const arr = m.get(t.bot_id) ?? [];
      arr.push(t);
      m.set(t.bot_id, arr);
    }
    return m;
  }, [trades]);

  const tradeTable = (rows: DashboardTradeRow[], showBot: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-white/[0.08] text-[9px] font-semibold uppercase tracking-wide text-white/45">
            {showBot ? <th className="pb-2 pr-3">Bot</th> : null}
            <th className="pb-2 pr-3">Symbol</th>
            <th className="pb-2 pr-3">Entry</th>
            <th className="pb-2 pr-3">Exit</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2 text-right">PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-white/[0.05] font-digits text-white/90">
              {showBot ? (
                <td className="py-2 pr-3">
                  <Link
                    to={`/dashboard/bots/${t.bot_id}`}
                    className="text-white/85 underline-offset-2 hover:text-white hover:underline"
                  >
                    {t.bot_name}
                  </Link>
                </td>
              ) : null}
              <td className="py-2 pr-3">{t.symbol}</td>
              <td className="py-2 pr-3 text-white/75">{fmtDate(t.entry_date)}</td>
              <td className="py-2 pr-3 text-white/75">{t.exit_date ? fmtDate(t.exit_date) : "—"}</td>
              <td className="py-2 pr-3 uppercase text-white/55">{t.status}</td>
              <td className="py-2 text-right tabular-nums">
                {t.pnl_amount != null ? formatSignedUsd(t.pnl_amount) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="Trade history" className="mb-2" />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 md:p-4">
        <Link
          to="/dashboard"
          className="inline-flex w-fit shrink-0 items-center gap-2 text-[12px] font-medium text-white/70 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to overview
        </Link>

        {error ? <p className="text-sm text-rose-300/90">{error}</p> : null}

        <div className={cn("flex flex-wrap items-center gap-2", dashboardCard, "p-3")}>
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">Filter by bot</label>
          <select
            value={filterBotId}
            onChange={(e) => setFilterBotId(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/60 px-2 py-1.5 text-[12px] text-white"
          >
            <option value="">All bots</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className={cn("min-h-0 flex-1", dashboardCard, "p-4")}>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">All trades</p>
          {loading ? (
            <p className="text-sm text-white/55">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-white/55">No trades yet.</p>
          ) : (
            tradeTable(filtered, true)
          )}
        </div>

        {!filterBotId && !loading && trades.length > 0 ? (
          <div className={cn("space-y-6", dashboardCard, "p-4")}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Per bot</p>
            {Array.from(byBot.entries()).map(([bid, rows]) => {
              const name = rows[0]?.bot_name ?? bid;
              return (
                <div key={bid}>
                  <p className="mb-2 font-digits text-[13px] font-semibold text-white/85">
                    <Link to={`/dashboard/bots/${bid}`} className="hover:underline">
                      {name}
                    </Link>
                    <span className="ml-2 text-[11px] font-normal text-white/45">({rows.length})</span>
                  </p>
                  {tradeTable(rows, false)}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
