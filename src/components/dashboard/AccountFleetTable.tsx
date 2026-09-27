import { Link } from "react-router-dom";
import type { Bot, DashboardEquitySeries } from "@/lib/api";
import { botStatusBadgeClass } from "@/components/dashboard/botStatusStyles";
import {
  formatConfidence,
  formatReturnPct,
  formatSignal,
  formatShortDateTime,
  formatUsdPlain,
} from "@/components/dashboard/dashboardMetrics";
import { demoLinkClass } from "@/components/dashboard/demoPortfolioPalette";
import { cn } from "@/lib/utils";

type Props = {
  bots: Bot[];
  equityByBot: DashboardEquitySeries[];
  loading?: boolean;
};

export function AccountFleetTable({ bots, equityByBot, loading }: Props) {
  const rows = bots.filter((b) => (b.lifecycle_state ?? "active") !== "archived");

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white">Fleet</p>
          <p className="mt-0.5 text-[10px] text-white/40">
            Every bot on this account. Open a row for that bot’s own dashboard.
          </p>
        </div>
        <Link to="/dashboard/bots" className={cn("text-[12px] font-semibold", demoLinkClass)}>
          Manage bots →
        </Link>
      </div>
      {loading ? (
        <p className="py-4 text-sm text-white/50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-white/55">
          No bots yet.{" "}
          <Link to="/tools/deploy" className={demoLinkClass}>
            Deploy one
          </Link>{" "}
          to populate the account.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.08] text-[9px] uppercase tracking-[0.12em] text-white/40">
                <th className="py-1.5 pr-2 font-medium">Bot</th>
                <th className="py-1.5 pr-2 font-medium">Status</th>
                <th className="py-1.5 pr-2 font-medium">Signal</th>
                <th className="py-1.5 pr-2 font-medium">Equity</th>
                <th className="py-1.5 pr-2 font-medium">Vs start</th>
                <th className="py-1.5 font-medium">Last run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bot) => {
                const series = equityByBot.find((s) => s.bot_id === bot.id);
                const last = series?.points?.length ? series.points[series.points.length - 1] : null;
                const start = bot.starting_capital ?? 10000;
                const equity = last?.total_equity ?? start;
                const vsStart = start > 0 ? ((equity - start) / start) * 100 : 0;
                const sig = formatSignal(bot.last_signal || bot.latest_run?.signal || bot.latest_run?.label);
                const conf = formatConfidence(bot.last_confidence ?? bot.latest_run?.confidence);
                const lastAt = bot.latest_run?.run_finished_at || bot.latest_run?.run_at;
                return (
                  <tr key={bot.id} className="border-b border-white/[0.05] last:border-0">
                    <td className="py-1.5 pr-2">
                      <Link to={`/dashboard/bots/${bot.id}`} className="group block min-w-0">
                        <span className="font-digits text-[11px] font-bold uppercase text-white/80">
                          {bot.symbol}
                        </span>
                        <span className="ml-1.5 text-[12px] font-medium text-white group-hover:underline">
                          {bot.name || bot.symbol}
                        </span>
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className={botStatusBadgeClass(bot.derived_status)}>{bot.derived_status ?? "—"}</span>
                    </td>
                    <td className="py-1.5 pr-2 font-digits text-[11px] tabular-nums text-white/85">
                      {sig} {conf}
                    </td>
                    <td className="py-1.5 pr-2 font-digits text-[12px] tabular-nums text-white">
                      {formatUsdPlain(equity)}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-2 font-digits text-[12px] tabular-nums",
                        vsStart >= 0 ? "text-white/85" : "text-white/45"
                      )}
                    >
                      {formatReturnPct(vsStart)}
                    </td>
                    <td className="py-1.5 font-digits text-[11px] text-white/55">
                      {lastAt ? formatShortDateTime(lastAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
