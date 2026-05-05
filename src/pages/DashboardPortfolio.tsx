import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  botsApi,
  dashboardApi,
  type Bot,
  type DashboardBundle,
} from "@/lib/api";
import { getPaperWalletUsd, setPaperWalletUsd } from "@/lib/portfolioWallet";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { RunningProfitChart } from "@/components/dashboard/RunningProfitChart";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import {
  capitalOverview,
  formatReturnPct,
  formatSignedUsd,
  formatUsdPlain,
} from "@/components/dashboard/dashboardMetrics";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

function metricCell(label: string, value: string) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="font-digits text-[14px] font-medium tabular-nums text-white/90">{value}</p>
    </div>
  );
}

export default function DashboardPortfolio() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [walletInput, setWalletInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, dash] = await Promise.all([botsApi.listBots(), dashboardApi.getBundle()]);
      setBots(list);
      setBundle(dash);
      const fb = Math.max((dash.overview.total_starting_capital ?? 0) * 2, 100_000);
      const w = getPaperWalletUsd(fb);
      setWalletInput(String(Math.round(w)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overview = bundle?.overview;
  const cap = capitalOverview(overview, bots);

  const allocated = useMemo(() => {
    return bots
      .filter((b) => (b.lifecycle_state ?? "active") !== "archived")
      .reduce((s, b) => s + (b.starting_capital ?? 0), 0);
  }, [bots]);

  const wallet = useMemo(() => {
    const fb = Math.max((overview?.total_starting_capital ?? 0) * 2, 100_000);
    return getPaperWalletUsd(fb);
  }, [overview?.total_starting_capital]);

  const available = Math.max(0, wallet - allocated);

  const applyWallet = () => {
    const n = parseFloat(walletInput.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < allocated) {
      setWalletError(`Balance must be at least allocated capital (${formatUsdPlain(allocated)}).`);
      return;
    }
    setWalletError(null);
    setPaperWalletUsd(n);
    void load();
  };

  const runResetHistory = async () => {
    setResetting(true);
    setError(null);
    try {
      await dashboardApi.resetTradingHistory();
      setResetDialogOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const label1Line =
    cap.label1Precision != null && cap.label1Sample > 0
      ? `${(cap.label1Precision * 100).toFixed(1)}% (n=${cap.label1Sample})`
      : "—";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="My Portfolio" className="mb-2" />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 md:p-4">
        <Link
          to="/dashboard"
          className="inline-flex w-fit shrink-0 items-center gap-2 text-[12px] font-medium text-white/70 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to overview
        </Link>

        {error ? (
          <p className="text-sm text-rose-300/90" role="alert">
            {error}
          </p>
        ) : null}
        {walletError ? (
          <p className="text-sm text-rose-300/90" role="alert">
            {walletError}
          </p>
        ) : null}

        <div className={cn("grid shrink-0 gap-3 md:grid-cols-2", dashboardCard, "p-4")}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Account & Performance</p>
            <p className="mt-2 font-digits text-[clamp(1.5rem,3vw,2rem)] font-semibold tabular-nums text-white">
              {loading ? "…" : formatUsdPlain(cap.equity)}
            </p>
            <p className="mt-1 text-[10px] text-white/40">Equity</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {metricCell("Start capital", loading ? "…" : formatUsdPlain(cap.startCapital))}
            {metricCell("Realized PnL", loading ? "…" : formatSignedUsd(cap.realizedPnl))}
            {metricCell("Return", loading ? "…" : formatReturnPct(cap.realizedReturnPct))}
            {metricCell("Open MTM", loading ? "…" : formatSignedUsd(cap.openMtm))}
            {metricCell("Open trades", loading ? "…" : String(cap.openTrades))}
            {metricCell("Closed trades", loading ? "…" : String(cap.closedTrades))}
            {metricCell("Label 1 precision", loading ? "…" : label1Line)}
          </div>
        </div>

        <div className={cn("grid shrink-0 gap-4 md:grid-cols-2", dashboardCard, "p-4")}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Available capital</p>
            <p className="mt-1 font-digits text-xl font-semibold tabular-nums text-emerald-200/95">
              {loading ? "…" : formatUsdPlain(available)}
            </p>
            <p className="mt-1 text-[10px] text-white/40">Not allocated to bots</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Allocated capital</p>
            <p className="mt-1 font-digits text-xl font-semibold tabular-nums text-white/90">
              {loading ? "…" : formatUsdPlain(allocated)}
            </p>
            <p className="mt-1 text-[10px] text-white/40">Sum of bot starting capital (non-archived)</p>
          </div>
        </div>

        <div className={cn("shrink-0 space-y-3", dashboardCard, "p-4")}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Paper wallet</p>
          <div className="flex flex-wrap items-end gap-2">
            <input
              type="text"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              className="min-w-[140px] rounded-lg border border-white/15 bg-black/50 px-3 py-2 font-digits text-sm text-white"
              aria-label="Account balance USD"
            />
            <button
              type="button"
              onClick={applyWallet}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0a0a0a] hover:bg-white/90"
            >
              Update balance
            </button>
          </div>
          <p className="text-[10px] text-white/40">
            Deploy uses this pool: new bot starting capital cannot exceed available capital (
            {loading ? "…" : formatUsdPlain(available)}).
          </p>

          <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={resetting}
                className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
              >
                Reset trading history
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-white/10 bg-[#0a0a0a] text-white">
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all trading history?</AlertDialogTitle>
                <AlertDialogDescription className="text-white/60">
                  This permanently deletes runs, trades, and equity snapshots for all your bots. Bots are kept. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-white/15 bg-transparent text-white hover:bg-white/10">Cancel</AlertDialogCancel>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={() => void runResetHistory()}
                  className={cn(
                    "inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium",
                    "bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50",
                  )}
                >
                  {resetting ? "…" : "Yes, reset history"}
                </button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className={cn("min-h-[320px] flex-1", dashboardCard, "p-4")}>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Equity</p>
          <RunningProfitChart
            equityByBot={bundle?.equity_by_bot ?? []}
            baselineEquity={overview?.total_starting_capital ?? cap.startCapital}
            equityDisplay={loading ? "…" : formatUsdPlain(cap.equity)}
            returnDisplay={loading ? "…" : formatReturnPct(cap.realizedReturnPct)}
            realizedDisplay={loading ? "…" : formatSignedUsd(cap.realizedPnl)}
          />
        </div>
      </div>
    </div>
  );
}
