import { useState } from "react";
import { Link } from "react-router-dom";
import { Zap, ArrowLeft, Check, Sparkles, TrendingUp } from "lucide-react";
import {
  useCreditsStore,
  REFILL_AMOUNT,
  RUN_COST,
} from "@/state/creditsStore";

function formatWhen(ts: number) {
  return new Date(ts).toLocaleString();
}

export default function Credits() {
  const credits = useCreditsStore((s) => s.credits);
  const xp = useCreditsStore((s) => s.xp);
  const runsPaid = useCreditsStore((s) => s.runsPaid);
  const refills = useCreditsStore((s) => s.refills);
  const history = useCreditsStore((s) => s.history);
  const refill = useCreditsStore((s) => s.refill);

  const [justRefilled, setJustRefilled] = useState<number | null>(null);

  const runsLeft = Math.floor(credits / RUN_COST);

  const handleRefill = () => {
    const balance = refill(REFILL_AMOUNT);
    setJustRefilled(balance);
    window.setTimeout(() => setJustRefilled(null), 2600);
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-sm text-white/55 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <div className="mt-6 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Credit balance</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-digits text-5xl font-bold tabular-nums text-white">{credits.toLocaleString()}</span>
              <span className="text-sm text-white/50">credits</span>
            </div>
            <p className="mt-2 text-sm text-white/55">
              Enough for <span className="font-semibold text-white">{runsLeft}</span> more run{runsLeft === 1 ? "" : "s"} ·{" "}
              {RUN_COST} credits per run
            </p>
          </div>
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/30 bg-amber-300/10">
            <Zap className="h-7 w-7 text-amber-300" />
          </span>
        </div>

        <button
          type="button"
          onClick={handleRefill}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 text-base font-semibold text-[#0a0a0a] transition hover:bg-white/90 sm:w-auto"
        >
          <Zap className="h-5 w-5" />
          Refill +{REFILL_AMOUNT.toLocaleString()} credits
        </button>

        {justRefilled != null ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
            <Check className="h-4 w-4" />
            Refilled — balance is now {justRefilled.toLocaleString()} credits.
          </div>
        ) : (
          <p className="mt-4 text-xs text-white/40">
            No paywall — this is a simulated wallet. Refills are instant and free.
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Sparkles className="h-4 w-4 text-white/60" />} label="XP earned" value={xp.toLocaleString()} />
        <StatCard icon={<TrendingUp className="h-4 w-4 text-white/60" />} label="Runs paid" value={runsPaid.toLocaleString()} />
        <StatCard icon={<Zap className="h-4 w-4 text-white/60" />} label="Refills" value={refills.toLocaleString()} />
        <StatCard icon={<Zap className="h-4 w-4 text-white/60" />} label="Cost / run" value={`${RUN_COST}`} />
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">Recent credit activity</h2>
        {history.length === 0 ? (
          <p className="text-sm text-white/40">No activity yet. Start a run to spend credits.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {history.slice(0, 12).map((h) => (
              <div key={h.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      h.delta >= 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/70"
                    }`}
                  >
                    {h.delta >= 0 ? "+" : "−"}
                  </span>
                  <span className="text-white/75">
                    {h.type === "refill" ? "Refill" : h.type === "grant" ? "Starter grant" : `Run · ${h.tool ?? "tool"}`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono ${h.delta >= 0 ? "text-emerald-300" : "text-white/60"}`}>
                    {h.delta >= 0 ? "+" : ""}
                    {h.delta}
                  </span>
                  <span className="hidden text-xs text-white/35 sm:inline">{formatWhen(h.ts)}</span>
                  <span className="font-mono text-xs text-white/45">→ {h.balanceAfter}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/45">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
