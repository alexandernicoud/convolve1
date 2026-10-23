import { useState, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { AlertTriangle, Play, ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ToolLayout from "@/components/ToolLayout";
import GeneratorTimeline from "@/components/generator/GeneratorTimeline";
import FieldTip from "@/components/generator/FieldTip";
import StepSection from "@/components/generator/StepSection";
import SymbolBasket from "@/components/generator/SymbolBasket";
import { TIMESPAN_PRESETS } from "@/components/generator/timespanPresets";
import { trainingChartGeneratorApi, ApiError, type ChartPreviewResult } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { requestRunCredits, chargeRunCredits } from "@/state/creditsStore";
import { RunCostHint } from "@/components/RunCostHint";
import {
  calendarDaysBetween,
  computeEndOffsetFromReferenceEnd,
  estimateChartsPerLabelFromRange,
  estimateMinTrainingPhaseDaysForCharts,
  horizonToApproxDays,
  isoDateString,
  parseIsoDate,
  startOfLocalDay,
  timespanToApproxDays,
} from "@/lib/generatorDates";

interface GeneratorConfig {
  symbols: string;
  chartsPerLabel: number; // x: charts per symbol per label
  useCandles: boolean; // use_candles: yes/no for candlestick charts
  timeframe: '1d' | '1wk' | '1mo'; // t: timeframe
  timespanUnit: string; // u: unit of timespan (e.g. 'months')
  timespanCount: number; // o: how many units for the timespan
  horizonBars: number; // w: future horizon in bars
  takeProfitFraction: number; // f: take profit as fraction
  stopLossFraction: number; // s: stop loss as fraction
  imageDimension: number; // img_dim: image dimensions (square)
  endOffset: number; // i1: last chart ends n time frame units ago
  balanceMode: "match_minority" | "keep_all"; // how to handle natural label imbalance
}

function defaultYesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDateString(d);
}

function defaultFiveYearsAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return isoDateString(d);
}

const defaultConfig: GeneratorConfig = {
  symbols: "",
  chartsPerLabel: 1000,
  useCandles: true,
  timeframe: '1d',
  timespanUnit: 'months',
  timespanCount: 6,
  horizonBars: 7,
  takeProfitFraction: 0.02,
  stopLossFraction: 0.01,
  imageDimension: 224,
  endOffset: 1,
  balanceMode: "match_minority",
};

export default function Generator() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState<GeneratorConfig>(defaultConfig);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<any>(null);

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [preview, setPreview] = useState<ChartPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  /** Either you choose chart count, or you choose a training window (we estimate chart count from the span). */
  const [volumeMode, setVolumeMode] = useState<"by_charts" | "by_period">("by_charts");
  const [referenceEndIso, setReferenceEndIso] = useState(defaultYesterdayIso);
  const [trainingStartIso, setTrainingStartIso] = useState(defaultFiveYearsAgoIso);
  const [useRawEndOffset, setUseRawEndOffset] = useState(false);

  useEffect(() => {
    void useRunsStore.getState().mergeRunsFromBackendList(200);
  }, []);

  useEffect(() => {
    setConfig((c) => ({ ...c, symbols: selectedSymbols.join(",") }));
  }, [selectedSymbols]);

  useEffect(() => {
    if (useRawEndOffset) return;
    const ref = parseIsoDate(referenceEndIso);
    if (!ref) return;
    const eo = computeEndOffsetFromReferenceEnd(ref, config.timeframe);
    setConfig((c) => (c.endOffset === eo ? c : { ...c, endOffset: eo }));
  }, [referenceEndIso, config.timeframe, useRawEndOffset]);

  /** Timeline-derived charts/label while in training-window mode (invalid range → null). */
  const windowChartsEstimate = useMemo(() => {
    if (volumeMode !== "by_period") return null;
    const a = parseIsoDate(trainingStartIso);
    const b = parseIsoDate(referenceEndIso);
    if (!a || !b || a >= b) return null;
    return estimateChartsPerLabelFromRange(a, b, config.timeframe);
  }, [volumeMode, trainingStartIso, referenceEndIso, config.timeframe]);

  const minTrainingPhaseDays = useMemo(
    () => estimateMinTrainingPhaseDaysForCharts(config.chartsPerLabel, config.timeframe),
    [config.chartsPerLabel, config.timeframe],
  );

  const trainingWindowCalendarDays = useMemo(() => {
    if (volumeMode !== "by_period") return null;
    const a = parseIsoDate(trainingStartIso);
    const b = parseIsoDate(referenceEndIso);
    if (!a || !b || a >= b) return null;
    return calendarDaysBetween(a, b);
  }, [volumeMode, trainingStartIso, referenceEndIso]);

  /** Whenever the window or timeframe changes, align charts with the estimate; user can still edit the number until the next change. */
  useEffect(() => {
    if (windowChartsEstimate == null) return;
    setConfig((c) =>
      c.chartsPerLabel === windowChartsEstimate ? c : { ...c, chartsPerLabel: windowChartsEstimate },
    );
  }, [windowChartsEstimate]);

  const todayIsoMax = useMemo(() => isoDateString(startOfLocalDay(new Date())), []);

  const addSymbol = useCallback((sym: string) => {
    setSelectedSymbols((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
  }, []);

  const removeSymbol = useCallback((sym: string) => {
    setSelectedSymbols((prev) => prev.filter((x) => x !== sym));
  }, []);

  // Validation
  const validateConfig = (): string | null => {
    if (!selectedSymbols.length) return "Add at least one stock (e.g. AAPL)";
    if (config.chartsPerLabel < 1) return "Charts per label must be at least 1";
    if (config.timespanCount < 1) return "Timespan count must be at least 1";
    if (config.horizonBars < 1) return "Horizon bars must be at least 1";
    if (config.takeProfitFraction <= 0 || config.takeProfitFraction > 1) return "Take profit must be between 0 and 100%";
    if (config.stopLossFraction <= 0 || config.stopLossFraction > 1) return "Stop loss must be between 0 and 100%";
    if (config.imageDimension < 64 || config.imageDimension > 1024) return "Image dimension must be between 64 and 1024";
    if (config.endOffset < 0) return "End offset must be non-negative";
    if (volumeMode === "by_period") {
      const a = parseIsoDate(trainingStartIso);
      const b = parseIsoDate(referenceEndIso);
      if (a && b && a >= b) return "Training start must be strictly before dataset end on the timeline";
    }
    return null;
  };

  useEffect(() => {
    const syms = searchParams.get("symbols")?.trim();
    if (syms) setSelectedSymbols(syms.toUpperCase().split(",").map((x) => x.trim()).filter(Boolean));
    const tf = searchParams.get("tf");
    const months = Number(searchParams.get("months"));
    const charts = Number(searchParams.get("charts"));
    setConfig((c) => ({
      ...c,
      ...(tf === "1d" || tf === "1wk" || tf === "1mo" ? { timeframe: tf } : {}),
      ...(Number.isFinite(months) && months >= 1 ? { timespanUnit: "months", timespanCount: Math.round(months) } : {}),
      ...(Number.isFinite(charts) && charts >= 1 ? { chartsPerLabel: Math.round(charts) } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = searchParams.get("runId")?.trim();
    if (!q) return;
    navigate(`/tools/generator/runs/${encodeURIComponent(q)}`, { replace: true });
  }, [searchParams, navigate]);

  const handleGenerate = async () => {
    const validationError = validateConfig();
    if (validationError) {
      setError(validationError);
      setErrorDetails(null);
      return;
    }

    if (!requestRunCredits("training-chart-generator")) return;

    setError(null);
    setErrorDetails(null);
    setStarting(true);

    try {
      const symRaw = config.symbols as unknown;
      const symbols =
        typeof symRaw === "string"
          ? symRaw.trim()
          : Array.isArray(symRaw)
            ? (symRaw as string[]).join(",").trim()
            : String(symRaw ?? "").trim();
      const payload = {
        ...config,
        symbols,
        volumeMode,
        referenceEndIso,
        trainingStartIso,
      };
      const response = await trainingChartGeneratorApi.run(payload);
      const newRunId = response.run_id;
      chargeRunCredits("training-chart-generator");

      useRunsStore.getState().registerRun({
        id: newRunId,
        tool: "training-chart-generator",
        status: "running",
        progress: 0.01,
        stage: "starting",
        message: "Initializing chart generator...",
        route: `/tools/generator/runs/${newRunId}`,
      });

      navigate(`/tools/generator/runs/${encodeURIComponent(newRunId)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const isValidation = err.status === 422;
        setError(err.message);
        setErrorDetails({
          type: isValidation ? "validation_error" : "api_error",
          message: err.message,
          status: err.status,
          details: err.message,
        });
      } else {
        setError(err instanceof Error ? err.message : "Failed to start generation");
        setErrorDetails({
          type: "network_error",
          message: "Failed to communicate with backend",
          details: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setStarting(false);
    }
  };

  useLayoutEffect(() => {
    const u = config.timespanUnit.toLowerCase();
    const hit = TIMESPAN_PRESETS.some((p) => p.unit === u && p.count === config.timespanCount);
    if (hit) return;
    setConfig((c) => ({ ...c, timespanUnit: "months", timespanCount: 6 }));
  }, [config.timespanUnit, config.timespanCount]);

  const timespanPresetKey = useMemo(() => {
    const u = config.timespanUnit.toLowerCase();
    const preset = TIMESPAN_PRESETS.find((p) => p.unit === u && p.count === config.timespanCount);
    return preset?.key ?? "months:6";
  }, [config.timespanUnit, config.timespanCount]);

  const previewPack = useMemo(() => {
    const chartImageCount = selectedSymbols.length * config.chartsPerLabel * 2;
    const trainStart = volumeMode === "by_period" ? parseIsoDate(trainingStartIso) : null;
    const trainEnd = parseIsoDate(referenceEndIso);
    let tight = false;
    if (volumeMode === "by_period" && trainStart && trainEnd) {
      const span = Math.abs(calendarDaysBetween(trainStart, trainEnd));
      const need =
        horizonToApproxDays(config.timeframe, config.horizonBars) +
        timespanToApproxDays(config.timespanUnit, config.timespanCount);
      tight = span < need * 0.85;
    }
    return { chartImageCount, tight };
  }, [
    selectedSymbols.length,
    config.timespanCount,
    config.timespanUnit,
    config.timeframe,
    config.chartsPerLabel,
    config.horizonBars,
    volumeMode,
    trainingStartIso,
    referenceEndIso,
  ]);

  const previewSymbol = selectedSymbols[0] ?? "";

  /** Debounced live preview: one example chart re-rendered whenever Step-3 settings change. */
  useEffect(() => {
    if (!previewSymbol) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      setPreviewLoading(true);
      setPreviewError(null);
      trainingChartGeneratorApi
        .preview(
          {
            symbols: previewSymbol,
            useCandles: config.useCandles,
            timeframe: config.timeframe,
            timespanUnit: config.timespanUnit,
            timespanCount: config.timespanCount,
            horizonBars: config.horizonBars,
            takeProfitFraction: config.takeProfitFraction,
            stopLossFraction: config.stopLossFraction,
            imageDimension: config.imageDimension,
            volumeMode,
            trainingStartIso,
            referenceEndIso,
          },
          controller.signal,
        )
        .then((res) => {
          setPreview(res);
          setPreviewError(res.ok ? null : res.message ?? "Preview unavailable");
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : "Preview failed");
        })
        .finally(() => setPreviewLoading(false));
    }, 500);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [
    previewSymbol,
    config.useCandles,
    config.timeframe,
    config.timespanUnit,
    config.timespanCount,
    config.horizonBars,
    config.takeProfitFraction,
    config.stopLossFraction,
    config.imageDimension,
    volumeMode,
    trainingStartIso,
    referenceEndIso,
  ]);

  const InputPanel = (
    <div className="space-y-6">
      {/* Quick flow */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
        <span className="font-medium text-white">Three steps:</span> pick the stocks → set how much training
        data to generate and when → review the preview and start generation.
      </div>

      {/* Step 1 — Stocks / symbols */}
      <StepSection
        step={1}
        title="Choose the stocks"
        description="Add the real stocks you want charts for (e.g. Apple → AAPL, Microsoft → MSFT). Each stock gets labeled chart images for both classes (TP hit vs SL hit)."
      >
        <SymbolBasket
          selectedSymbols={selectedSymbols}
          onAdd={addSymbol}
          onRemove={removeSymbol}
          label="Stock symbols"
          tipText="This is the actual stock ticker on Yahoo Finance — not a crypto pair or made-up code. Search by company name (Apple) or ticker (AAPL), then pick a suggestion."
        />
      </StepSection>

      {/* Step 2 — Training window */}
      <StepSection
        step={2}
        title="Set the training window"
        description="Decide how much data to create and which calendar period it covers. Drag the timeline or use the date fields."
      >
        <div className="mb-4">
          <div className="mb-2 text-sm font-medium text-white/70">
            Dataset size mode
            <FieldTip text="Fixed dataset size: you set charts per label first, then pin where the newest bars end. Fixed training period: you set the calendar span; charts per label follows the estimate when the window changes." />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setVolumeMode("by_charts")}
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                volumeMode === "by_charts"
                  ? "border-white/40 bg-white/15 text-white"
                  : "border-white/10 bg-transparent text-white/70 hover:border-white/25"
              }`}
            >
              Fixed dataset size
            </button>
            <button
              type="button"
              onClick={() => setVolumeMode("by_period")}
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                volumeMode === "by_period"
                  ? "border-white/40 bg-white/15 text-white"
                  : "border-white/10 bg-transparent text-white/70 hover:border-white/25"
              }`}
            >
              Fixed training period
            </button>
          </div>
        </div>

        {/* Fixed dataset size: charts-per-label first, then end date / timeline */}
        {volumeMode === "by_charts" ? (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <label className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
              Charts per label <span className="text-[#e5e5e5]">*</span>
              <FieldTip text="How many chart images per stock for each label class (0 and 1). This is the main size control — set it before picking the end date." />
            </label>
            <input
              type="number"
              min="1"
              value={config.chartsPerLabel}
              onChange={(e) => setConfig({ ...config, chartsPerLabel: parseInt(e.target.value) || 1 })}
              className="w-full max-w-xs rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
            />
            <p className="mt-2 text-sm text-white/45">
              Suggested minimum training phase:{" "}
              <span className="font-mono text-white/75">~{minTrainingPhaseDays} calendar days</span>
            </p>
          </div>
        ) : null}

        <GeneratorTimeline
          mode={volumeMode === "by_period" ? "range" : "end-only"}
          referenceEndIso={referenceEndIso}
          trainingStartIso={trainingStartIso}
          onReferenceEndChange={setReferenceEndIso}
          onTrainingStartChange={setTrainingStartIso}
          chartsPerLabel={config.chartsPerLabel}
          timeframe={config.timeframe}
        />

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {volumeMode === "by_period" ? (
            <div>
              <label className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
                Training start <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Same as the left timeline handle. Edit here or drag — both stay in sync." />
              </label>
              <input
                type="date"
                value={trainingStartIso}
                max={referenceEndIso}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                  setTrainingStartIso(v);
                }}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 font-mono text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
          ) : null}
          <div>
            <label className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
              {volumeMode === "by_period" ? "Dataset end (end of training)" : "Dataset end date"}{" "}
              <span className="text-[#e5e5e5]">*</span>
              <FieldTip
                text={
                  volumeMode === "by_period"
                    ? "Same as the right timeline handle (newest training bars). Cannot be after today."
                    : "Type the newest date to anchor the dataset on, or drag the timeline handle — both stay in sync. Charts extend backward from here."
                }
              />
            </label>
            <input
              type="date"
              value={referenceEndIso}
              min={volumeMode === "by_period" ? trainingStartIso : undefined}
              max={todayIsoMax}
              onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                setReferenceEndIso(v);
                if (volumeMode === "by_period") {
                  const s = parseIsoDate(trainingStartIso);
                  const en = parseIsoDate(v);
                  if (s && en && s > en) setTrainingStartIso(v);
                }
              }}
              className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 font-mono text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
            />
          </div>
        </div>

        {volumeMode === "by_period" ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <label className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
              Charts per label <span className="text-[#e5e5e5]">*</span>
              <FieldTip text="Updates when you change the training period or timeframe. You can override manually." />
            </label>
            <input
              type="number"
              min="1"
              value={config.chartsPerLabel}
              onChange={(e) => setConfig({ ...config, chartsPerLabel: parseInt(e.target.value, 10) || 1 })}
              className="w-full max-w-xs rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
            />
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/45">
              <span>
                Span estimate:{" "}
                <span className="font-mono text-white/75">{windowChartsEstimate ?? "—"}</span>
                {windowChartsEstimate != null && windowChartsEstimate !== config.chartsPerLabel ? (
                  <span className="text-amber-200/70"> · differs from value above</span>
                ) : null}
              </span>
              {windowChartsEstimate != null && windowChartsEstimate !== config.chartsPerLabel ? (
                <button
                  type="button"
                  className="rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/15"
                  onClick={() => {
                    if (windowChartsEstimate == null) return;
                    setConfig((c) => ({ ...c, chartsPerLabel: windowChartsEstimate }));
                  }}
                >
                  Use estimate
                </button>
              ) : null}
            </p>
            {trainingWindowCalendarDays != null && trainingWindowCalendarDays < minTrainingPhaseDays ? (
              <p className="mt-2 text-sm text-amber-200/85">
                Training window (~{trainingWindowCalendarDays}d) is shorter than suggested minimum (
                {minTrainingPhaseDays}d) — widen the window or lower charts per label.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Class-balance disclaimer + choice */}
        <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/90" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-100/90">Label balance</p>
              <p className="mt-1 text-sm leading-relaxed text-white/60">
                “Charts per label” is a target for <em>each</em> class, so {config.chartsPerLabel} means up to{" "}
                <span className="font-mono text-white/80">{config.chartsPerLabel * 2}</span> images. In practice a
                label 1 (take-profit hit first) is naturally rarer than label 0, so a fixed window often fills the
                label 0 target but finds fewer label 1s — leaving an imbalanced dataset. Choose how to handle it:
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, balanceMode: "match_minority" }))}
                  className={`rounded-xl border p-3 text-left transition ${
                    config.balanceMode === "match_minority"
                      ? "border-white/40 bg-white/10"
                      : "border-white/12 bg-transparent hover:border-white/25"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        config.balanceMode === "match_minority" ? "border-white bg-white" : "border-white/40"
                      }`}
                    >
                      {config.balanceMode === "match_minority" ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#0a0a0a]" />
                      ) : null}
                    </span>
                    Balanced 50 / 50
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-white/55">
                    Trim label 0 down to the number of label 1s found. Fewer images, but an even class split.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, balanceMode: "keep_all" }))}
                  className={`rounded-xl border p-3 text-left transition ${
                    config.balanceMode === "keep_all"
                      ? "border-white/40 bg-white/10"
                      : "border-white/12 bg-transparent hover:border-white/25"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        config.balanceMode === "keep_all" ? "border-white bg-white" : "border-white/40"
                      }`}
                    >
                      {config.balanceMode === "keep_all" ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#0a0a0a]" />
                      ) : null}
                    </span>
                    Keep all (imbalanced)
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-white/55">
                    Keep every chart generated. More images, but not a 50 / 50 distribution.
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </StepSection>

      {/* Step 3 — Chart settings */}
      <details className="rounded-2xl border border-white/[0.1] bg-white/[0.02] p-5 md:p-6" open>
        <summary className="cursor-pointer list-none">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-white/80">
              3
            </span>
            <div>
              <h3 className="text-base font-semibold text-white">Chart settings</h3>
              <p className="mt-0.5 text-sm text-white/55">
                Chart type, timeframe, history window, labeling horizon, TP/SL, and image size.
              </p>
            </div>
          </div>
        </summary>
        <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Chart Type <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Candlestick uses OHLC when available; line uses close prices." />
              </label>
              <select
                value={config.useCandles ? "candles" : "line"}
                onChange={(e) => setConfig({ ...config, useCandles: e.target.value === "candles" })}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              >
                <option value="candles">Candlestick</option>
                <option value="line">Line Chart</option>
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Timeframe <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Bar size for history: daily, weekly, or monthly candles." />
              </label>
              <select
                value={config.timeframe}
                onChange={(e) => setConfig({ ...config, timeframe: e.target.value as "1d" | "1wk" | "1mo" })}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              >
                <option value="1d">Daily (1d)</option>
                <option value="1wk">Weekly (1wk)</option>
                <option value="1mo">Monthly (1mo)</option>
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Chart history window <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="How much calendar history each chart image covers." />
              </label>
              <select
                value={timespanPresetKey}
                onChange={(e) => {
                  const preset = TIMESPAN_PRESETS.find((p) => p.key === e.target.value);
                  if (!preset) return;
                  setConfig({
                    ...config,
                    timespanUnit: preset.unit,
                    timespanCount: preset.count,
                  });
                }}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              >
                {TIMESPAN_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Future Horizon (bars) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="How many future bars define the label horizon for each sample." />
              </label>
              <input
                type="number"
                min="1"
                value={config.horizonBars}
                onChange={(e) => setConfig({ ...config, horizonBars: parseInt(e.target.value) || 1 })}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Take Profit (%) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Up move as a percentage of the entry price — e.g. 2 means a +2% take-profit threshold." />
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                value={Number((config.takeProfitFraction * 100).toFixed(4))}
                onChange={(e) => {
                  const pct = parseFloat(e.target.value);
                  setConfig({ ...config, takeProfitFraction: Number.isFinite(pct) ? pct / 100 : 0 });
                }}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Stop Loss (%) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Down move as a percentage of the entry price — e.g. 1 means a −1% stop-loss threshold." />
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                value={Number((config.stopLossFraction * 100).toFixed(4))}
                onChange={(e) => {
                  const pct = parseFloat(e.target.value);
                  setConfig({ ...config, stopLossFraction: Number.isFinite(pct) ? pct / 100 : 0 });
                }}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Image Dimension <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Square PNG size in pixels. 224 matches many CNN inputs." />
              </label>
              <select
                value={config.imageDimension}
                onChange={(e) => setConfig({ ...config, imageDimension: parseInt(e.target.value, 10) })}
                className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              >
                <option value="128">128x128</option>
                <option value="224">224x224 (CNN standard)</option>
                <option value="256">256x256</option>
                <option value="512">512x512</option>
              </select>
            </div>
          </div>

          {/* Live training image — identical to generated PNGs */}
          <div className="rounded-xl border border-white/12 bg-[#0a0a0a]/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-white">Live training image</h4>
                <p className="mt-0.5 text-xs text-white/50">
                  Exact output for{" "}
                  <span className="font-mono text-white/70">{previewSymbol || "—"}</span>
                  {" "}({config.imageDimension}×{config.imageDimension}, transparent, no title) — same as
                  files written to the dataset.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {previewLoading && !previewCollapsed ? (
                  <span className="text-xs text-white/45">Updating…</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPreviewCollapsed((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/[0.08]"
                  aria-expanded={!previewCollapsed}
                >
                  {previewCollapsed ? (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden /> Show
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden /> Minimize
                    </>
                  )}
                </button>
              </div>
            </div>

            {previewCollapsed ? null : !previewSymbol ? (
              <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-sm text-white/45">
                Add a stock in Step 1 to see a live training image.
              </p>
            ) : previewError && !preview?.ok ? (
              <p className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-sm text-amber-100/90">
                {previewError}
              </p>
            ) : preview?.ok && preview.image ? (
              <div className="mt-4 space-y-3">
                {/* Light checkerboard so the transparent PNG (dark strokes) is visible */}
                <div
                  className="flex justify-center rounded-lg border border-white/10 p-4"
                  style={{
                    backgroundImage:
                      "linear-gradient(45deg, #d4d4d4 25%, transparent 25%), linear-gradient(-45deg, #d4d4d4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d4 75%), linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
                    backgroundColor: "#f0f0f0",
                  }}
                >
                  <img
                    src={preview.image}
                    alt={`Training image ${preview.symbol ?? ""}`}
                    width={config.imageDimension}
                    height={config.imageDimension}
                    style={{
                      width: config.imageDimension,
                      height: config.imageDimension,
                      imageRendering: "pixelated",
                    }}
                    className={`block transition-opacity ${
                      previewLoading ? "opacity-60" : "opacity-100"
                    }`}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/55">
                  <span
                    className={`rounded-md px-2 py-0.5 font-medium ${
                      preview.label === 1
                        ? "bg-emerald-500/15 text-emerald-200"
                        : "bg-rose-500/15 text-rose-200"
                    }`}
                  >
                    Label {preview.label} ·{" "}
                    {preview.label === 1
                      ? "TP hit first"
                      : preview.hit === "SL"
                        ? "SL hit first"
                        : "no hit in horizon"}
                  </span>
                  <span>
                    Window:{" "}
                    <span className="font-mono text-white/75">
                      {preview.window_start} → {preview.window_end}
                    </span>
                  </span>
                  <span>
                    Horizon:{" "}
                    <span className="font-mono text-white/75">
                      {preview.horizon_bars} bars → {preview.horizon_end}
                    </span>
                  </span>
                  {preview.entry_price != null ? (
                    <span>
                      Entry <span className="font-mono text-white/75">{preview.entry_price}</span>
                    </span>
                  ) : null}
                  {preview.tp_price != null ? (
                    <span className="text-emerald-200/80">
                      TP <span className="font-mono">{preview.tp_price}</span> (+{preview.take_profit_pct}%)
                    </span>
                  ) : null}
                  {preview.sl_price != null ? (
                    <span className="text-rose-200/80">
                      SL <span className="font-mono">{preview.sl_price}</span> (−{preview.stop_loss_pct}%)
                    </span>
                  ) : null}
                  {preview.hit_date ? (
                    <span>
                      Hit <span className="font-mono text-white/75">{preview.hit_date}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-sm text-white/45">
                {previewLoading ? "Rendering training image…" : "No preview yet."}
              </p>
            )}
          </div>

          <details className="rounded-lg border border-white/[0.08] bg-[rgba(255,255,255,0.02)] px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.12em] text-white/55">
              Advanced
            </summary>
            <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={useRawEndOffset}
                  onChange={(e) => setUseRawEndOffset(e.target.checked)}
                  className="rounded border-white/30"
                />
                Edit raw end offset (overrides date / timeline mapping)
                <FieldTip text="Technical: how many timeframe bars the newest chart is shifted back from today." />
              </label>
              {useRawEndOffset ? (
                <div>
                  <label className="mb-1 block text-xs text-[#F5F5F5]/60">endOffset (bars from today)</label>
                  <input
                    type="number"
                    min={0}
                    value={config.endOffset}
                    onChange={(e) => setConfig({ ...config, endOffset: parseInt(e.target.value, 10) || 0 })}
                    className="w-full max-w-xs rounded-lg border border-white/10 bg-[#0a0a0a]/70 px-3 py-2 text-sm text-white"
                  />
                </div>
              ) : (
                <p className="text-xs text-white/45">
                  Computed endOffset: <span className="font-mono text-white/80">{config.endOffset}</span> (from
                  reference date + timeframe)
                </p>
              )}
            </div>
          </details>
        </div>
      </details>

      {/* Preview */}
      <div className="rounded-2xl border border-white/[0.15] bg-white/[0.06] p-5 md:p-6">
        <h3 className="text-base font-semibold text-white">Preview</h3>
        <p className="mt-3 text-lg text-[#F5F5F5]">
          <span className="text-white/50">Chart images to generate: </span>
          <span className="font-mono text-2xl font-semibold tabular-nums text-white">
            {selectedSymbols.length === 0 ? "—" : previewPack.chartImageCount}
          </span>
          {selectedSymbols.length > 0 ? (
            <span className="text-white/45">
              {" "}
              ({selectedSymbols.length} symbol{selectedSymbols.length === 1 ? "" : "s"} × {config.chartsPerLabel} per
              label × 2 labels)
            </span>
          ) : null}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/45">
          Each image is labeled by whether price hits +{(config.takeProfitFraction * 100).toFixed(1)}% (TP, label 1)
          before −{(config.stopLossFraction * 100).toFixed(1)}% (SL, label 0) within the next {config.horizonBars}{" "}
          bars. Label balance follows real market outcomes.
        </p>
        {previewPack.tight ? (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
            The training window looks tight versus horizon + chart history — leave more calendar room if you can.
          </p>
        ) : null}
      </div>

      {error && (
        <div className="rounded-lg border border-[#f87171]/20 bg-[#f87171]/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#f87171]" />
            <div className="flex-1">
              <h4 className="mb-2 text-sm font-semibold text-[#f87171]">
                {errorDetails?.type === "validation_error"
                  ? "Validation error"
                  : errorDetails?.type === "api_error"
                    ? "API error"
                    : errorDetails?.type === "network_error"
                      ? "Connection error"
                      : "Error"}
              </h4>
              <p className="mb-2 text-sm text-[#F5F5F5]/80">{error}</p>
              {errorDetails && (
                <details className="text-xs text-[#F5F5F5]/60">
                  <summary className="cursor-pointer hover:text-[#F5F5F5]/80">Show technical details</summary>
                  <div className="mt-2 rounded border border-white/5 bg-[#0a0a0a]/60 p-2 font-mono">
                    {errorDetails.type && <div>Type: {errorDetails.type}</div>}
                    {errorDetails.details && (
                      <div className="mt-1 whitespace-pre-wrap break-all">Details: {errorDetails.details}</div>
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={starting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-[#0a0a0a] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-5 w-5" />
          {starting ? "Starting…" : "Generate training dataset"}
        </button>
        <RunCostHint />
      </div>
    </div>
  );

  return (
    <div className="min-h-0">
      <ToolLayout
        title="Generator"
        description="Create labeled candlestick chart datasets at scale for training visual market models."
        contentMaxWidthClass="w-full max-w-none"
        inputPanel={InputPanel}
      />
    </div>
  );
}
