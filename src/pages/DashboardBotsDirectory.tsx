import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { botsApi, dashboardApi, type Bot, type DashboardEquitySeries } from "@/lib/api";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { DashboardBotCard } from "@/components/dashboard/DashboardBotCard";
import { dashboardCard } from "@/components/dashboard/dashboardCard";

export default function DashboardBotsDirectory() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [seriesByBot, setSeriesByBot] = useState<DashboardEquitySeries[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, bundle] = await Promise.all([botsApi.listBots(), dashboardApi.getBundle()]);
      setBots(list);
      setSeriesByBot(bundle.equity_by_bot ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="All bots" className="mb-2" />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 md:p-4">
        <Link
          to="/dashboard"
          className="inline-flex w-fit shrink-0 items-center gap-2 text-[12px] font-medium text-white/70 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to overview
        </Link>

        <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl ${dashboardCard} p-3 md:p-4`}>
          {loading ? (
            <p className="text-sm text-white/60">Loading…</p>
          ) : bots.length === 0 ? (
            <p className="text-sm text-white/80">No bots yet. Deploy from the toolbar.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {bots.map((bot) => {
                const series = seriesByBot.find((s) => s.bot_id === bot.id);
                return (
                  <li key={bot.id}>
                    <DashboardBotCard bot={bot} series={series} onDashboardRefresh={load} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
