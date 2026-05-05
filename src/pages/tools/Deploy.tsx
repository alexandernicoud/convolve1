import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { botsApi, dashboardApi, Bot } from "@/lib/api";
import { getPaperWalletUsd } from "@/lib/portfolioWallet";

/** IANA zones for daily run scheduling (same as backend zoneinfo). */
const IANA_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Zurich",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

export default function Deploy() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("AAPL");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [imgSize, setImgSize] = useState(224);
  const [tpPct, setTpPct] = useState("2");
  const [slPct, setSlPct] = useState("2");
  const [runTime, setRunTime] = useState("22:00");
  const [timezone, setTimezone] = useState("America/New_York");
  const [startingCapital, setStartingCapital] = useState("10000");
  const [horizonDays, setHorizonDays] = useState("5");
  const [positionSizePct, setPositionSizePct] = useState("10");
  const [commissionPct, setCommissionPct] = useState("0.1");
  const [slippagePct, setSlippagePct] = useState("0.05");
  const [runtimeDays, setRuntimeDays] = useState("");
  const [runUntilPaused, setRunUntilPaused] = useState(true);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBot, setSuccessBot] = useState<Bot | null>(null);
  const [deployAvailable, setDeployAvailable] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, bundle] = await Promise.all([botsApi.listBots(), dashboardApi.getBundle()]);
        if (cancelled) return;
        const allocated = list
          .filter((b) => (b.lifecycle_state ?? "active") !== "archived")
          .reduce((s, b) => s + (b.starting_capital ?? 0), 0);
        const fb = Math.max((bundle.overview.total_starting_capital ?? 0) * 2, 100_000);
        const wallet = getPaperWalletUsd(fb);
        setDeployAvailable(Math.max(0, wallet - allocated));
      } catch {
        if (!cancelled) setDeployAvailable(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessBot(null);

    if (!modelFile) {
      setError("Please upload a .keras model file.");
      return;
    }

    const tp = parseFloat(tpPct.replace(",", "."));
    const sl = parseFloat(slPct.replace(",", "."));
    if (!Number.isFinite(tp) || tp <= 0) {
      setError("Take profit % must be a positive number.");
      return;
    }
    if (!Number.isFinite(sl) || sl <= 0) {
      setError("Stop loss % must be a positive number.");
      return;
    }

    if (!runTime || !runTime.trim()) {
      setError("Please set a daily run time.");
      return;
    }

    const capReq = parseFloat(String(startingCapital).replace(",", "."));
    if (deployAvailable != null && Number.isFinite(capReq) && capReq > deployAvailable + 1e-6) {
      setError(
        `Starting capital cannot exceed available capital ($${deployAvailable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Open My Portfolio to raise your paper wallet.`,
      );
      return;
    }

    const formData = new FormData();
    formData.append("model_file", modelFile);
    formData.append("symbol", symbol);
    formData.append("confidence_threshold", String(confidenceThreshold));
    formData.append("img_size", String(imgSize));
    formData.append("tp_pct", String(tp));
    formData.append("sl_pct", String(sl));
    formData.append("run_time", runTime.trim());
    formData.append("timezone", timezone);

    if (name.trim()) {
      formData.append("name", name.trim());
    }
    if (!runUntilPaused && runtimeDays) {
      formData.append("runtime_days", runtimeDays);
    }
    formData.append("starting_capital", startingCapital || "10000");
    formData.append("horizon_days", horizonDays || "5");
    formData.append("position_size_pct", positionSizePct || "10");
    formData.append("commission_pct", commissionPct || "0.1");
    formData.append("slippage_pct", slippagePct || "0.05");

    setIsSubmitting(true);
    try {
      const created = await botsApi.createBot(formData);
      setSuccessBot(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deploy failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden pb-4">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden">
        <p className="sr-only">Upload your Keras model and configure daily runs, take profit, and stop loss.</p>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden lg:grid-cols-2 lg:gap-6">
          <div className="tech-surface p-6 md:p-6">
            <h2 className="mb-6 flex items-center gap-2 text-[13px] font-medium tracking-tight text-white">
              <div className="h-2 w-2 rounded-full bg-white" />
              Bot configuration
            </h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm text-[#F5F5F5]/70 mb-2">Bot name (optional)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Momentum v3"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Symbol</label>
                  <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Image size</label>
                  <select
                    value={imgSize}
                    onChange={(e) => setImgSize(Number(e.target.value))}
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {[128, 224, 256, 512].map((size) => (
                      <option key={size} value={size}>
                        {size}x{size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#F5F5F5]/70 mb-2">
                  Confidence threshold ({confidenceThreshold.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0.4}
                  max={0.9}
                  step={0.01}
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="rounded-lg border bg-white/10 bg-white/5 p-4 space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C4B5FD]">
                  Risk and daily schedule
                </p>
                <p className="text-xs text-[#F5F5F5]/60">
                  Take profit and stop loss set how far price must move to exit trades. The daily run time is when the bot
                  evaluates signals (in the timezone you pick).
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#F5F5F5] mb-2">
                      Take profit % <span className="text-rose-300">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={tpPct}
                      onChange={(e) => setTpPct(e.target.value)}
                      className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#F5F5F5] mb-2">
                      Stop loss % <span className="text-rose-300">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={slPct}
                      onChange={(e) => setSlPct(e.target.value)}
                      className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="2"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-[#F5F5F5] mb-2">
                      Daily run time <span className="text-rose-300">*</span>
                    </label>
                    <input
                      type="time"
                      required
                      value={runTime}
                      onChange={(e) => setRunTime(e.target.value)}
                      className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="mt-1 text-[11px] text-[#F5F5F5]/45">24h clock, e.g. 22:00 for 10:00 PM</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#F5F5F5] mb-2">Timezone</label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {IANA_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#F5F5F5]/70 mb-2">Keras model (.keras)</label>
                <input
                  type="file"
                  accept=".keras"
                  onChange={(e) => setModelFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-[#F5F5F5]/70 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-[#F5F5F5] hover:file:bg-white/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Starting capital</label>
                  <input
                    type="number"
                    min="1"
                    step="100"
                    value={startingCapital}
                    onChange={(e) => setStartingCapital(e.target.value)}
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {deployAvailable != null ? (
                    <p className="mt-1.5 text-[11px] text-[#F5F5F5]/50">
                      Available (paper wallet minus allocated):{" "}
                      <span className="font-digits tabular-nums text-[#F5F5F5]/75">
                        ${deployAvailable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      .{" "}
                      <Link to="/dashboard/portfolio" className="font-medium text-white/80 underline-offset-2 hover:underline">
                        My Portfolio
                      </Link>
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Horizon (days)</label>
                  <input
                    type="number"
                    min="1"
                    value={horizonDays}
                    onChange={(e) => setHorizonDays(e.target.value)}
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Position size %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={positionSizePct}
                    onChange={(e) => setPositionSizePct(e.target.value)}
                    className="w-full px-3 py-2.5 bg-secondary border border-border rounded-md text-foreground text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Commission %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={commissionPct}
                    onChange={(e) => setCommissionPct(e.target.value)}
                    className="w-full px-3 py-2.5 bg-secondary border border-border rounded-md text-foreground text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Slippage %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={slippagePct}
                    onChange={(e) => setSlippagePct(e.target.value)}
                    className="w-full px-3 py-2.5 bg-secondary border border-border rounded-md text-foreground text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border border-white/10 rounded-lg p-4 bg-[#0a0a0a]/40">
                <div>
                  <p className="text-sm font-medium text-[#F5F5F5]">Run until paused</p>
                  <p className="text-xs text-[#F5F5F5]/50">Disable to set a fixed runtime</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRunUntilPaused(!runUntilPaused)}
                  className={`w-12 h-6 rounded-full border border-white/10 transition-colors ${
                    runUntilPaused ? "bg-white" : "bg-[#0a0a0a]"
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                      runUntilPaused ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {!runUntilPaused && (
                <div>
                  <label className="block text-sm text-[#F5F5F5]/70 mb-2">Runtime days</label>
                  <input
                    type="number"
                    min="1"
                    value={runtimeDays}
                    onChange={(e) => setRuntimeDays(e.target.value)}
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="30"
                  />
                </div>
              )}

              {error && (
                <div className="p-3 bg-[#f87171]/10 border border-[#f87171]/20 rounded-md text-sm text-[#f87171]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-6 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 disabled:opacity-60"
              >
                {isSubmitting ? "Deploying..." : "Deploy Bot"}
              </button>
            </form>
          </div>

          <div className="bg-[#0a0a0a]/60 backdrop-blur-sm border border-white/8 rounded-xl p-6">
            <h2 className="text-lg font-medium text-[#F5F5F5] mb-4">Deployment status</h2>
            {isSubmitting ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-[#F5F5F5]/70">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  Deploying model to the server...
                </div>
                <p className="text-xs text-[#F5F5F5]/50">
                  If this takes more than a few seconds, check the backend logs or API health.
                </p>
              </div>
            ) : error ? (
              <div className="space-y-3">
                <div className="p-4 border border-[#f87171]/30 bg-[#f87171]/10 rounded-lg">
                  <p className="text-sm text-[#f87171]">{error}</p>
                </div>
                <p className="text-xs text-[#F5F5F5]/50">
                  Ensure the API is reachable and `CORS_ORIGINS` includes this frontend.
                </p>
              </div>
            ) : successBot ? (
              <div className="space-y-4">
                <div className="p-4 border border-emerald-400/20 bg-emerald-400/10 rounded-lg">
                  <p className="text-sm text-emerald-200">
                    Bot deployed successfully. {successBot.name || successBot.symbol} is ready.
                  </p>
                </div>
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center w-full px-6 py-3 bg-[#0a0a0a] border border-white/10 rounded-lg text-sm text-[#F5F5F5] hover:border-white/20 transition"
                >
                  Go to My Dashboard
                </Link>
              </div>
            ) : (
              <div className="text-sm text-[#F5F5F5]/60">
                Submit the form to deploy your model. Set take profit, stop loss, and the daily run time before
                uploading.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
