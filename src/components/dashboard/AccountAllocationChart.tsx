import type { Bot, DashboardEquitySeries } from "@/lib/api";
import { formatUsdPlain } from "@/components/dashboard/dashboardMetrics";
import { FLEET_LINE_COLORS } from "@/components/dashboard/fleetPalette";

type Slice = {
  id: string;
  label: string;
  equity: number;
  color: string;
};

type Props = {
  bots: Bot[];
  equityByBot: DashboardEquitySeries[];
};

export function AccountAllocationChart({ bots, equityByBot }: Props) {
  const slices: Slice[] = bots
    .filter((b) => (b.lifecycle_state ?? "active") !== "archived")
    .map((bot, i) => {
      const series = equityByBot.find((s) => s.bot_id === bot.id);
      const last = series?.points?.length ? series.points[series.points.length - 1] : null;
      return {
        id: bot.id,
        label: bot.symbol,
        equity: last?.total_equity ?? bot.starting_capital ?? 0,
        color: FLEET_LINE_COLORS[i % FLEET_LINE_COLORS.length],
      };
    })
    .sort((a, b) => b.equity - a.equity);

  const total = slices.reduce((s, x) => s + x.equity, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
        Capital allocation
      </p>
      <p className="mt-0.5 shrink-0 text-[10px] text-white/40">Share of account equity by bot.</p>
      {slices.length === 0 || total <= 0 ? (
        <p className="mt-4 text-sm text-white/45">No allocated capital yet.</p>
      ) : (
        <>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full border border-white/[0.1] bg-white/[0.04]">
            {slices.map((s) => (
              <div
                key={s.id}
                title={`${s.label} ${formatUsdPlain(s.equity)}`}
                style={{ width: `${(s.equity / total) * 100}%`, backgroundColor: s.color }}
              />
            ))}
          </div>
          <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {slices.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="truncate font-digits font-semibold text-white/85">{s.label}</span>
                </span>
                <span className="shrink-0 font-digits tabular-nums text-white/70">
                  {((s.equity / total) * 100).toFixed(1)}% · {formatUsdPlain(s.equity)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
