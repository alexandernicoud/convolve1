import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { botsApi, dashboardApi, internalModelsApi, reviewApi, Bot, InternalModel, ReviewRun } from "@/lib/api";
import { stageUpload } from "@/lib/directUpload";
import { getPaperWalletUsd } from "@/lib/portfolioWallet";
import { requestRunCredits, chargeRunCredits } from "@/state/creditsStore";
import { RunCostHint } from "@/components/RunCostHint";

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

const libraryKey = (m: InternalModel) => (m.kind === "trained" && m.training_run_id ? `run:${m.training_run_id}` : `model:${m.model_id}`);

function libraryLabel(m: InternalModel): string {
  if (m.display_name) return m.display_name;
  const meta = [m.symbols, m.timeframe, m.take_profit_fraction != null ? `TP ${(m.take_profit_fraction * 100).toFixed(1)}%` : null]
    .filter(Boolean)
    .join(" · ");
  const base = m.name || m.model_id;
  return meta ? `${meta} — ${base}` : base;
}

export default function Deploy() {
  const [searchParams] = useSearchParams();
  const wantedRun = searchParams.get("trainingRunId");
  const wantedModel = searchParams.get("modelId");
  const [modelSource, setModelSource] = useState<"library" | "upload">(wantedRun || wantedModel ? "library" : "upload");
  const [library, setLibrary] = useState<InternalModel[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>(wantedRun ? `run:${wantedRun}` : wantedModel ? `model:${wantedModel}` : "");
  const [backtests, setBacktests] = useState<ReviewRun[] | null>(null);
  const [backtestId, setBacktestId] = useState("");
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

  const libraryRequested = useRef(false);
  useEffect(() => {
    if (modelSource !== "library" || libraryRequested.current) return;
    libraryRequested.current = true;
    let cancelled = false;
    internalModelsApi.list().then(
      (res) => {
        if (cancelled) return;
        const usable = res.models.filter((m) => !m.archived);
        setLibrary(usable);
        setSelectedKey((k) => k || (usable.length ? libraryKey(usable[0]) : ""));
      },
      (e) => !cancelled && setLibraryError(e instanceof Error ? e.message : "Could not load the model library"),
    );
    reviewApi.getOverview().then(
      (o) => !cancelled && setBacktests(o.runs.filter((r) => r.tool === "backtester" && r.status === "succeeded")),
      () => !cancelled && setBacktests([]),
    );
    return () => {
      cancelled = true;
      libraryRequested.current = false;
    };
  }, [modelSource]);

  const selectedModel = useMemo(() => library?.find((m) => libraryKey(m) === selectedKey) ?? null, [library, selectedKey]);

  const modelBacktests = useMemo(() => {
    if (!selectedModel || !backtests) return [];
    return backtests.filter((r) =>
      selectedModel.kind === "trained"
        ? r.links?.trainer_run_id === selectedModel.training_run_id
        : r.links?.model_id === selectedModel.model_id,
    );
  }, [selectedModel, backtests]);

  useEffect(() => {
    if (backtestId && !modelBacktests.some((r) => r.id === backtestId)) setBacktestId("");
  }, [modelBacktests, backtestId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessBot(null);

    if (modelSource === "upload" && !modelFile) {
      setError("Please upload a .keras model file.");
      return;
    }
    if (modelSource === "library" && !selectedModel) {
      setError("Please select a model from the library.");
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

    if (!requestRunCredits("bot")) return;

    setIsSubmitting(true);
    try {
      if (modelSource === "library" && selectedModel) {
        if (selectedModel.kind === "trained" && selectedModel.training_run_id) {
          formData.append("source_training_run_id", selectedModel.training_run_id);
        } else {
          formData.append("source_model_id", selectedModel.model_id);
        }
        if (backtestId) formData.append("source_backtest_run_id", backtestId);
      } else if (modelFile) {
        const uploadId = await stageUpload("model", modelFile);
        if (uploadId) {
          formData.append("model_upload_id", uploadId);
        } else {
          formData.append("model_file", modelFile);
        }
      }
      const created = await botsApi.createBot(formData);
      chargeRunCredits("bot");
      setSuccessBot(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deploy failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden pb-4">
      <div className="mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden">
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

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-sm text-[#F5F5F5]/70">Model</label>
                  <div className="flex rounded-md border border-white/10 p-0.5" role="radiogroup" aria-label="Model source">
                    {(["library", "upload"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={modelSource === s}
                        onClick={() => setModelSource(s)}
                        className={`rounded px-3 py-1 text-xs transition ${modelSource === s ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
                      >
                        {s === "library" ? "From library" : "Upload .keras"}
                      </button>
                    ))}
                  </div>
                </div>

                {modelSource === "upload" ? (
                  <input
                    type="file"
                    accept=".keras"
                    onChange={(e) => setModelFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-[#F5F5F5]/70 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-[#F5F5F5] hover:file:bg-white/40"
                  />
                ) : libraryError ? (
                  <p className="text-xs text-[#f87171]">{libraryError}</p>
                ) : !library ? (
                  <p className="text-xs text-[#F5F5F5]/50">Loading model library…</p>
                ) : library.length === 0 ? (
                  <p className="text-xs text-[#F5F5F5]/50">
                    No models in your library yet. Train one in the{" "}
                    <Link to="/tools/trainer" className="underline underline-offset-2">trainer</Link> or switch to upload.
                  </p>
                ) : (
                  <>
                    <select
                      value={selectedKey}
                      onChange={(e) => setSelectedKey(e.target.value)}
                      aria-label="Library model"
                      className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {selectedKey && !selectedModel ? <option value={selectedKey}>Requested model not found in your library</option> : null}
                      {library.map((m) => (
                        <option key={libraryKey(m)} value={libraryKey(m)}>
                          {libraryLabel(m)} ({m.kind})
                        </option>
                      ))}
                    </select>
                    {selectedModel ? (
                      <div className="rounded-md border border-white/10 px-3 py-2 text-[11.5px] text-[#F5F5F5]/60 space-y-0.5">
                        <div>
                          {selectedModel.kind === "trained" ? "Trained model" : "Uploaded model"} · id{" "}
                          <span className="font-mono">{selectedModel.training_run_id || selectedModel.model_id}</span>
                        </div>
                        {selectedModel.symbols || selectedModel.timeframe ? (
                          <div>
                            Trained on {selectedModel.symbols || "?"} · {selectedModel.timeframe || "?"}
                            {selectedModel.metrics?.val_accuracy != null
                              ? ` · val acc ${(selectedModel.metrics.val_accuracy * 100).toFixed(1)}% (classification, not a trading result)`
                              : ""}
                          </div>
                        ) : null}
                        {selectedModel.image_dimension && selectedModel.image_dimension !== imgSize ? (
                          <div className="flex items-center gap-2 text-amber-200/80">
                            Trained on {selectedModel.image_dimension}px images; bot is set to {imgSize}px.
                            {[128, 224, 256, 512].includes(selectedModel.image_dimension) ? (
                              <button type="button" className="underline underline-offset-2" onClick={() => setImgSize(selectedModel.image_dimension!)}>
                                Use {selectedModel.image_dimension}px
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="text-[#F5F5F5]/40">The model file is copied into the bot; the library model is not modified. Provenance is recorded.</div>
                      </div>
                    ) : null}
                    <div>
                      <label className="block text-xs text-[#F5F5F5]/60 mb-1.5">Informed by backtest (optional)</label>
                      <select
                        value={backtestId}
                        onChange={(e) => setBacktestId(e.target.value)}
                        disabled={!modelBacktests.length}
                        aria-label="Source backtest"
                        className="w-full px-3 py-2.5 bg-secondary border border-border rounded-md text-foreground text-sm disabled:opacity-50"
                      >
                        <option value="">{backtests == null ? "Loading backtests…" : modelBacktests.length ? "None" : "No completed backtests of this model"}</option>
                        {modelBacktests.map((r) => {
                          const ret = r.backtest?.performance?.return_pct;
                          return (
                            <option key={r.id} value={r.id}>
                              {r.backtest?.symbol ?? "Backtest"} · {new Date(r.created_at * 1000).toLocaleDateString()}
                              {ret != null ? ` · net ${ret > 0 ? "+" : ""}${ret.toFixed(2)}%` : ""} · {r.id.slice(-6)}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </>
                )}
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

              <div className="space-y-1.5">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full px-6 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 disabled:opacity-60"
                >
                  {isSubmitting ? "Deploying..." : "Deploy Bot"}
                </button>
                <RunCostHint />
              </div>
            </form>
          </div>

          <div className="bg-[#0a0a0a]/60 backdrop-blur-sm border border-white/8 rounded-xl p-6">
            <h2 className="text-lg font-medium text-[#F5F5F5] mb-4">Deployment status</h2>
            {isSubmitting ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-[#F5F5F5]/70">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  Saving the bot and starting the first paper run…
                </div>
                <p className="text-xs text-[#F5F5F5]/50">
                  The first signal is generated on this machine. Open Overview after deploy to see it.
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
                    {successBot.name || successBot.symbol} is deployed. The first paper signal is running
                    locally — open Overview in a few seconds.
                  </p>
                </div>
                <p className="text-xs text-[#F5F5F5]/55">
                  Provenance:{" "}
                  {successBot.provenance === "library"
                    ? `library model ${successBot.source_training_run_id || successBot.source_model_id}${successBot.source_backtest_run_id ? `, informed by backtest ${successBot.source_backtest_run_id}` : ""}`
                    : successBot.provenance === "upload"
                      ? "direct file upload"
                      : "not recorded"}
                  .{" "}
                  <Link to="/tools/run-log?tab=lineage" className="underline underline-offset-2">View lineage</Link>
                </p>
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center w-full px-6 py-3 bg-[#0a0a0a] border border-white/10 rounded-lg text-sm text-[#F5F5F5] hover:border-white/20 transition"
                >
                  Go to My Dashboard
                </Link>
              </div>
            ) : (
              <div className="text-sm text-[#F5F5F5]/60">
                Upload a trained .keras model. This machine will run it on a schedule (paper trading only — no
                brokerage). After deploy, manage signals on Overview.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
