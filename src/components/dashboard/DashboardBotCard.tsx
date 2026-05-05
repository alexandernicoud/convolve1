import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2, MoreVertical } from "lucide-react";
import { botsApi, type Bot, type DashboardEquitySeries } from "@/lib/api";
import { MiniSparkline } from "@/components/dashboard/MiniSparkline";
import { formatShortDateTime, sparklineFromEquityPoints } from "@/components/dashboard/dashboardMetrics";
import { botStatusBadgeClass } from "@/components/dashboard/botStatusStyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  bot: Bot;
  series: DashboardEquitySeries | undefined;
  onDashboardRefresh: () => Promise<void>;
};

export function DashboardBotCard({ bot, series, onDashboardRefresh }: Props) {
  const points = series?.points ?? [];
  const spark = points.length ? sparklineFromEquityPoints(points) : [];
  const lastPt = points.length ? points[points.length - 1] : null;
  const startCap = bot.starting_capital ?? 10000;
  const totalRetPct =
    lastPt && startCap > 0 ? ((lastPt.total_equity - startCap) / startCap) * 100 : null;

  const derived = bot.derived_status ?? "active";
  const ls = bot.lifecycle_state ?? "active";
  const nextRun = bot.next_scheduled_run_iso ?? null;

  const canPause = ls === "active";
  const canResume = ls === "paused";
  const canClose = ls !== "closed" && ls !== "archived";
  const canArchive = ls !== "archived";

  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await onDashboardRefresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 gap-0 overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.03] transition hover:border-white/25 hover:bg-white/[0.05]">
      <Link
        to={`/dashboard/bots/${bot.id}`}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-digits text-[11px] font-bold uppercase tracking-wide text-white/85">
              {bot.symbol}
            </span>
            <span className={botStatusBadgeClass(derived)}>{(derived ?? "active").toUpperCase()}</span>
          </div>
          <p className="truncate text-[13px] font-semibold text-white">{bot.name || bot.symbol}</p>
          {totalRetPct != null ? (
            <p className="mt-0.5 font-digits text-[10px] font-semibold tabular-nums text-white">
              {totalRetPct >= 0 ? "+" : ""}
              {totalRetPct.toFixed(2)}% vs start
            </p>
          ) : null}
          {nextRun ? (
            <p className="mt-0.5 font-digits text-[10px] text-white/70">
              Next {formatShortDateTime(nextRun)}
            </p>
          ) : null}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
      </Link>

      <div className="flex shrink-0 items-center gap-0.5 border-l border-white/[0.06] bg-black/15 py-1.5 pr-1 pl-1">
        <MiniSparkline
          data={
            spark.length >= 2
              ? spark
              : spark.length === 1
                ? [
                    { i: 0, v: spark[0].v },
                    { i: 1, v: spark[0].v },
                  ]
                : [{ i: 0, v: 0 }, { i: 1, v: 0.1 }]
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/75 transition hover:bg-white/10 hover:text-white"
              aria-label="Bot actions"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 border-white/10 bg-black text-white">
            {canPause && (
              <DropdownMenuItem
                disabled={!!busy}
                className="cursor-pointer focus:bg-white/10"
                onClick={(e) => {
                  e.preventDefault();
                  void run("pause", () => botsApi.pauseBot(bot.id));
                }}
              >
                Pause
              </DropdownMenuItem>
            )}
            {canResume && (
              <DropdownMenuItem
                disabled={!!busy}
                className="cursor-pointer focus:bg-white/10"
                onClick={(e) => {
                  e.preventDefault();
                  void run("resume", () => botsApi.resumeBot(bot.id));
                }}
              >
                Resume
              </DropdownMenuItem>
            )}
            {canClose && (
              <>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  disabled={!!busy}
                  className="cursor-pointer text-rose-300 focus:bg-rose-500/20 focus:text-rose-100"
                  onClick={(e) => {
                    e.preventDefault();
                    if (
                      !window.confirm(
                        "Close all open positions at market prices and stop this bot? Future scheduled runs will not execute."
                      )
                    ) {
                      return;
                    }
                    void run("close", () => botsApi.closeBot(bot.id));
                  }}
                >
                  Close bot
                </DropdownMenuItem>
              </>
            )}
            {canArchive && (
              <DropdownMenuItem
                disabled={!!busy}
                className="cursor-pointer text-zinc-300 focus:bg-white/10"
                onClick={(e) => {
                  e.preventDefault();
                  if (
                    !window.confirm(
                      "Archive this bot? It will disappear from the active dashboard overview. You can still access it by ID if needed."
                    )
                  ) {
                    return;
                  }
                  void run("archive", () => botsApi.archiveBot(bot.id));
                }}
              >
                Archive
              </DropdownMenuItem>
            )}
            {!canPause && !canResume && !canClose && !canArchive && (
              <DropdownMenuItem disabled className="text-white/50">
                No actions
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
