import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";

/** Replaces signal/confidence preview — placeholder until community features ship. */
export function CommunityRankingCard() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Link
        to="/dashboard/community-ranking"
        className="group block w-fit text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/75"
      >
        Community ranking
      </Link>
      <div className="flex min-h-[200px] flex-1 flex-col justify-center rounded-md border border-white/[0.08] bg-black/40 px-4 py-6 text-center">
        <Trophy className="mx-auto mb-3 h-8 w-8 text-white/25" aria-hidden />
        <p className="font-digits text-lg font-semibold tabular-nums text-white/70">Top 12%</p>
        <p className="mt-1 text-[11px] text-white/40">Rank updates when live</p>
        <p className="mt-4 text-[10px] text-white/35">Tap to learn more</p>
      </div>
    </div>
  );
}
