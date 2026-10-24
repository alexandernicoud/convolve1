import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { botsApi, dashboardApi, internalModelsApi, reviewApi, Bot, InternalModel, ReviewRun } from "@/lib/api";
import { stageUpload } from "@/lib/directUpload";
import { getPaperWalletUsd } from "@/lib/portfolioWallet";
import { requestRunCredits, chargeRunCredits } from "@/state/creditsStore";
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

const TIMEFRAMES = [
  { value: "1d", label: "Daily", bar: "daily bar" },
  { value: "1wk", label: "Weekly", bar: "weekly bar" },
  { value: "1mo", label: "Monthly", bar: "monthly bar" },
] as const;
type Timeframe = (typeof TIMEFRAMES)[number]["value"];
const isTimeframe = (v: unknown): v is Timeframe => TIMEFRAMES.some((t) => t.value === v);
const SPAN_UNITS = ["days", "weeks", "months", "years"];

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
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
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
  const [reviewing, setReviewing] = useState(false);
  const [deployAvailable, setDeployAvailable] = useState<number | null>(null);
  const reviewRef = useRef<HTMLElement>(null);

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

  // The bot should see the same chart the model was trained on: bar size, window, horizon and exits.
  useEffect(() => {
    if (!selectedModel) return;
    if (isTimeframe(selectedModel.timeframe)) setTimeframe(selectedModel.timeframe);
    if (selectedModel.horizon_bars && selectedModel.horizon_bars > 0) setHorizonDays(String(selectedModel.horizon_bars));
    if (selectedModel.take_profit_fraction && selectedModel.take_profit_fraction > 0)
      setTpPct(String(+(selectedModel.take_profit_fraction * 100).toFixed(2)));
    if (selectedModel.stop_loss_fraction && selectedModel.stop_loss_fraction > 0)
      setSlPct(String(+(selectedModel.stop_loss_fraction * 100).toFixed(2)));
    if (selectedModel.image_dimension && [128, 224, 256, 512].includes(selectedModel.image_dimension))
      setImgSize(selectedModel.image_dimension);
  }, [selectedModel]);

  const chartSpan = useMemo(() => {
    if (modelSource !== "library" || !selectedModel) return null;
    const unit = selectedModel.timespan_unit?.toLowerCase();
    const count = Number(selectedModel.timespan_count);
    return unit && SPAN_UNITS.includes(unit) && Number.isInteger(count) && count > 0 ? { unit, count } : null;
  }, [modelSource, selectedModel]);

  useEffect(() => {
    setReviewing(false);
  }, [
    modelSource, selectedKey, modelFile, backtestId, name, symbol, timeframe, confidenceThreshold, imgSize, tpPct, slPct,
    runTime, timezone, startingCapital, horizonDays, positionSizePct, commissionPct, slippagePct, runtimeDays, runUntilPaused,
  ]);

  const buildForm = (): FormData | string => {
    if (modelSource === "upload" && !modelFile) return "Please upload a .keras model file.";
    if (modelSource === "library" && !selectedModel) return "Please select a model from the library.";

    const tp = parseFloat(tpPct.replace(",", "."));
    const sl = parseFloat(slPct.replace(",", "."));
    if (!Number.isFinite(tp) || tp <= 0) return "Take profit % must be a positive number.";
    if (!Number.isFinite(sl) || sl <= 0 || sl >= 100) return "Stop loss % must be between 0 and 100.";
    const horizon = Number(horizonDays);
    if (!Number.isInteger(horizon) || horizon < 1) return "Horizon must be a whole number of bars (at least 1).";
    if (!runTime || !runTime.trim()) return "Please set a daily run time.";

    const capReq = parseFloat(String(startingCapital).replace(",", "."));
    if (deployAvailable != null && Number.isFinite(capReq) && capReq > deployAvailable + 1e-6) {
      return `Starting capital cannot exceed available capital ($${deployAvailable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Open My Portfolio to raise your paper wallet.`;
    }

    const formData = new FormData();
    formData.append("symbol", symbol);
    formData.append("confidence_threshold", String(confidenceThreshold));
    formData.append("img_size", String(imgSize));
    formData.append("timeframe", timeframe);
    if (chartSpan) {
      formData.append("chart_span_unit", chartSpan.unit);
      formData.append("chart_span_count", String(chartSpan.count));
    }
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
    return formData;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessBot(null);
    const built = buildForm();
    if (typeof built === "string") {
      setError(built);
      return;
    }
    setReviewing(true);
  };

  const confirmDeploy = async () => {
    setError(null);
    const formData = buildForm();
    if (typeof formData === "string") {
      setError(formData);
      setReviewing(false);
      return;
    }
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
      setReviewing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deploy failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const bar = TIMEFRAMES.find((t) => t.value === timeframe) ?? TIMEFRAMES[0];
  const spanText = chartSpan ? `${chartSpan.count} ${chartSpan.unit}` : "6 months (default)";
  const checks = compatibilityChecks(modelSource === "library" ? selectedModel : null, {
    symbol,
    timeframe,
    imgSize,
    horizon: horizonDays,
    tp: tpPct,
    sl: slPct,
  });
  const warnings = checks.filter((c) => c.state === "warn");
  const unrecorded = checks.length > 0 && checks.every((c) => c.state === "unknown");
  const modelName = modelSource === "library" ? (selectedModel ? libraryLabel(selectedModel) : null) : modelFile?.name ?? null;

  useEffect(() => {
    if (reviewing) reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reviewing]);

  const summary: [string, string][] = [
    ["Model", modelName ?? "—"],
    ["Asset", `${symbol} · ${bar.label} bars · chart window ${spanText} · ${imgSize}px`],
    ["Signal", `BUY when P(up) ≥ ${confidenceThreshold.toFixed(2)}`],
    ["Schedule", `Every day at ${runTime} ${timezone.replace(/_/g, " ")}, on the latest completed ${bar.bar}`],
    ["Entry", `Next bar's open + ${slippagePct || 0}% slippage`],
    ["Exits", `TP +${tpPct}% · SL −${slPct}% (stop checked first) · or close of bar ${horizonDays}`],
    ["Size", `${positionSizePct}% of cash per trade · one position at a time · long only`],
    ["Costs", `${commissionPct}% commission per side`],
    ["Capital", `$${Number(startingCapital || 0).toLocaleString()} simulated`],
    ["Runtime", runUntilPaused || !runtimeDays ? "Until paused or stopped" : `${runtimeDays} days`],
  ];

  const field =
    "h-10 w-full rounded-md border border-white/[0.12] bg-white/[0.02] px-3 text-[13.5px] text-white transition-colors placeholder:text-white/30 hover:border-white/20 focus:border-white/40 focus:outline-none [&>option]:bg-[#0a0a0a]";
  const label = "mb-1.5 block text-[12px] text-white/50";
  const req = <span className="text-white/35">*</span>;

  return (
    <div className="pb-2">
      <p className="sr-only">Deploy a trained model on a daily schedule, with take profit, stop loss and simulated execution.</p>

      <form onSubmit={handleSubmit} className="tech-surface mx-auto w-full max-w-5xl px-5 md:px-10">
        <Section n="01" title="Model" note="A trained network from your library, or a .keras file." data-tour="deploy-model" data-help="deploy-model">
          <div className="flex items-center gap-1 self-start rounded-md border border-white/10 p-0.5" role="radiogroup" aria-label="Model source">
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

          {modelSource === "upload" ? (
            <input
              type="file"
              accept=".keras"
              onChange={(e) => setModelFile(e.target.files?.[0] || null)}
              className="w-full max-w-xl text-sm text-white/70 file:mr-4 file:rounded-md file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-white/20"
            />
          ) : libraryError ? (
            <p className="text-xs text-[#f87171]">{libraryError}</p>
          ) : !library ? (
            <p className="text-xs text-white/50">Loading model library…</p>
          ) : library.length === 0 ? (
            <p className="text-xs text-white/50">
              No models in your library yet. Train one in the{" "}
              <Link to="/tools/trainer" className="underline underline-offset-2">trainer</Link> or switch to upload.
            </p>
          ) : (
            <div className="grid max-w-2xl gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div>
                <label className={label}>Model</label>
                <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)} aria-label="Library model" className={field}>
                  {selectedKey && !selectedModel ? <option value={selectedKey}>Requested model not found in your library</option> : null}
                  {library.map((m) => (
                    <option key={libraryKey(m)} value={libraryKey(m)}>
                      {libraryLabel(m)} ({m.kind})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Informed by backtest</label>
                <select
                  value={backtestId}
                  onChange={(e) => setBacktestId(e.target.value)}
                  disabled={!modelBacktests.length}
                  aria-label="Source backtest"
                  className={`${field} disabled:opacity-50`}
                >
                  <option value="">{backtests == null ? "Loading…" : modelBacktests.length ? "None" : "No completed backtests"}</option>
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
            </div>
          )}

          {modelSource === "library" && selectedModel ? (
            <dl className="grid max-w-2xl grid-cols-2 gap-x-6 gap-y-3 border-l border-white/10 pl-4 text-[12.5px] sm:grid-cols-4">
              <Fact k="Source" v={selectedModel.kind === "trained" ? "Trained in Convolve" : "Uploaded file"} />
              <Fact k="Id" v={selectedModel.training_run_id || selectedModel.model_id} mono />
              {selectedModel.metrics?.val_accuracy != null ? (
                <Fact k="Validation accuracy" v={`${(selectedModel.metrics.val_accuracy * 100).toFixed(1)}%`} />
              ) : null}
              {selectedModel.metrics?.epochs_trained != null ? <Fact k="Epochs trained" v={String(selectedModel.metrics.epochs_trained)} /> : null}
            </dl>
          ) : null}

          <div className="max-w-sm">
            <label className={label}>Deployment name (optional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Momentum v3" />
          </div>
        </Section>

        <Section n="02" title="Market" note="The chart the model reads at every run." data-tour="deploy-market">
          <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            <div data-help="deploy-symbol">
              <label className={label}>Asset</label>
              <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} aria-label="Symbol" className={`${field} font-mono`} />
            </div>
            <div data-help="deploy-timeframe">
              <label className={label}>Bar size</label>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} aria-label="Bar size" className={field}>
                {TIMEFRAMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Image size</label>
              <select value={imgSize} onChange={(e) => setImgSize(Number(e.target.value))} aria-label="Image size" className={field}>
                {[128, 224, 256, 512].map((size) => (
                  <option key={size} value={size}>
                    {size} × {size}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[12px] text-white/40">
            Chart window {spanText} · input {imgSize} × {imgSize} × 3
          </p>
          {warnings.length ? (
            <ul className="max-w-2xl space-y-1 text-[12.5px] text-amber-200/85">
              {warnings.map((c) => (
                <li key={c.label}>
                  {c.detail}
                  {c.label === "Image size" && selectedModel?.image_dimension && [128, 224, 256, 512].includes(selectedModel.image_dimension) ? (
                    <button type="button" className="ml-2 underline underline-offset-2" onClick={() => setImgSize(selectedModel.image_dimension!)}>
                      Use {selectedModel.image_dimension}px
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : unrecorded ? (
            <p className="text-[12px] text-white/40">This model has no recorded training settings, so they cannot be checked against these.</p>
          ) : null}
        </Section>

        <Section n="03" title="Signal" note="How the model's output becomes a decision.">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-baseline justify-between">
              <label className="text-[12px] text-white/50">Confidence threshold</label>
              <span className="font-mono text-[15px] text-white">{confidenceThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={0.9}
              step={0.01}
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
              aria-label="Confidence threshold"
              className="w-full accent-white"
            />
            <p className="mt-2 text-[12px] text-white/40">
              BUY when P(up) ≥ {confidenceThreshold.toFixed(2)}; otherwise no new position.
            </p>
          </div>
        </Section>

        <Section n="04" title="Schedule" note="Runs on the server, independent of this browser.">
          <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Daily run time {req}</label>
              <input type="time" required value={runTime} onChange={(e) => setRunTime(e.target.value)} className={`${field} font-mono`} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Timezone</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-label="Timezone" className={field}>
                {IANA_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex max-w-2xl flex-wrap items-end gap-x-8 gap-y-4">
            <label className="flex cursor-pointer items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={runUntilPaused}
                aria-label="Run until paused"
                onClick={() => setRunUntilPaused(!runUntilPaused)}
                className={`h-5 w-9 shrink-0 rounded-full border border-white/15 transition-colors ${runUntilPaused ? "bg-white" : "bg-transparent"}`}
              >
                <span
                  className={`block h-3.5 w-3.5 rounded-full transition-transform ${runUntilPaused ? "translate-x-[18px] bg-[#0a0a0a]" : "translate-x-[2px] bg-white/70"}`}
                />
              </button>
              <span className="text-[13px] text-white/75">Run until paused</span>
            </label>
            {!runUntilPaused ? (
              <div className="w-40">
                <label className={label}>Runtime days</label>
                <input type="number" min="1" value={runtimeDays} onChange={(e) => setRuntimeDays(e.target.value)} className={field} placeholder="30" />
              </div>
            ) : null}
          </div>
          <p className="text-[12px] text-white/40">
            Each run reads the latest completed {bar.bar}. Days without a new bar, such as weekends and holidays, record nothing.
          </p>
        </Section>

        <Section n="05" title="Strategy" note="Exits, sizing and the simulated-execution assumptions.">
          <div className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Take profit % {req}</label>
              <input type="number" required min="0.01" step="0.01" value={tpPct} onChange={(e) => setTpPct(e.target.value)} className={field} placeholder="2" />
            </div>
            <div>
              <label className={label}>Stop loss % {req}</label>
              <input type="number" required min="0.01" step="0.01" value={slPct} onChange={(e) => setSlPct(e.target.value)} className={field} placeholder="2" />
            </div>
            <div data-help="deploy-horizon">
              <label className={label}>Horizon (bars)</label>
              <input type="number" min="1" value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Position size %</label>
              <input type="number" step="0.1" value={positionSizePct} onChange={(e) => setPositionSizePct(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Commission %</label>
              <input type="number" step="0.01" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Slippage %</label>
              <input type="number" step="0.01" value={slippagePct} onChange={(e) => setSlippagePct(e.target.value)} className={field} />
            </div>
          </div>
          <div className="max-w-xs" data-help="deploy-capital">
            <label className={label}>Starting capital ($)</label>
            <input type="number" min="1" step="any" value={startingCapital} onChange={(e) => setStartingCapital(e.target.value)} className={field} />
            {deployAvailable != null ? (
              <p className="mt-1.5 text-[11.5px] text-white/40">
                Available:{" "}
                <span className="font-digits tabular-nums text-white/70">
                  ${deployAvailable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>{" "}
                ·{" "}
                <Link to="/dashboard/portfolio" className="text-white/70 underline-offset-2 hover:underline">
                  My Portfolio
                </Link>
              </p>
            ) : null}
          </div>
        </Section>

        <Section n="06" title="Review & deploy" note="Check the configuration, then deploy." sectionRef={reviewRef}>
          {successBot ? (
            <div className="max-w-2xl space-y-4">
              <p className="text-[14px] leading-relaxed text-white/85">
                <span className="mr-2 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-emerald-300" />
                {successBot.name || successBot.symbol} is deployed. Its first evaluation of the latest completed bar runs within a few minutes,
                then it follows its schedule.
                {successBot.next_scheduled_run_iso ? ` Next run: ${new Date(successBot.next_scheduled_run_iso).toLocaleString()}.` : ""}
              </p>
              <p className="text-[12px] text-white/45">
                Provenance:{" "}
                {successBot.provenance === "library"
                  ? `library model ${successBot.source_training_run_id || successBot.source_model_id}${successBot.source_backtest_run_id ? `, informed by backtest ${successBot.source_backtest_run_id}` : ""}`
                  : successBot.provenance === "upload"
                    ? "direct file upload"
                    : "not recorded"}
                .{" "}
                <Link to="/tools/run-log?tab=lineage" className="underline underline-offset-2">View lineage</Link>
              </p>
            </div>
          ) : (
            <dl className="grid max-w-2xl grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12.5px]">
              {summary.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-white/40">{k}</dt>
                  <dd className={reviewing ? "text-white/90" : "text-white/60"}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {error ? <p className="max-w-2xl rounded-md border border-[#f87171]/25 bg-[#f87171]/10 px-3 py-2 text-[13px] text-[#f87171]">{error}</p> : null}
        </Section>

        <div
          className="sticky bottom-0 z-20 -mx-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/[0.08] bg-[#0a0a0a]/95 px-5 py-4 backdrop-blur md:-mx-10 md:px-10"
          data-tour="deploy-run"
        >
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-white/40">
            Execution is simulated: no orders reach a broker, and simulated results do not predict real returns.{" "}
            <Link to="/risk-disclosure" className="underline underline-offset-2 hover:text-white/70">
              Risk disclosure
            </Link>
          </p>
          {successBot ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSuccessBot(null)}
                className="rounded-lg border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:border-white/30"
              >
                Deploy another
              </button>
              <Link to={`/dashboard/bots/${successBot.id}`} className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-[#0a0a0a]">
                Monitor deployment
              </Link>
            </div>
          ) : reviewing ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReviewing(false)}
                className="rounded-lg border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:border-white/30"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void confirmDeploy()}
                disabled={isSubmitting}
                className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-[#0a0a0a] disabled:opacity-60"
              >
                {isSubmitting ? "Deploying…" : "Confirm and deploy"}
              </button>
            </div>
          ) : (
            <button
              type="submit"
              data-help="deploy-run"
              disabled={isSubmitting}
              className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-[#0a0a0a] disabled:opacity-60"
            >
              Review deployment
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({
  n,
  title,
  note,
  sectionRef,
  children,
  ...rest
}: {
  n: string;
  title: string;
  note: string;
  sectionRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <section
      ref={sectionRef}
      className="grid scroll-mt-4 gap-5 border-t border-white/[0.07] py-8 first:border-t-0 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10"
      {...rest}
    >
      <header>
        <p className="font-mono text-[11px] tracking-[0.14em] text-white/35">{n}</p>
        <h2 className="mt-1.5 text-[15px] font-medium tracking-tight text-white">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">{note}</p>
      </header>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

function Fact({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-white/40">{k}</dt>
      <dd className={`mt-0.5 truncate text-white/80 ${mono ? "font-mono text-[11.5px]" : ""}`} title={v}>
        {v}
      </dd>
    </div>
  );
}

type Check = { label: string; state: "ok" | "warn" | "unknown"; detail: string };

/** Compares the deployment settings with what the library model recorded at training time. */
function compatibilityChecks(
  m: InternalModel | null,
  s: { symbol: string; timeframe: string; imgSize: number; horizon: string; tp: string; sl: string },
): Check[] {
  if (!m) return [];
  const pct = (f: number) => +(f * 100).toFixed(2);
  const num = (v: string) => parseFloat(v.replace(",", "."));
  const symbols = (m.symbols ?? "").toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const tf = TIMEFRAMES.find((t) => t.value === m.timeframe)?.label ?? m.timeframe;
  const missing = (label: string): Check => ({ label, state: "unknown", detail: "Not recorded for this model" });
  return [
    symbols.length
      ? symbols.includes(s.symbol)
        ? { label: "Asset", state: "ok", detail: `Trained on ${s.symbol}` }
        : { label: "Asset", state: "warn", detail: `Trained on ${m.symbols}; deploying on ${s.symbol}` }
      : missing("Asset"),
    m.timeframe
      ? m.timeframe === s.timeframe
        ? { label: "Bar size", state: "ok", detail: `${tf}, as trained` }
        : { label: "Bar size", state: "warn", detail: `Trained on ${tf} bars` }
      : missing("Bar size"),
    m.image_dimension
      ? m.image_dimension === s.imgSize
        ? { label: "Image size", state: "ok", detail: `${s.imgSize}px, as trained` }
        : { label: "Image size", state: "warn", detail: `Trained on ${m.image_dimension}px; set to ${s.imgSize}px` }
      : missing("Image size"),
    m.horizon_bars
      ? String(m.horizon_bars) === s.horizon.trim()
        ? { label: "Horizon", state: "ok", detail: `${m.horizon_bars} bars, as labelled` }
        : { label: "Horizon", state: "warn", detail: `Labels used ${m.horizon_bars} bars; set to ${s.horizon}` }
      : missing("Horizon"),
    m.take_profit_fraction && m.stop_loss_fraction
      ? pct(m.take_profit_fraction) === num(s.tp) && pct(m.stop_loss_fraction) === num(s.sl)
        ? { label: "TP / SL", state: "ok", detail: `+${s.tp}% / −${s.sl}%, as labelled` }
        : { label: "TP / SL", state: "warn", detail: `Labels used +${pct(m.take_profit_fraction)}% / −${pct(m.stop_loss_fraction)}%` }
      : missing("TP / SL"),
  ];
}
