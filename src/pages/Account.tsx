import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Zap,
  Sparkles,
  Wallet,
  Bot as BotIcon,
  Boxes,
  Database,
  ListTree,
  LineChart,
  Microscope,
  Pencil,
  Check,
  TrendingUp,
  Trophy,
  Flame,
} from "lucide-react";
import {
  formatReturnPct,
  formatSignedUsd,
  formatUsdPlain,
  capitalOverview,
} from "@/components/dashboard/dashboardMetrics";
import {
  reviewApi,
  dashboardApi,
  botsApi,
  type ReviewSummary,
  type DashboardOverview,
  type Bot,
} from "@/lib/api";
import { useCreditsStore, RUN_COST } from "@/state/creditsStore";
import { getPaperWalletUsd } from "@/lib/portfolioWallet";
import { useAuth } from "@/context/AuthContext";
import {
  getProfileName,
  setProfileName,
  getProfileEmail,
  initialsFromName,
} from "@/lib/userProfile";

const TOOL_LABELS: Record<string, string> = {
  "training-chart-generator": "Chart generator",
  trainer: "Trainer",
  analysis: "Analysis",
  testdata: "Test data",
  backtester: "Backtester",
  "labeling-optimizer": "Labeling optimizer",
  bot: "Bot deploy",
};

export default function Account() {
  const credits = useCreditsStore((s) => s.credits);
  const xp = useCreditsStore((s) => s.xp);
  const runsPaid = useCreditsStore((s) => s.runsPaid);
  const refills = useCreditsStore((s) => s.refills);
  const history = useCreditsStore((s) => s.history);

  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);

  const { user, signOut, emailConfirmed } = useAuth();
  const [name, setName] = useState(getProfileName());
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const email = user?.email || getProfileEmail();
  const wallet = getPaperWalletUsd(10000);

  useEffect(() => {
    let active = true;
    void reviewApi.getOverview().then((d) => active && setSummary(d.summary)).catch(() => {});
    void dashboardApi.getBundle().then((b) => active && setOverview(b.overview)).catch(() => {});
    void botsApi.listBots().then((b) => active && setBots(Array.isArray(b) ? b : [])).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const capital = useMemo(() => capitalOverview(overview ?? undefined, bots), [overview, bots]);
  const botProfit = capital.realizedPnl + capital.openMtm;

  const favoriteTool = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const h of history) {
      if (h.type === "spend" && h.tool) counts[h.tool] = (counts[h.tool] ?? 0) + 1;
    }
    let best: { tool: string; n: number } | null = null;
    for (const [tool, n] of Object.entries(counts)) {
      if (!best || n > best.n) best = { tool, n };
    }
    return best;
  }, [history]);

  const level = Math.floor(xp / 100) + 1;
  const xpIntoLevel = xp % 100;

  const commitName = () => {
    const v = nameDraft.trim() || "Trader";
    setProfileName(v);
    setName(v);
    setEditingName(false);
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-1 py-4 pb-16 sm:px-2">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Account</p>
              <h1 className="mt-1 text-[clamp(1.2rem,2vw,1.5rem)] font-light tracking-tight text-white">
                Profile &amp; activity
              </h1>
              <p className="mt-1 text-sm text-white/50">
                Credits, XP, portfolio, and everything you've built in this workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/credits"
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10"
              >
                <Zap className="h-4 w-4 text-amber-300" />
                Manage credits
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10"
              >
                Sign out
              </button>
            </div>
          </div>

          {/* Profile header */}
          <div className="mt-5 flex flex-wrap items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-white/20 to-white/[0.06] text-2xl font-semibold text-white">
              {initialsFromName(name)}
            </div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="w-56 rounded-lg border border-white/25 bg-[#0a0a0a] px-3 py-1.5 text-xl text-white focus:outline-none"
                  />
                  <button type="button" onClick={commitName} className="rounded-lg bg-white p-2 text-black">
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-[clamp(1.5rem,3vw,2rem)] font-light tracking-tight text-white">{name}</h1>
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(name);
                      setEditingName(true);
                    }}
                    className="rounded-md p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
                    title="Edit name"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}
              <p className="mt-0.5 text-sm text-white/50">{email}</p>
              {!emailConfirmed ? (
                <p className="mt-1 text-[11px] text-amber-200/80">Email not verified yet — check your inbox.</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-amber-100">
                  <Trophy className="h-3.5 w-3.5" /> Level {level}
                </span>
                <span className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-white/70">
                  {xpIntoLevel}/100 XP to next level
                </span>
              </div>
            </div>
          </div>

          {/* Headline metrics */}
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HeadlineCard
              icon={<Zap className="h-4 w-4 text-amber-300" />}
              label="Credits"
              value={credits.toLocaleString()}
              sub={`${Math.floor(credits / RUN_COST)} runs left`}
              tone={credits < RUN_COST ? "warn" : "default"}
              cta={{ to: "/credits", label: "Refill" }}
            />
            <HeadlineCard
              icon={<Sparkles className="h-4 w-4 text-white/70" />}
              label="XP"
              value={xp.toLocaleString()}
              sub={`${runsPaid} runs · ${refills} refills`}
            />
            <HeadlineCard
              icon={<Wallet className="h-4 w-4 text-white/70" />}
              label="Portfolio equity"
              value={formatUsdPlain(capital.equity || wallet)}
              sub={`Start ${formatUsdPlain(capital.startCapital || wallet)}`}
            />
            <HeadlineCard
              icon={<TrendingUp className="h-4 w-4 text-white/70" />}
              label="Bot profit"
              value={formatSignedUsd(botProfit)}
              sub={`${overview?.active_bots ?? 0} active · ${formatReturnPct(capital.realizedReturnPct)}`}
            />
          </div>

          {/* Activity stats */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">Your activity</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <MiniStat icon={<ListTree className="h-4 w-4" />} label="Runs" value={summary?.totalRuns} />
              <MiniStat icon={<Boxes className="h-4 w-4" />} label="Models" value={summary?.totalModels} />
              <MiniStat icon={<Database className="h-4 w-4" />} label="Datasets" value={summary?.totalDatasets} />
              <MiniStat icon={<LineChart className="h-4 w-4" />} label="Backtests" value={summary?.totalBacktests} />
              <MiniStat icon={<Microscope className="h-4 w-4" />} label="Analyses" value={summary?.totalAnalyses} />
              <MiniStat icon={<BotIcon className="h-4 w-4" />} label="Bots" value={summary?.totalBots} />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Fun facts */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Flame className="h-4 w-4 text-amber-300" /> Stats &amp; facts
              </h2>
              <ul className="space-y-2.5 text-sm text-white/70">
                <li className="flex items-start gap-2">
                  <span className="text-white/35">•</span>
                  You've spent <span className="mx-1 font-semibold text-white">{xp.toLocaleString()} XP</span> across{" "}
                  <span className="mx-1 font-semibold text-white">{runsPaid}</span> paid run{runsPaid === 1 ? "" : "s"}.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-white/35">•</span>
                  {favoriteTool ? (
                    <>
                      Your most-used tool is{" "}
                      <span className="mx-1 font-semibold text-white">
                        {TOOL_LABELS[favoriteTool.tool] ?? favoriteTool.tool}
                      </span>
                      ({favoriteTool.n} run{favoriteTool.n === 1 ? "" : "s"}).
                    </>
                  ) : (
                    <>No runs yet — start one to build your history.</>
                  )}
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-white/35">•</span>
                  You've refilled credits{" "}
                  <span className="mx-1 font-semibold text-white">{refills}</span> time{refills === 1 ? "" : "s"}.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-white/35">•</span>
                  {summary
                    ? summary.runningRuns > 0
                      ? `${summary.runningRuns} run${summary.runningRuns === 1 ? "" : "s"} in progress right now.`
                      : `${summary.completedRuns} completed run${summary.completedRuns === 1 ? "" : "s"} on record.`
                    : "Loading run history…"}
                </li>
              </ul>
            </div>

            {/* Recent credit activity */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Recent credit activity</h2>
                <Link to="/credits" className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline">
                  View all →
                </Link>
              </div>
              {history.length === 0 ? (
                <p className="text-sm text-white/40">No activity yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {history.slice(0, 6).map((h) => (
                    <div key={h.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-white/75">
                        {h.type === "refill"
                          ? "Refill"
                          : h.type === "grant"
                            ? "Starter grant"
                            : TOOL_LABELS[h.tool ?? ""] ?? "Run"}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className={`font-mono ${h.delta >= 0 ? "text-emerald-300" : "text-white/55"}`}>
                          {h.delta >= 0 ? "+" : ""}
                          {h.delta}
                        </span>
                        <span className="font-mono text-xs text-white/40">→ {h.balanceAfter}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              Open dashboard
            </Link>
            <Link
              to="/tools/run-log"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10"
            >
              Review library
            </Link>
          </div>
      </div>
    </div>
  );
}

function HeadlineCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
  cta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn";
  cta?: { to: string; label: string };
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        tone === "warn" ? "border-red-400/30 bg-red-400/[0.06]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/45">
          {icon}
          {label}
        </div>
        {cta ? (
          <Link to={cta.to} className="text-[11px] font-medium text-white/70 underline-offset-2 hover:text-white hover:underline">
            {cta.label}
          </Link>
        ) : null}
      </div>
      <p className={`mt-2 font-digits text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-red-200" : "text-white"}`}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-white/45">{sub}</p> : null}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value?: number | null }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
        <span className="text-white/55">{icon}</span>
        {label}
      </div>
      <p className="mt-1 font-digits text-2xl font-semibold tabular-nums text-white">
        {value != null ? value.toLocaleString() : "—"}
      </p>
    </div>
  );
}
