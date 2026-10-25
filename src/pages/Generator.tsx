import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { AlertTriangle, Play, ChevronDown, ChevronUp } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ToolLayout from "@/components/ToolLayout";
import GeneratorTimeline from "@/components/generator/GeneratorTimeline";
import FieldTip from "@/components/generator/FieldTip";
import StepSection from "@/components/generator/StepSection";
import SymbolBasket from "@/components/generator/SymbolBasket";
import { TIMESPAN_PRESETS } from "@/components/generator/timespanPresets";
import { trainingChartGeneratorApi, ApiError, type ChartPreviewResult } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { confirmRun, chargeRunCredits } from "@/state/creditsStore";
import { RunCost, RunCostHint } from "@/components/RunCostHint";
import {
  computeEndOffsetFromReferenceEnd,
  estimateBarsBetween,
  isoDateString,
  parseIsoDate,
  shiftCalendarByTimespan,
  startOfLocalDay,
  subtractTimeframeSteps,
} from "@/lib/generatorDates";
import { countTradingDays } from "@/lib/tradingCalendar";
import { parseGeneratorTransfer, RANK_MODES, transferProvenance, type ParsedTransfer } from "@/features/labeling/research";
import {
  estimateRows,
  fallbackStartIso,
  initialWindow,
  timelineEstimate,
  type ChartEstimate,
} from "@/features/generator/plan";
import {
  FIELD_IDS,
  errorList,
  fieldErrorsFromServer,
  revealPlan,
  submitIfValid,
  suggestDatasetName,
  validateGenerator,
  type FieldErrors,
  type FieldKey,
  type SectionKey,
} from "@/features/generator/validation";

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

const INPUT_BASE =
  "w-full rounded-xl border bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] focus:ring-1";

/** Input classes with a red border while the field is invalid. */
function inputCls(invalid: boolean, extra = ""): string {
  return `${INPUT_BASE} ${extra} ${
    invalid
      ? "border-red-400/80 ring-1 ring-red-400/40 focus:border-red-400 focus:ring-red-400/60"
      : "border-white/12 focus:border-white/30 focus:ring-white/50"
  }`;
}

function FieldError({ field, message }: { field: FieldKey; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${FIELD_IDS[field]}-error`} className="mt-1.5 text-xs font-medium text-red-300">
      {message}
    </p>
  );
}

/** a11y wiring for an input that may be invalid. */
function fieldA11y(field: FieldKey, message?: string) {
  return {
    id: FIELD_IDS[field],
    "aria-invalid": message ? true : undefined,
    "aria-describedby": message ? `${FIELD_IDS[field]}-error` : undefined,
    "aria-required": true,
  } as const;
}

const numOrNaN = (raw: string, parse: (s: string) => number) => (raw.trim() === "" ? NaN : parse(raw));
const shown = (n: number) => (Number.isFinite(n) ? n : "");

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
  const [initial] = useState(() => initialWindow(new Date()));
  /** Either you choose chart count, or you choose a training window (we estimate chart count from the span). */
  const [volumeMode, setVolumeMode] = useState<"by_charts" | "by_period">(initial.volumeMode);
  const [referenceEndIso, setReferenceEndIso] = useState(initial.referenceEndIso);
  const [trainingStartIso, setTrainingStartIso] = useState(initial.trainingStartIso);
  const [useRawEndOffset, setUseRawEndOffset] = useState(false);
  /** Fixed training period: walk past the start until the target is met. */
  const [extendHistory, setExtendHistory] = useState(false);
  /** Settings transferred from a Labeling Optimizer cell (`?src=optimizer…`); applied once, then freely editable. */
  const [transfer, setTransfer] = useState<ParsedTransfer | null>(null);

  const [datasetName, setDatasetName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [estimate, setEstimate] = useState<ChartEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  /** Validation shows every error after a blocked run attempt, before that only for visited fields. */
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>({ chartSettings: true, advanced: false });
  const [focusRequest, setFocusRequest] = useState(0);
  const summaryRef = useRef<HTMLDivElement | null>(null);

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

  const todayIsoMax = useMemo(() => isoDateString(startOfLocalDay(new Date())), []);

  /** Dataset end the run uses: the date field, or the raw bar offset when that override is on. */
  const effectiveEndIso = useMemo(() => {
    if (!useRawEndOffset) return referenceEndIso;
    if (!Number.isInteger(config.endOffset) || config.endOffset < 0) return referenceEndIso;
    return isoDateString(subtractTimeframeSteps(startOfLocalDay(new Date()), config.timeframe, config.endOffset));
  }, [useRawEndOffset, referenceEndIso, config.endOffset, config.timeframe]);

  const sourceOptimizer = useMemo(() => (transfer ? transferProvenance(transfer.values) : null), [transfer]);

  /** Chart counts from actual trading bars (same sample walk as the run); re-checked on every relevant change. */
  useEffect(() => {
    const valid =
      selectedSymbols.length > 0 &&
      Number.isInteger(config.chartsPerLabel) && config.chartsPerLabel >= 1 &&
      Number.isInteger(config.horizonBars) && config.horizonBars >= 1 &&
      config.takeProfitFraction > 0 && config.stopLossFraction > 0 && config.stopLossFraction < 1 &&
      !!parseIsoDate(effectiveEndIso) &&
      (volumeMode !== "by_period" || (!!parseIsoDate(trainingStartIso) && trainingStartIso < effectiveEndIso));
    if (!valid) {
      setEstimate(null);
      setEstimateLoading(false);
      return;
    }
    const controller = new AbortController();
    setEstimateLoading(true);
    const handle = window.setTimeout(() => {
      trainingChartGeneratorApi
        .estimate(
          {
            symbols: selectedSymbols.join(","),
            chartsPerLabel: config.chartsPerLabel,
            useCandles: config.useCandles,
            timeframe: config.timeframe,
            timespanUnit: config.timespanUnit,
            timespanCount: config.timespanCount,
            horizonBars: config.horizonBars,
            takeProfitFraction: config.takeProfitFraction,
            stopLossFraction: config.stopLossFraction,
            balanceMode: config.balanceMode,
            volumeMode,
            referenceEndIso: effectiveEndIso,
            trainingStartIso,
            extendHistory: volumeMode === "by_period" && extendHistory,
            ...(sourceOptimizer ? { sourceOptimizer } : {}),
          },
          controller.signal,
        )
        .then((res) => setEstimate(res.ok ? res : null))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setEstimate(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setEstimateLoading(false);
        });
    }, 600);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [
    selectedSymbols,
    config.chartsPerLabel,
    config.useCandles,
    config.timeframe,
    config.timespanUnit,
    config.timespanCount,
    config.horizonBars,
    config.takeProfitFraction,
    config.stopLossFraction,
    config.balanceMode,
    volumeMode,
    effectiveEndIso,
    trainingStartIso,
    extendHistory,
    sourceOptimizer,
  ]);

  /**
   * Charts per class a fixed training period holds: from market data when loaded, otherwise an
   * upper bound from the trading calendar (each bar after the first lookback yields one chart).
   */
  const windowChartsEstimate = useMemo(() => {
    if (volumeMode !== "by_period") return null;
    if (estimate?.ok && estimate.window_per_class != null) return Math.max(1, estimate.window_per_class);
    const a = parseIsoDate(trainingStartIso);
    const b = parseIsoDate(effectiveEndIso);
    if (!a || !b || a >= b) return null;
    const firstChart = shiftCalendarByTimespan(a, config.timespanUnit, -config.timespanCount);
    if (firstChart >= b) return 1;
    const bars =
      config.timeframe === "1d" ? countTradingDays(firstChart, b) : estimateBarsBetween(firstChart, b, config.timeframe);
    const horizon = Number.isFinite(config.horizonBars) ? config.horizonBars : 0;
    return Math.max(1, Math.floor((bars - horizon) / 2));
  }, [volumeMode, estimate, trainingStartIso, effectiveEndIso, config.timeframe, config.timespanUnit, config.timespanCount, config.horizonBars]);

  /** Whenever the window or timeframe changes, align charts with the estimate; a number the user typed is kept until the next change. */
  const chartsTyped = useRef(false);
  useEffect(() => {
    chartsTyped.current = false;
  }, [volumeMode, trainingStartIso, effectiveEndIso, config.timeframe, config.timespanUnit, config.timespanCount]);
  useEffect(() => {
    if (windowChartsEstimate == null || chartsTyped.current) return;
    setConfig((c) =>
      c.chartsPerLabel === windowChartsEstimate ? c : { ...c, chartsPerLabel: windowChartsEstimate },
    );
  }, [windowChartsEstimate]);

  const requestedTotal = Number.isFinite(config.chartsPerLabel) ? config.chartsPerLabel * 2 * selectedSymbols.length : 0;

  const fallbackStart = useMemo(
    () =>
      fallbackStartIso({
        perClass: config.chartsPerLabel,
        timeframe: config.timeframe,
        horizonBars: Number.isFinite(config.horizonBars) ? config.horizonBars : 0,
        lookbackUnit: config.timespanUnit,
        lookbackCount: config.timespanCount,
        endIso: effectiveEndIso,
      }),
    [config.chartsPerLabel, config.timeframe, config.horizonBars, config.timespanUnit, config.timespanCount, effectiveEndIso],
  );

  const timelineEst = useMemo(
    () =>
      timelineEstimate({
        estimate,
        loading: estimateLoading,
        volumeMode,
        trainingStartIso,
        endIso: effectiveEndIso,
        requestedTotal: Math.max(requestedTotal, Number.isFinite(config.chartsPerLabel) ? config.chartsPerLabel * 2 : 0),
        fallbackStart,
      }),
    [estimate, estimateLoading, volumeMode, trainingStartIso, effectiveEndIso, requestedTotal, config.chartsPerLabel, fallbackStart],
  );

  const addSymbol = useCallback((sym: string) => {
    setSelectedSymbols((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
  }, []);

  const removeSymbol = useCallback((sym: string) => {
    setSelectedSymbols((prev) => prev.filter((x) => x !== sym));
  }, []);

  useEffect(() => {
    if (nameEdited) return;
    setDatasetName(suggestDatasetName(selectedSymbols, config.timeframe, config.takeProfitFraction, config.stopLossFraction));
  }, [nameEdited, selectedSymbols, config.timeframe, config.takeProfitFraction, config.stopLossFraction]);

  const errors = useMemo(
    () =>
      validateGenerator({
        symbols: selectedSymbols,
        chartsPerLabel: config.chartsPerLabel,
        volumeMode,
        trainingStartIso,
        referenceEndIso,
        datasetName,
        horizonBars: config.horizonBars,
        takeProfitFraction: config.takeProfitFraction,
        stopLossFraction: config.stopLossFraction,
        useRawEndOffset,
        endOffset: config.endOffset,
        todayIso: todayIsoMax,
      }),
    [selectedSymbols, config.chartsPerLabel, volumeMode, trainingStartIso, referenceEndIso, datasetName, config.horizonBars, config.takeProfitFraction, config.stopLossFraction, useRawEndOffset, config.endOffset, todayIsoMax],
  );

  /** Server-side messages last only until the form changes. */
  useEffect(() => {
    setServerErrors({});
  }, [errors, config]);

  const visibleErrors: FieldErrors = useMemo(() => {
    const out: FieldErrors = {};
    for (const { field, message } of errorList(errors)) {
      if (attempted || touched[field]) out[field] = message;
    }
    return { ...serverErrors, ...out };
  }, [errors, attempted, touched, serverErrors]);
  const summaryErrors = attempted ? errorList(visibleErrors) : [];
  const touch = (field: FieldKey) => () => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));

  /** After a blocked run: open collapsed sections that hold errors, then scroll to and focus the first one. */
  useEffect(() => {
    if (!focusRequest) return;
    const { focus } = revealPlan(visibleErrors);
    if (!focus) return;
    const raf = window.requestAnimationFrame(() => {
      const el = document.getElementById(FIELD_IDS[focus]);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLElement).focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const revealErrors = (errs: FieldErrors) => {
    setAttempted(true);
    const { open } = revealPlan(errs);
    if (open.length) setSectionsOpen((s) => ({ ...s, ...Object.fromEntries(open.map((k) => [k, true])) }));
    setFocusRequest((n) => n + 1);
  };

  const focusField = (field: FieldKey) => {
    const sections = revealPlan({ [field]: "x" }).open;
    if (sections.length) setSectionsOpen((s) => ({ ...s, ...Object.fromEntries(sections.map((k) => [k, true])) }));
    window.requestAnimationFrame(() => {
      const el = document.getElementById(FIELD_IDS[field]);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLElement | null)?.focus({ preventScroll: true });
    });
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
    const t = parseGeneratorTransfer(searchParams, isoDateString(startOfLocalDay(new Date())));
    if (t) {
      const v = t.values;
      setTransfer(t);
      setConfig((c) => ({
        ...c,
        ...(v.tp != null ? { takeProfitFraction: v.tp } : {}),
        ...(v.sl != null ? { stopLossFraction: v.sl } : {}),
        ...(v.h != null ? { horizonBars: v.h } : {}),
      }));
      const w = initialWindow(new Date(), v);
      setVolumeMode(w.volumeMode);
      setTrainingStartIso(w.trainingStartIso);
      setReferenceEndIso(w.referenceEndIso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = searchParams.get("runId")?.trim();
    if (!q) return;
    navigate(`/tools/generator/runs/${encodeURIComponent(q)}`, { replace: true });
  }, [searchParams, navigate]);

  const pricingParams = useMemo(
    () => ({
      symbols: Array.isArray(config.symbols) ? (config.symbols as string[]).join(",") : String(config.symbols ?? ""),
      charts_per_label: Number.isFinite(config.chartsPerLabel) ? config.chartsPerLabel : 0,
      image_dimension: config.imageDimension,
    }),
    [config.symbols, config.chartsPerLabel, config.imageDimension],
  );

  const startGeneration = async () => {
    if (!(await confirmRun("training-chart-generator", pricingParams))) return;

    setError(null);
    setErrorDetails(null);
    setStarting(true);

    try {
      const payload = {
        ...config,
        symbols: selectedSymbols.join(","),
        volumeMode,
        referenceEndIso: effectiveEndIso,
        trainingStartIso,
        datasetName: datasetName.trim(),
        extendHistory: volumeMode === "by_period" && extendHistory,
        ...(sourceOptimizer ? { sourceOptimizer } : {}),
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
        const fieldErrs = isValidation ? fieldErrorsFromServer(err.message) : {};
        if (Object.keys(fieldErrs).length) {
          setServerErrors(fieldErrs);
          revealErrors(fieldErrs);
          return;
        }
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

  const handleGenerate = async () => {
    setError(null);
    setErrorDetails(null);
    const started = await submitIfValid(errors, startGeneration);
    if (!started) revealErrors(errors);
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

  const previewSymbol = selectedSymbols[0] ?? "";
  const previewBlocked = !!(
    errors.horizonBars ||
    errors.takeProfit ||
    errors.stopLoss ||
    errors.trainingStart ||
    errors.referenceEnd
  );

  /** Debounced live preview: one example chart re-rendered whenever Step-3 settings change. */
  useEffect(() => {
    if (!previewSymbol) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    if (previewBlocked) {
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
    previewBlocked,
  ]);

  const perClass = Number.isFinite(config.chartsPerLabel) ? config.chartsPerLabel : 0;
  const chartsField = (
    <>
      <label htmlFor={FIELD_IDS.chartsPerLabel} className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
        Charts per class, per stock <span className="text-[#e5e5e5]">*</span>
        <FieldTip
          text={
            volumeMode === "by_period"
              ? "Target for each label class (0 and 1) and each stock. Follows what the period holds when the window changes; you can override it."
              : "Target for each label class (0 and 1) and each stock. The run walks back from the dataset end until both classes reach it or the history runs out."
          }
        />
      </label>
      <input
        type="number"
        min="1"
        step="1"
        {...fieldA11y("chartsPerLabel", visibleErrors.chartsPerLabel)}
        value={shown(config.chartsPerLabel)}
        onChange={(e) => {
          chartsTyped.current = true;
          setConfig({ ...config, chartsPerLabel: numOrNaN(e.target.value, Number) });
        }}
        onBlur={touch("chartsPerLabel")}
        className={inputCls(!!visibleErrors.chartsPerLabel, "max-w-xs")}
      />
      <FieldError field="chartsPerLabel" message={visibleErrors.chartsPerLabel} />
      <p className="mt-2 text-sm text-white/45">
        Requested:{" "}
        <span className="font-mono text-white/75">
          {perClass.toLocaleString()} × 2 classes × {selectedSymbols.length || 0} stock
          {selectedSymbols.length === 1 ? "" : "s"} = {(perClass * 2 * selectedSymbols.length).toLocaleString()} charts
        </span>
      </p>
    </>
  );

  const estimateLine = (
    <div className="mt-3 text-sm leading-relaxed text-white/55" data-testid="generator-estimate">
      {estimate?.ok ? (
        <>
          <p>
            From market data:{" "}
            <span className={`font-mono ${estimate.fulfilled ? "text-white/85" : "text-amber-200/90"}`}>
              {estimate.final_total.toLocaleString()}
            </span>{" "}
            of {estimate.requested_total.toLocaleString()} requested charts (label 0{" "}
            <span className="font-mono text-white/75">{estimate.final_label0.toLocaleString()}</span> · label 1{" "}
            <span className="font-mono text-white/75">{estimate.final_label1.toLocaleString()}</span>)
            {estimateLoading ? <span className="ml-1 text-white/35">· updating…</span> : null}
          </p>
          {!estimate.fulfilled && estimate.limit ? (
            <p className="mt-1 text-amber-100/80">
              {estimate.limit.message} The most these settings can produce is{" "}
              {estimate.final_total.toLocaleString()} charts.
              {estimate.with_extension && estimate.with_extension.final_total > estimate.final_total && !extendHistory
                ? ` Extending the start to ${estimate.with_extension.earliest_observation} would give ${estimate.with_extension.final_total.toLocaleString()}.`
                : ""}
            </p>
          ) : null}
          {estimate.failed_symbols.length ? (
            <p className="mt-1 text-amber-100/80">No market data for {estimate.failed_symbols.join(", ")}.</p>
          ) : null}
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-white/45 hover:text-white/70">How this count is worked out</summary>
            <dl className="mt-2 grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
              {estimateRows(estimate).map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-white/50">{r.label}</dt>
                  <dd className="text-right font-mono text-white/75">{r.value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 max-w-xl text-xs text-white/40">
              Same sample walk as the run: one chart per trading bar, newest first, from {estimate.end_date} backward.
              Labels whose horizon would need prices after the dataset end are left out.
              {estimate.balance_mode === "match_minority"
                ? " Balanced mode trims the larger class across all stocks to the smaller one; nothing is duplicated."
                : " Keep-all mode keeps every chart found, so the classes can differ."}
            </p>
          </details>
        </>
      ) : estimateLoading ? (
        <p>Checking market data…</p>
      ) : selectedSymbols.length === 0 ? (
        <p>Add a stock to count the charts from actual trading bars.</p>
      ) : Object.keys(errors).some((k) => k !== "datasetName") ? (
        <p>Fix the highlighted settings to see the chart count.</p>
      ) : (
        <p>Market data is unavailable, so the timeline shows the shortest span that could hold this count on the NYSE calendar.</p>
      )}
    </div>
  );

  const InputPanel = (
    <div className="space-y-6">
      {transfer ? (
        <OptimizerTransferBanner
          transfer={transfer}
          current={{ tp: config.takeProfitFraction, sl: config.stopLossFraction, h: config.horizonBars, start: trainingStartIso, end: referenceEndIso, period: volumeMode === "by_period" }}
          onDetach={() => setTransfer(null)}
        />
      ) : null}
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
        <div data-tour="gen-assets" data-help="gen-assets">
          <SymbolBasket
            selectedSymbols={selectedSymbols}
            onAdd={addSymbol}
            onRemove={removeSymbol}
            label="Stock symbols"
            tipText="This is the actual stock ticker on Yahoo Finance — not a crypto pair or made-up code. Search by company name (Apple) or ticker (AAPL), then pick a suggestion."
            inputId={FIELD_IDS.symbols}
            error={visibleErrors.symbols}
          />
        </div>
      </StepSection>

      {/* Step 2 — Training window */}
      <StepSection
        step={2}
        title="Set the training window"
        description="Decide how much data to create and which calendar period it covers. Drag the timeline or use the date fields."
      >
        <div className="mb-4" data-tour="gen-window" data-help="gen-size">
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

        {/* Fixed dataset size: charts-per-class first, then end date / timeline */}
        {volumeMode === "by_charts" ? (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">{chartsField}</div>
        ) : null}

        <GeneratorTimeline
          mode={volumeMode === "by_period" ? "range" : "end-only"}
          referenceEndIso={referenceEndIso}
          trainingStartIso={trainingStartIso}
          onReferenceEndChange={setReferenceEndIso}
          onTrainingStartChange={setTrainingStartIso}
          chartsPerLabel={Number.isFinite(config.chartsPerLabel) ? config.chartsPerLabel : 0}
          timeframe={config.timeframe}
          estimate={timelineEst}
        />

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {volumeMode === "by_period" ? (
            <div>
              <label htmlFor={FIELD_IDS.trainingStart} className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
                Training start <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Same as the left timeline handle. The earliest price any chart may show. Edit here or drag — both stay in sync." />
              </label>
              <input
                type="date"
                {...fieldA11y("trainingStart", visibleErrors.trainingStart)}
                value={trainingStartIso}
                max={referenceEndIso}
                onChange={(e) => setTrainingStartIso(e.target.value)}
                onBlur={touch("trainingStart")}
                className={inputCls(!!visibleErrors.trainingStart, "font-mono")}
              />
              <FieldError field="trainingStart" message={visibleErrors.trainingStart} />
            </div>
          ) : null}
          <div>
            <label htmlFor={FIELD_IDS.referenceEnd} className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
              {volumeMode === "by_period" ? "Dataset end (end of training)" : "Dataset end date"}{" "}
              <span className="text-[#e5e5e5]">*</span>
              <FieldTip
                text={
                  volumeMode === "by_period"
                    ? "Same as the right timeline handle (newest training bars). No price after this date is downloaded, so labels must resolve before it. Cannot be after today."
                    : "Type the newest date to anchor the dataset on, or drag the timeline handle — both stay in sync. Charts extend backward from here; no price after it is used."
                }
              />
            </label>
            <input
              type="date"
              {...fieldA11y("referenceEnd", visibleErrors.referenceEnd)}
              value={referenceEndIso}
              min={volumeMode === "by_period" ? trainingStartIso : undefined}
              max={todayIsoMax}
              onChange={(e) => {
                const v = e.target.value;
                setReferenceEndIso(v);
                if (volumeMode === "by_period") {
                  const s = parseIsoDate(trainingStartIso);
                  const en = parseIsoDate(v);
                  if (s && en && s > en) setTrainingStartIso(v);
                }
              }}
              onBlur={touch("referenceEnd")}
              className={inputCls(!!visibleErrors.referenceEnd, "font-mono")}
            />
            <FieldError field="referenceEnd" message={visibleErrors.referenceEnd} />
          </div>
        </div>

        {volumeMode === "by_period" ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            {chartsField}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/45">
              <span>
                {estimate?.window_per_class != null ? "This period holds" : "Trading-calendar bound"}:{" "}
                <span className="font-mono text-white/75">{windowChartsEstimate ?? "—"}</span> per class
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
                    chartsTyped.current = false;
                    setConfig((c) => ({ ...c, chartsPerLabel: windowChartsEstimate }));
                  }}
                >
                  Use estimate
                </button>
              ) : null}
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={extendHistory}
                onChange={(e) => setExtendHistory(e.target.checked)}
                className="mt-0.5 rounded border-white/30"
              />
              <span>
                Extend the start backward automatically when this period holds fewer charts than requested
                <span className="block text-xs text-white/45">
                  {sourceOptimizer?.research_start
                    ? `Never before the optimizer research start (${sourceOptimizer.research_start}) or the first available bar.`
                    : "Stops at the first available bar. The dataset end never moves."}
                </span>
              </span>
            </label>
          </div>
        ) : null}

        {estimateLine}

        {/* Class-balance disclaimer + choice */}
        <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-4" data-help="gen-balance">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/90" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-100/90">Label balance</p>
              <p className="mt-1 text-sm leading-relaxed text-white/60">
                “Charts per class” is a target for <em>each</em> class and stock, so {perClass.toLocaleString()} means
                at most <span className="font-mono text-white/80">{(perClass * 2).toLocaleString()}</span> images per
                stock. In practice label 1 (take-profit hit first) is often rarer than label 0, so the history can run
                out before label 1 reaches the target — leaving an imbalanced dataset. Choose how to handle it:
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
                    Trim the larger class down to the smaller one across all stocks. Fewer images, but an even
                    class split. Nothing is duplicated.
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
      <details
        className={`rounded-2xl border bg-white/[0.02] p-5 md:p-6 ${
          attempted && revealPlan(visibleErrors).open.includes("chartSettings") ? "border-red-400/40" : "border-white/[0.1]"
        }`}
        open={sectionsOpen.chartSettings}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          setSectionsOpen((s) => (s.chartSettings === open ? s : { ...s, chartSettings: open }));
        }}
      >
        <summary className="cursor-pointer list-none">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-white/80">
              3
            </span>
            <div>
              <h3 className="text-base font-semibold text-white">Chart settings</h3>
              <p className="mt-0.5 text-sm text-white/55">
                Dataset name, chart type, timeframe, history window, labeling horizon, TP/SL, and image size.
              </p>
            </div>
          </div>
        </summary>
        <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
          <div>
            <label htmlFor={FIELD_IDS.datasetName} className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
              Dataset name <span className="text-[#e5e5e5]">*</span>
              <FieldTip text="Shown in your library. Suggested from the stocks and labels until you edit it." />
            </label>
            <input
              type="text"
              maxLength={160}
              {...fieldA11y("datasetName", visibleErrors.datasetName)}
              value={datasetName}
              onChange={(e) => {
                setNameEdited(true);
                setDatasetName(e.target.value);
              }}
              onBlur={touch("datasetName")}
              className={inputCls(!!visibleErrors.datasetName)}
              placeholder="e.g. AAPL · 1D · TP 2% / SL 1%"
            />
            <FieldError field="datasetName" message={visibleErrors.datasetName} />
          </div>
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
            <div data-tour="gen-timeframe" data-help="gen-timeframe">
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
            <div data-tour="gen-labeling" data-help="gen-horizon">
              <label htmlFor={FIELD_IDS.horizonBars} className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Future Horizon (bars) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="How many future bars define the label horizon for each sample." />
              </label>
              <input
                type="number"
                min="1"
                step="1"
                {...fieldA11y("horizonBars", visibleErrors.horizonBars)}
                value={shown(config.horizonBars)}
                onChange={(e) => setConfig({ ...config, horizonBars: numOrNaN(e.target.value, Number) })}
                onBlur={touch("horizonBars")}
                className={inputCls(!!visibleErrors.horizonBars)}
              />
              <FieldError field="horizonBars" message={visibleErrors.horizonBars} />
            </div>
            <div data-help="take-profit">
              <label htmlFor={FIELD_IDS.takeProfit} className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Take Profit (%) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Up move as a percentage of the entry price — e.g. 2 means a +2% take-profit threshold." />
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                {...fieldA11y("takeProfit", visibleErrors.takeProfit)}
                value={shown(Number((config.takeProfitFraction * 100).toFixed(4)))}
                onChange={(e) => setConfig({ ...config, takeProfitFraction: numOrNaN(e.target.value, (v) => parseFloat(v) / 100) })}
                onBlur={touch("takeProfit")}
                className={inputCls(!!visibleErrors.takeProfit)}
              />
              <FieldError field="takeProfit" message={visibleErrors.takeProfit} />
            </div>
            <div data-help="stop-loss">
              <label htmlFor={FIELD_IDS.stopLoss} className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Stop Loss (%) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Down move as a percentage of the entry price — e.g. 1 means a −1% stop-loss threshold." />
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                {...fieldA11y("stopLoss", visibleErrors.stopLoss)}
                value={shown(Number((config.stopLossFraction * 100).toFixed(4)))}
                onChange={(e) => setConfig({ ...config, stopLossFraction: numOrNaN(e.target.value, (v) => parseFloat(v) / 100) })}
                onBlur={touch("stopLoss")}
                className={inputCls(!!visibleErrors.stopLoss)}
              />
              <FieldError field="stopLoss" message={visibleErrors.stopLoss} />
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

          <details
            className="rounded-lg border border-white/[0.08] bg-[rgba(255,255,255,0.02)] px-3 py-2"
            open={sectionsOpen.advanced}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              setSectionsOpen((s) => (s.advanced === open ? s : { ...s, advanced: open }));
            }}
          >
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
                  <label htmlFor={FIELD_IDS.endOffset} className="mb-1 block text-xs text-[#F5F5F5]/60">
                    endOffset (bars from today)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    {...fieldA11y("endOffset", visibleErrors.endOffset)}
                    value={shown(config.endOffset)}
                    onChange={(e) => setConfig({ ...config, endOffset: numOrNaN(e.target.value, Number) })}
                    onBlur={touch("endOffset")}
                    className={`w-full max-w-xs rounded-lg border bg-[#0a0a0a]/70 px-3 py-2 text-sm text-white ${
                      visibleErrors.endOffset ? "border-red-400/80 ring-1 ring-red-400/40" : "border-white/10"
                    }`}
                  />
                  <FieldError field="endOffset" message={visibleErrors.endOffset} />
                  <p className="mt-1 text-xs text-white/45">
                    Dataset end used: <span className="font-mono text-white/75">{effectiveEndIso}</span>
                  </p>
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

      <div className="space-y-1.5" data-tour="gen-run">
        {summaryErrors.length ? (
          <div
            ref={summaryRef}
            id="gen-error-summary"
            role="alert"
            className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2.5 text-sm"
            data-testid="generator-error-summary"
          >
            <p className="font-medium text-red-200">
              {summaryErrors.length === 1
                ? "Fix 1 field before generating:"
                : `Fix ${summaryErrors.length} fields before generating:`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {summaryErrors.map(({ field, message }) => (
                <li key={field}>
                  <button
                    type="button"
                    onClick={() => focusField(field)}
                    className="text-left text-red-100/90 underline decoration-red-300/40 underline-offset-2 hover:text-white"
                  >
                    {message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <button
          type="button"
          data-help="gen-run"
          onClick={() => void handleGenerate()}
          disabled={starting}
          aria-describedby={summaryErrors.length ? "gen-error-summary" : undefined}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-[#0a0a0a] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-5 w-5" />
          {starting ? (
            "Starting…"
          ) : (
            <>
              Generate dataset <RunCost tool="training-chart-generator" params={pricingParams} />
            </>
          )}
        </button>
        <RunCostHint tool="training-chart-generator" params={pricingParams} className="text-center" />
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

function OptimizerTransferBanner({
  transfer,
  current,
  onDetach,
}: {
  transfer: ParsedTransfer;
  current: { tp: number; sl: number; h: number; start: string; end: string; period: boolean };
  onDetach: () => void;
}) {
  const v = transfer.values;
  const pct = (x: number) => `${+(x * 100).toFixed(4)}%`;
  const edited = (changed: boolean) => (changed ? <span className="ml-1.5 text-[11px] text-amber-200/80">edited</span> : null);
  const rows: { k: string; v: string; changed?: boolean }[] = [];
  if (v.symbol) rows.push({ k: "Symbol", v: v.symbol });
  if (v.timeframe) rows.push({ k: "Timeframe", v: "Daily" });
  if (v.tp != null) rows.push({ k: "Take profit", v: pct(v.tp), changed: Math.abs(current.tp - v.tp) > 1e-12 });
  if (v.sl != null) rows.push({ k: "Stop loss", v: pct(v.sl), changed: Math.abs(current.sl - v.sl) > 1e-12 });
  if (v.h != null) rows.push({ k: "Horizon", v: `${v.h} bars`, changed: current.h !== v.h });
  if (v.researchStart && v.researchEnd)
    rows.push({
      k: "Training window",
      v: `${v.researchStart} → ${v.researchEnd}`,
      changed: !current.period || current.start !== v.researchStart || current.end !== v.researchEnd,
    });
  const mode = RANK_MODES.find((m) => m.value === v.mode)?.label;
  return (
    <section className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3.5 text-sm" aria-label="Settings from the Labeling Optimizer" data-testid="optimizer-transfer">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-white">Settings from the Labeling Optimizer</p>
          <p className="mt-0.5 text-[13px] text-white/55">
            {v.runId ? (
              <>
                Run{" "}
                <Link to={`/products/labeling-optimizer/results/${encodeURIComponent(v.runId)}`} className="font-mono text-white/75 underline-offset-4 hover:underline">
                  {v.runId}
                </Link>
              </>
            ) : (
              "Unknown run"
            )}
            {mode ? ` · picked under ${mode.toLowerCase()}` : ""}
            {v.methodologyVersion ? ` · methodology v${v.methodologyVersion}` : " · legacy run"}
          </p>
        </div>
        <button type="button" onClick={onDetach} className="text-[12.5px] text-white/50 underline-offset-4 transition hover:text-white hover:underline" title="Keep the values but do not record the optimizer as their source">
          Don’t link to this run
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.k} className="flex items-baseline justify-between gap-3 text-[13px]">
            <dt className="text-white/50">{r.k}</dt>
            <dd className="font-mono text-white/85">
              {r.v}
              {edited(Boolean(r.changed))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/50">
        Labels follow the optimizer’s rule: entry at the next open, label 1 when take profit is hit before stop loss within the horizon (stop loss first when one bar touches
        both). Chart type, look-back, image size and dataset size are not known to the optimizer and keep your settings. Every value stays editable, and nothing is generated
        until you start it.
        {v.researchStart && v.researchEnd
          ? ` No price outside ${v.researchStart} → ${v.researchEnd} is downloaded; labels that would need later bars are left out.`
          : ""}
      </p>
      {transfer.issues.length ? (
        <ul className="mt-2 space-y-0.5 text-[12.5px] text-amber-200/85">
          {transfer.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
