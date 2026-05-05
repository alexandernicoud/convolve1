import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";

const ROWS: { name: string; pct: number }[] = [
  { name: "Mira Okonkwo", pct: 24.82 },
  { name: "Theo Vasquez", pct: 21.47 },
  { name: "Priya Shah", pct: 19.03 },
  { name: "Elliot Brennan", pct: 16.91 },
  { name: "Chen Wei", pct: 14.55 },
  { name: "Sofia Lindström", pct: 12.08 },
  { name: "James Porter", pct: 9.64 },
  { name: "Amara Mensah", pct: 7.21 },
];

/** Demo-only: populated leaderboard with invented traders and returns. */
export function CommunityRankingDemo() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Link
        to="/dashboard/community-ranking"
        className="group block w-fit text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/75"
      >
        Community ranking
      </Link>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-white/[0.08] bg-black/40">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <Trophy className="h-3.5 w-3.5 text-amber-400/80" aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">Demo leaderboard</span>
        </div>
        <ul className="min-h-0 flex-1 space-y-0 overflow-y-auto">
          {ROWS.map((r, i) => (
            <li
              key={r.name}
              className="flex items-center justify-between gap-2 border-b border-white/[0.05] px-3 py-2 text-[12px] last:border-0"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-digits w-5 shrink-0 text-[11px] text-white/35">{i + 1}</span>
                <span className="min-w-0 truncate font-medium text-white/90">{r.name}</span>
              </span>
              <span className="shrink-0 font-digits text-[12px] font-semibold tabular-nums text-emerald-300/95">
                +{r.pct.toFixed(2)}%
              </span>
            </li>
          ))}
        </ul>
        <p className="shrink-0 border-t border-white/[0.06] px-3 py-2 text-[10px] leading-snug text-white/35">
          Illustrative returns — not live. Your rank updates when you connect live bots.
        </p>
      </div>
    </div>
  );
}
