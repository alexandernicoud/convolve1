import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, Play, Sparkles, X } from "lucide-react";
import {
  ApiError,
  getTrainerModelMetadata,
  getUploadedModelMetadata,
  testDataGeneratorApi,
  trainingChartGeneratorApi,
  type ModelTrainingMetadata,
  type TestDataGeneratorRequest,
} from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { requestRunCredits, chargeRunCredits } from "@/state/creditsStore";
import { RunCostHint } from "@/components/RunCostHint";
import FieldTip from "@/components/generator/FieldTip";
import StepSection from "@/components/generator/StepSection";
import SymbolBasket from "@/components/generator/SymbolBasket";
import TestPeriodTimeline from "@/components/generator/TestPeriodTimeline";
import { TIMESPAN_PRESETS } from "@/components/generator/timespanPresets";
import {
  calendarDaysBetween,
  computeEndOffsetFromReferenceEnd,
  estimateBarsBetween,
  isoDateString,
  parseIsoDate,
  startOfLocalDay,
  timespanToApproxDays,
} from "@/lib/generatorDates";

interface TestDataGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerationStarted: (runId: string) => void;
  /** Model currently selected on the Backtester page (uploaded .keras), if any. */
  uploadedModel?: { model_id: string; original_filename: string } | null;
  /** Preselected fitting source, e.g. "trainer:<run_id>" when an internal trained model is selected on the page. */
  defaultSourceKey?: string;
}

type Timeframe = "1d" | "1wk" | "1mo";

interface TestGenConfig {
  useCandles: boolean;
  timeframe: Timeframe;
  timespanUnit: string;
  timespanCount: number;
  horizonBars: number;
  takeProfitFraction: number;
  stopLossFraction: number;
  imageDimension: number;
  useSma: boolean;
  smaLength: number;
}

/** Normalized training settings resolved from a model / run (only genuinely known fields). */
interface FittingInfo {
  symbols?: string;
  useCandles?: boolean;
  timeframe?: Timeframe;
  timespanUnit?: string;
  timespanCount?: number;
  chartsPerLabel?: number;
  horizonBars?: number;
  takeProfitFraction?: number;
  stopLossFraction?: number;
  imageDimension?: number;
  trainingPeriodStart?: string | null;
  trainingPeriodEnd?: string | null;
  modelId?: string;
  trainingRunId?: string;
  generatorRunId?: string;
}

const TIMEFRAMES: Timeframe[] = ["1d", "1wk", "1mo"];

function asTimeframe(value: unknown): Timeframe | undefined {
  return TIMEFRAMES.includes(value as Timeframe) ? (value as Timeframe) : undefined;
}

/** Does the metadata carry enough generator settings to configure a fitting test set? */
function hasGeneratorSettings(info: FittingInfo): boolean {
  return (
    info.timeframe != null &&
    info.timespanUnit != null &&
    info.timespanCount != null &&
    info.horizonBars != null &&
    info.takeProfitFraction != null &&
    info.stopLossFraction != null
  );
}

function fittingFromGeneratorConfig(
  gc: Record<string, unknown>,
  ids: Pick<FittingInfo, "modelId" | "trainingRunId" | "generatorRunId">,
): FittingInfo {
  const volumeMode = typeof gc.volumeMode === "string" ? gc.volumeMode : null;
  return {
    ...ids,
    symbols: typeof gc.symbols === "string" ? gc.symbols : undefined,
    useCandles: typeof gc.useCandles === "boolean" ? gc.useCandles : undefined,
    timeframe: asTimeframe(gc.timeframe),
    timespanUnit: typeof gc.timespanUnit === "string" ? gc.timespanUnit : undefined,
    timespanCount: typeof gc.timespanCount === "number" ? gc.timespanCount : undefined,
    chartsPerLabel: typeof gc.chartsPerLabel === "number" ? gc.chartsPerLabel : undefined,
    horizonBars: typeof gc.horizonBars === "number" ? gc.horizonBars : undefined,
    takeProfitFraction: typeof gc.takeProfitFraction === "number" ? gc.takeProfitFraction : undefined,
    stopLossFraction: typeof gc.stopLossFraction === "number" ? gc.stopLossFraction : undefined,
    imageDimension: typeof gc.imageDimension === "number" ? gc.imageDimension : undefined,
    trainingPeriodStart:
      volumeMode === "by_period" && typeof gc.trainingStartIso === "string" ? gc.trainingStartIso : null,
    trainingPeriodEnd: typeof gc.referenceEndIso === "string" ? gc.referenceEndIso : null,
  };
}

function fittingFromModelMetadata(meta: ModelTrainingMetadata, modelId?: string): FittingInfo {
  const base: FittingInfo = meta.generator_config
    ? fittingFromGeneratorConfig(meta.generator_config as Record<string, unknown>, {})
    : {};
  return {
    ...base,
    symbols: meta.symbols ?? base.symbols,
    useCandles: meta.useCandles ?? base.useCandles,
    timeframe: asTimeframe(meta.timeframe) ?? base.timeframe,
    timespanUnit: meta.timespanUnit ?? base.timespanUnit,
    timespanCount: meta.timespanCount ?? base.timespanCount,
    chartsPerLabel: meta.chartsPerLabel ?? base.chartsPerLabel,
    horizonBars: meta.horizonBars ?? base.horizonBars,
    takeProfitFraction: meta.takeProfitFraction ?? base.takeProfitFraction,
    stopLossFraction: meta.stopLossFraction ?? base.stopLossFraction,
    imageDimension: meta.imageDimension ?? base.imageDimension,
    trainingPeriodStart: meta.training_period_start ?? base.trainingPeriodStart ?? null,
    trainingPeriodEnd: meta.training_period_end ?? base.trainingPeriodEnd ?? null,
    modelId,
    trainingRunId: meta.training_run_id,
    generatorRunId: meta.generator_run_id,
  };
}

function defaultTestEndIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDateString(d);
}

function defaultTestStartIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return isoDateString(d);
}

const defaultConfig: TestGenConfig = {
  useCandles: true,
  timeframe: "1d",
  timespanUnit: "months",
  timespanCount: 6,
  horizonBars: 7,
  takeProfitFraction: 0.02,
  stopLossFraction: 0.01,
  imageDimension: 224,
  useSma: false,
  smaLength: 20,
};

/** Approximate trading bars (= chart images per symbol) inside the test period. */
function estimateChartsPerSymbol(start: Date, end: Date, timeframe: Timeframe): number {
  const bars = estimateBarsBetween(start, end, timeframe);
  if (timeframe === "1d") return Math.max(0, Math.round(bars * (5 / 7)));
  return bars;
}

export default function TestDataGeneratorModal({
  isOpen,
  onClose,
  onGenerationStarted,
  uploadedModel,
  defaultSourceKey,
}: TestDataGeneratorModalProps) {
  const runsById = useRunsStore((s) => s.runsById);

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [datasetName, setDatasetName] = useState("");
  const [config, setConfig] = useState<TestGenConfig>(defaultConfig);
  const [testStartIso, setTestStartIso] = useState(defaultTestStartIso);
  const [testEndIso, setTestEndIso] = useState(defaultTestEndIso);

  // Fitting source ("" = configure manually)
  const [sourceKey, setSourceKey] = useState<string>("");
  const [fitting, setFitting] = useState<FittingInfo | null>(null);
  const [fittingState, setFittingState] = useState<"idle" | "loading" | "found" | "unavailable">("idle");
  const [fittingApplied, setFittingApplied] = useState(false);

  const [useRawOffsets, setUseRawOffsets] = useState(false);
  const [rawPeriodLength, setRawPeriodLength] = useState(252);
  const [rawEndOffset, setRawEndOffset] = useState(0);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    void useRunsStore.getState().mergeRunsFromBackendList(200);
  }, [isOpen]);

  // Preselect the fitting source from the model selected on the page (no reupload needed)
  useEffect(() => {
    if (!isOpen || !defaultSourceKey) return;
    setSourceKey((current) => current || defaultSourceKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultSourceKey]);

  const sourceOptions = useMemo(() => {
    const rows = Object.values(runsById)
      .filter(
        (r) =>
          r.status === "succeeded" && (r.tool === "training-chart-generator" || r.tool === "trainer"),
      )
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, 30);
    return rows.map((r) => ({
      key: `${r.tool === "trainer" ? "trainer" : "generator"}:${r.id}`,
      label: `${r.tool === "trainer" ? "Trained model" : "Training dataset"} · ${r.id.slice(-8)} · ${new Date(
        (r.updated_at > 1e12 ? r.updated_at : r.updated_at * 1000) || Date.now(),
      ).toLocaleDateString()}`,
    }));
  }, [runsById]);

  // Resolve metadata when the fitting source changes
  useEffect(() => {
    setFitting(null);
    setFittingApplied(false);
    if (!sourceKey) {
      setFittingState("idle");
      return;
    }
    let cancelled = false;
    setFittingState("loading");
    void (async () => {
      try {
        let info: FittingInfo | null = null;
        if (sourceKey === "uploaded-model" && uploadedModel) {
          const meta = await getUploadedModelMetadata(uploadedModel.model_id);
          info = fittingFromModelMetadata(meta, uploadedModel.model_id);
        } else if (sourceKey.startsWith("trainer:")) {
          const runId = sourceKey.slice("trainer:".length);
          const meta = await getTrainerModelMetadata(runId);
          info = fittingFromModelMetadata(meta);
          info.trainingRunId = info.trainingRunId ?? runId;
        } else if (sourceKey.startsWith("generator:")) {
          const runId = sourceKey.slice("generator:".length);
          const gc = await trainingChartGeneratorApi.getSavedConfig(runId);
          info = fittingFromGeneratorConfig(gc as unknown as Record<string, unknown>, {
            generatorRunId: runId,
          });
        }
        if (cancelled) return;
        if (info && hasGeneratorSettings(info)) {
          console.info("[testdata] fitting metadata found", { sourceKey, info });
          setFitting(info);
          setFittingState("found");
        } else {
          console.info(
            "[testdata] fitting metadata unavailable: source resolved but carries no generator settings (symbols/timeframe missing)",
            { sourceKey, info },
          );
          setFittingState("unavailable");
        }
      } catch (e) {
        if (cancelled) return;
        setFittingState("unavailable");
        if (e instanceof ApiError && e.status === 404) {
          console.info("[testdata] fitting metadata unavailable: no metadata file recorded for this source (404)", {
            sourceKey,
          });
        } else {
          console.warn("[testdata] fitting metadata lookup failed:", { sourceKey }, e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceKey, uploadedModel]);

  const applyFittingSettings = useCallback(() => {
    if (!fitting) return;
    if (fitting.symbols) {
      setSelectedSymbols(
        fitting.symbols
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      );
    }
    setConfig((c) => ({
      ...c,
      useCandles: fitting.useCandles ?? c.useCandles,
      timeframe: fitting.timeframe ?? c.timeframe,
      timespanUnit: fitting.timespanUnit ?? c.timespanUnit,
      timespanCount: fitting.timespanCount ?? c.timespanCount,
      horizonBars: fitting.horizonBars ?? c.horizonBars,
      takeProfitFraction: fitting.takeProfitFraction ?? c.takeProfitFraction,
      stopLossFraction: fitting.stopLossFraction ?? c.stopLossFraction,
      imageDimension: fitting.imageDimension ?? c.imageDimension,
    }));
    // Suggest a non-overlapping test window: day after training end → yesterday
    if (fitting.trainingPeriodEnd) {
      const trainEnd = parseIsoDate(fitting.trainingPeriodEnd);
      const yesterday = parseIsoDate(defaultTestEndIso());
      if (trainEnd && yesterday && trainEnd < yesterday) {
        const start = new Date(trainEnd);
        start.setDate(start.getDate() + 1);
        setTestStartIso(isoDateString(start));
        setTestEndIso(isoDateString(yesterday));
      }
    }
    setFittingApplied(true);
  }, [fitting]);

  const timespanPresetKey = useMemo(() => {
    const u = config.timespanUnit.toLowerCase();
    const preset = TIMESPAN_PRESETS.find((p) => p.unit === u && p.count === config.timespanCount);
    return preset?.key ?? "";
  }, [config.timespanUnit, config.timespanCount]);

  const todayIsoMax = useMemo(() => isoDateString(startOfLocalDay(new Date())), []);

  const testStart = parseIsoDate(testStartIso);
  const testEnd = parseIsoDate(testEndIso);

  const computedPeriodLength = useMemo(() => {
    if (!testStart || !testEnd || testStart >= testEnd) return 0;
    return estimateBarsBetween(testStart, testEnd, config.timeframe);
  }, [testStart, testEnd, config.timeframe]);

  const computedEndOffset = useMemo(() => {
    if (!testEnd) return 0;
    return computeEndOffsetFromReferenceEnd(testEnd, config.timeframe);
  }, [testEnd, config.timeframe]);

  const trainStart = fitting?.trainingPeriodStart ? parseIsoDate(fitting.trainingPeriodStart) : null;
  const trainEnd = fitting?.trainingPeriodEnd ? parseIsoDate(fitting.trainingPeriodEnd) : null;

  /** Hard overlap of the selected test window with the known training window. */
  const overlapsTraining = useMemo(() => {
    if (!testStart || !testEnd) return false;
    if (trainStart && trainEnd) return testStart < trainEnd && testEnd > trainStart;
    if (trainEnd) return testStart < trainEnd; // start unknown → anything before training end is risky
    return false;
  }, [testStart, testEnd, trainStart, trainEnd]);

  /** Soft warning: chart history windows reach back into the training period. */
  const historyLeaksIntoTraining = useMemo(() => {
    if (overlapsTraining || !trainEnd || !testStart) return false;
    const gapDays = calendarDaysBetween(trainEnd, testStart);
    return gapDays >= 0 && gapDays < timespanToApproxDays(config.timespanUnit, config.timespanCount);
  }, [overlapsTraining, trainEnd, testStart, config.timespanUnit, config.timespanCount]);

  const expectedImages = useMemo(() => {
    if (!testStart || !testEnd || testStart >= testEnd || selectedSymbols.length === 0) return null;
    return selectedSymbols.length * estimateChartsPerSymbol(testStart, testEnd, config.timeframe);
  }, [testStart, testEnd, selectedSymbols.length, config.timeframe]);

  const validate = (): string | null => {
    if (!selectedSymbols.length) return "Add at least one symbol";
    if (!datasetName.trim()) return "Dataset name is required";
    if (!testStart || !testEnd || testStart >= testEnd)
      return "Test start must be strictly before test end";
    if (config.takeProfitFraction <= 0 || config.takeProfitFraction > 1)
      return "Take profit fraction must be between 0 and 1";
    if (config.stopLossFraction <= 0 || config.stopLossFraction > 1)
      return "Stop loss fraction must be between 0 and 1";
    if (config.imageDimension < 64 || config.imageDimension > 1024)
      return "Image dimension must be between 64 and 1024";
    if (config.horizonBars < 1) return "Horizon bars must be at least 1";
    if (!useRawOffsets && computedPeriodLength < 1)
      return "Test period is too short for the selected timeframe";
    if (overlapsTraining)
      return "The selected test period overlaps the training period — choose a later window";
    return null;
  };

  const handleGenerate = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!requestRunCredits("testdata")) {
      onClose();
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const payload: TestDataGeneratorRequest = {
        symbols: selectedSymbols.join(","),
        dataset_name: datasetName.trim(),
        use_candles: config.useCandles,
        timeframe: config.timeframe,
        span_unit: config.timespanUnit,
        span_units_count: config.timespanCount,
        future_horizon_bars: config.horizonBars,
        tp_frac: config.takeProfitFraction,
        sl_frac: config.stopLossFraction,
        img_dim: config.imageDimension,
        period_length_units: useRawOffsets ? rawPeriodLength : computedPeriodLength,
        end_offset_units: useRawOffsets ? rawEndOffset : computedEndOffset,
        use_sma: config.useSma,
        sma_length: config.smaLength,
        test_period_start: testStartIso,
        test_period_end: testEndIso,
        training_period_start: fitting?.trainingPeriodStart ?? undefined,
        training_period_end: fitting?.trainingPeriodEnd ?? undefined,
        model_id: fitting?.modelId,
        training_run_id: fitting?.trainingRunId,
        generator_run_id: fitting?.generatorRunId,
      };

      const response = await testDataGeneratorApi.startRun(payload);
      chargeRunCredits("testdata");
      useRunsStore.getState().registerRun({
        id: response.run_id,
        tool: "testdata",
        status: "running",
        progress: 0.01,
        stage: "starting",
        message: "Initializing test data generator...",
        route: `/tools/backtester?runId=${response.run_id}`,
      });
      onGenerationStarted(response.run_id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start test data generation");
    } finally {
      setStarting(false);
    }
  };

  if (!isOpen) return null;

  const settingRows: Array<[string, string]> | null =
    fitting && fittingState === "found"
      ? [
          ["Symbols", fitting.symbols ?? "—"],
          ["Timeframe", fitting.timeframe ?? "—"],
          [
            "Chart window",
            fitting.timespanCount != null && fitting.timespanUnit
              ? `${fitting.timespanCount} ${fitting.timespanUnit}`
              : "—",
          ],
          ["Horizon", fitting.horizonBars != null ? `${fitting.horizonBars} bars` : "—"],
          ["Take profit", fitting.takeProfitFraction != null ? `${(fitting.takeProfitFraction * 100).toFixed(1)}%` : "—"],
          ["Stop loss", fitting.stopLossFraction != null ? `${(fitting.stopLossFraction * 100).toFixed(1)}%` : "—"],
          ["Image size", fitting.imageDimension != null ? `${fitting.imageDimension}px` : "—"],
          [
            "Training period",
            fitting.trainingPeriodStart || fitting.trainingPeriodEnd
              ? `${fitting.trainingPeriodStart ?? "unknown"} → ${fitting.trainingPeriodEnd ?? "unknown"}`
              : "unknown",
          ],
        ]
      : null;

  // Portal to <body> so the modal is never clipped by ToolLayout / animated parents
  // (those use transform/overflow which create a containing block for position:fixed).
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-5">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative flex max-h-[min(96dvh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0a0a0a] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/12 px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0 pr-3">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">Generate Test Dataset</h2>
            <p className="mt-1 text-sm text-white/60">
              Same generator as your training data — applied to an out-of-sample test period.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 transition-colors hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 sm:p-6">
          {/* Quick flow */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
            <span className="font-medium text-white">Three steps:</span> link your trained model → choose an
            out-of-sample test period → generate labeled charts that match your training settings.
          </div>

          {/* Step 1 — Model link */}
          <StepSection
            step={1}
            title="Match your model"
            description="Select the model this test set should mirror. Its training settings (symbols, timeframe, chart window, TP/SL) are copied automatically."
          >
            <div className="mb-1 flex items-center text-sm font-medium text-white/70">
              <Sparkles className="mr-2 h-4 w-4" />
              Fitting source
              <FieldTip text="Pick the model or training dataset this test set should match. All generator settings are copied — you only choose the non-overlapping test period." />
            </div>
            <select
              value={sourceKey}
              onChange={(e) => setSourceKey(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#0a0a0a]/70 px-4 py-3.5 text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
            >
              <option value="">Configure manually (no model link)</option>
              {uploadedModel ? (
                <option value="uploaded-model">
                  Uploaded model · {uploadedModel.original_filename}
                </option>
              ) : null}
              {sourceOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
              {sourceKey && sourceKey !== "uploaded-model" && !sourceOptions.some((o) => o.key === sourceKey) ? (
                // Preselected source not yet present in the local run store
                <option value={sourceKey}>
                  {sourceKey.startsWith("trainer:") ? "Trained model" : "Training dataset"} ·{" "}
                  {sourceKey.split(":")[1]?.slice(-8)}
                </option>
              ) : null}
            </select>

            {fittingState === "loading" ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Looking up training metadata…
              </div>
            ) : null}

            {fittingState === "unavailable" ? (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100/90">
                Metadata unavailable — configure test dataset manually.
              </div>
            ) : null}

            {fittingState === "found" && settingRows ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-200/90">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Training settings found
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  {settingRows.map(([k, v]) => (
                    <div key={k}>
                      <div className="text-white/45">{k}</div>
                      <div className="break-words font-mono text-white/85">{v}</div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={applyFittingSettings}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
                >
                  <Sparkles className="h-4 w-4" />
                  {fittingApplied ? "Re-apply training settings" : "Apply training settings"}
                </button>
                {fittingApplied ? (
                  <p className="text-sm text-white/50">
                    Settings copied. Only the test period below differs from training — pick a window after{" "}
                    <span className="font-mono text-white/70">{fitting?.trainingPeriodEnd ?? "the training data"}</span>.
                  </p>
                ) : null}
              </div>
            ) : null}
          </StepSection>

          {/* Step 2 — Test period */}
          <StepSection
            step={2}
            title="Choose the test period"
            description="Pick dates the model has never seen. The timeline shows your training window — keep the test range after it."
          >
            <div
              className={`mb-4 rounded-lg border p-4 ${
                overlapsTraining
                  ? "border-red-500/45 bg-red-500/10"
                  : "border-[rgba(236,72,153,0.25)] bg-[rgba(236,72,153,0.08)]"
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#fca5a5]" />
                <div className="min-w-0">
                  <h4 className="mb-1 text-sm font-medium text-[#fca5a5]">No overlap with training data</h4>
                  <p className="text-sm text-[rgba(255,255,255,0.8)]">
                    The test period must not overlap training — otherwise the backtest is meaningless.
                  </p>
                  {trainEnd ? (
                    <div className="mt-2 space-y-0.5 font-mono text-xs text-white/75">
                      <div>
                        Training: {fitting?.trainingPeriodStart ?? "unknown"} → {fitting?.trainingPeriodEnd}
                      </div>
                      <div>
                        Test: {testStartIso} → {testEndIso}
                      </div>
                      <div className={overlapsTraining ? "font-semibold text-red-300" : "text-emerald-300/90"}>
                        Overlap: {overlapsTraining ? "yes — generation disabled" : "no"}
                      </div>
                    </div>
                  ) : null}
                  {historyLeaksIntoTraining ? (
                    <p className="mt-2 text-xs text-amber-200/90">
                      Note: early test charts include up to {config.timespanCount} {config.timespanUnit} of history
                      reaching into training. Start the test period at least one chart window after training ends.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <TestPeriodTimeline
              testStartIso={testStartIso}
              testEndIso={testEndIso}
              onTestStartChange={setTestStartIso}
              onTestEndChange={setTestEndIso}
              trainingStartIso={fitting?.trainingPeriodStart}
              trainingEndIso={fitting?.trainingPeriodEnd}
            />

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
                  Test start <span className="text-[#e5e5e5]">*</span>
                  <FieldTip text="Same as the left timeline handle. Edit here or drag — both stay in sync." />
                </label>
                <input
                  type="date"
                  value={testStartIso}
                  max={testEndIso}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                    setTestStartIso(v);
                  }}
                  className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 font-mono text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
                />
              </div>
              <div>
                <label className="mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75">
                  Test end <span className="text-[#e5e5e5]">*</span>
                  <FieldTip text="Same as the right timeline handle. Cannot be after today." />
                </label>
                <input
                  type="date"
                  value={testEndIso}
                  min={testStartIso}
                  max={todayIsoMax}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                    setTestEndIso(v);
                  }}
                  className="w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 font-mono text-base text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
                />
              </div>
            </div>
          </StepSection>

          {/* Step 3 — Symbols */}
          <StepSection
            step={3}
            title="Confirm symbols"
            description="These tickers get test charts. When using a fitted model, symbols are copied from training."
          >
            <SymbolBasket
              selectedSymbols={selectedSymbols}
              onAdd={(s) => setSelectedSymbols((prev) => (prev.includes(s) ? prev : [...prev, s]))}
              onRemove={(s) => setSelectedSymbols((prev) => prev.filter((x) => x !== s))}
              tipText="Tickers to generate test charts for. When creating a fitting test set, these are copied from the model's training data."
            />
          </StepSection>

          {/* Step 4 — Chart settings (secondary) */}
          <details className="rounded-2xl border border-white/[0.1] bg-white/[0.02] p-5 md:p-6" open={!fittingApplied}>
            <summary className="cursor-pointer list-none">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-white/80">
                  4
                </span>
                <div>
                  <h3 className="text-base font-semibold text-white">Chart settings</h3>
                  <p className="mt-0.5 text-sm text-white/55">
                    Usually copied from training. Expand only if you need to adjust timeframe, TP/SL, or image size.
                  </p>
                </div>
              </div>
            </summary>
            <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Dataset name <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="A name for this test dataset (used in the results metadata and downloads)." />
              </label>
              <input
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder={`test_${(selectedSymbols[0] ?? "data").toLowerCase()}_${testEndIso}`}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] placeholder-[rgba(255,255,255,0.35)] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Chart Type <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Candlestick uses OHLC when available; line uses close prices. Must match the training data for a fitting test set." />
              </label>
              <select
                value={config.useCandles ? "candles" : "line"}
                onChange={(e) => setConfig({ ...config, useCandles: e.target.value === "candles" })}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
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
                onChange={(e) => setConfig({ ...config, timeframe: e.target.value as Timeframe })}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              >
                <option value="1d">Daily (1d)</option>
                <option value="1wk">Weekly (1wk)</option>
                <option value="1mo">Monthly (1mo)</option>
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Chart history window <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="How much calendar history each chart image covers — must match the training charts for the model to read them correctly." />
              </label>
              <select
                value={timespanPresetKey}
                onChange={(e) => {
                  const preset = TIMESPAN_PRESETS.find((p) => p.key === e.target.value);
                  if (!preset) return;
                  setConfig({ ...config, timespanUnit: preset.unit, timespanCount: preset.count });
                }}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              >
                {timespanPresetKey === "" ? (
                  <option value="">
                    {config.timespanCount} {config.timespanUnit} (from training)
                  </option>
                ) : null}
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
                <FieldTip text="How many future bars define the label horizon for each sample — keep identical to training." />
              </label>
              <input
                type="number"
                min="1"
                value={config.horizonBars}
                onChange={(e) => setConfig({ ...config, horizonBars: parseInt(e.target.value) || 1 })}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Take Profit (fraction) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Up move as a fraction of price used for labeling — e.g. 0.02 means a 2% take-profit threshold." />
              </label>
              <input
                type="number"
                step="0.01"
                min="0.001"
                max="1"
                value={config.takeProfitFraction}
                onChange={(e) => setConfig({ ...config, takeProfitFraction: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Stop Loss (fraction) <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Down move as a fraction of price used for labeling — e.g. 0.01 means a 1% stop-loss side." />
              </label>
              <input
                type="number"
                step="0.01"
                min="0.001"
                max="1"
                value={config.stopLossFraction}
                onChange={(e) => setConfig({ ...config, stopLossFraction: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
                Image Dimension <span className="text-[#e5e5e5]">*</span>
                <FieldTip text="Square PNG size in pixels — must match the model's expected input size." />
              </label>
              <select
                value={config.imageDimension}
                onChange={(e) => setConfig({ ...config, imageDimension: parseInt(e.target.value, 10) })}
                className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 px-3 py-2 text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              >
                <option value="128">128x128</option>
                <option value="224">224x224 (CNN standard)</option>
                <option value="256">256x256</option>
                <option value="512">512x512</option>
              </select>
            </div>

              {/* Advanced (nested inside step 4) */}
              <details className="rounded-lg border border-white/[0.08] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.12em] text-white/55">
                  Advanced
                </summary>
                <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={config.useSma}
                    onChange={(e) => setConfig({ ...config, useSma: e.target.checked })}
                    className="rounded border-white/30"
                  />
                  Draw SMA on charts
                  <FieldTip text="Adds a simple moving average line to each chart. Only enable if the training charts also had one." />
                </label>
                {config.useSma ? (
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    SMA length
                    <input
                      type="number"
                      min={2}
                      max={200}
                      value={config.smaLength}
                      onChange={(e) => setConfig({ ...config, smaLength: parseInt(e.target.value, 10) || 20 })}
                      className="w-20 rounded-lg border border-white/10 bg-[#0a0a0a]/70 px-2 py-1.5 text-sm text-white"
                    />
                  </label>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={useRawOffsets}
                  onChange={(e) => {
                    setUseRawOffsets(e.target.checked);
                    if (e.target.checked) {
                      setRawPeriodLength(computedPeriodLength || 1);
                      setRawEndOffset(computedEndOffset);
                    }
                  }}
                  className="rounded border-white/30"
                />
                Edit raw period/offset units (overrides date mapping)
                <FieldTip text="Technical: period length and end offset in timeframe bars, exactly as the Python generator expects. Leave off unless you know you need this." />
              </label>
              {useRawOffsets ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-[#F5F5F5]/60">
                      period_length_units (bars in test window)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={rawPeriodLength}
                      onChange={(e) => setRawPeriodLength(parseInt(e.target.value, 10) || 1)}
                      className="w-full rounded-lg border border-white/10 bg-[#0a0a0a]/70 px-2 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#F5F5F5]/60">
                      end_offset_units (bars from today)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={rawEndOffset}
                      onChange={(e) => setRawEndOffset(parseInt(e.target.value, 10) || 0)}
                      className="w-full rounded-lg border border-white/10 bg-[#0a0a0a]/70 px-2 py-2 text-sm text-white"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/45">
                  Computed from the test period: period length{" "}
                  <span className="font-mono text-white/80">{computedPeriodLength}</span> · end offset{" "}
                  <span className="font-mono text-white/80">{computedEndOffset}</span> (timeframe bars)
                </p>
              )}
            </div>
              </details>
            </div>
          </details>
          <div className="rounded-2xl border border-white/[0.15] bg-white/[0.06] p-5 md:p-6">
            <h3 className="text-base font-semibold text-white">Preview</h3>
            <p className="mt-3 text-lg text-[#F5F5F5]">
              <span className="text-white/50">Expected chart images: </span>
              <span className="font-mono text-2xl font-semibold tabular-nums text-white">{expectedImages ?? "—"}</span>
              {expectedImages != null ? (
                <span className="text-white/45">
                  {" "}
                  ({selectedSymbols.length} symbol{selectedSymbols.length === 1 ? "" : "s"} × ~
                  {testStart && testEnd ? estimateChartsPerSymbol(testStart, testEnd, config.timeframe) : 0} trading{" "}
                  {config.timeframe === "1d" ? "days" : "bars"} in the test window)
                </span>
              ) : null}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              One chart per trading {config.timeframe === "1d" ? "day" : "bar"}; each chart shows{" "}
              {config.timespanCount} {config.timespanUnit} of history and is labeled by whether price hits +
              {(config.takeProfitFraction * 100).toFixed(1)}% (TP, label 1) before −
              {(config.stopLossFraction * 100).toFixed(1)}% (SL, label 0) within the next {config.horizonBars} bars.
              Label balance follows real market outcomes — it is not forced 50/50.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-[#f87171]/20 bg-[#f87171]/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#f87171]" />
                <p className="text-sm text-[#F5F5F5]/85">{error}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse gap-3 border-t border-[rgba(255,255,255,0.12)] pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[rgba(255,255,255,0.15)] px-6 py-3.5 text-base font-medium text-white transition-all duration-200 hover:bg-[rgba(255,255,255,0.06)]"
            >
              Cancel
            </button>
            <div className="flex flex-col items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={starting || overlapsTraining}
                title={overlapsTraining ? "Test period overlaps the training period" : undefined}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-[#0a0a0a] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-5 w-5" />
                {starting ? "Starting…" : "Generate test dataset"}
              </button>
              <RunCostHint />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
