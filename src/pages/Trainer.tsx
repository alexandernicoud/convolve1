import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ClipboardCheck, Loader2, Play } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ToolLayout from "@/components/ToolLayout";
import DatasetUploader from "@/components/DatasetUploader";
import {
  trainerApi,
  runsApi,
  trainingChartGeneratorApi,
  datasetsApi,
  type GlobalRun,
  type DatasetListItem,
  type TrainerCatalog,
  type SplitPreviewRequest,
  type SelectionMetric,
  type OptimizerSettings,
  type ScheduleSettings,
} from "@/lib/api";
import { uploadDataset } from "@/lib/directUpload";
import { confirmRun, chargeRunCredits } from "@/state/creditsStore";
import { RunCost, RunCostHint } from "@/components/RunCostHint";
import { useRunsStore } from "@/state/runsStore";
import { cx, PanelTitle, StatusPill, surface } from "@/features/review/components/primitives";
import { architecturePreview, DEFAULT_ARCHITECTURE } from "@/features/trainer/architecture";
import {
  DEFAULT_OPTIONS,
  OPTIMIZER_DEFAULTS,
  OPTIMIZER_LABEL,
  SCHEDULE_DEFAULTS,
  SCHEDULE_LABEL,
  SECTION_COPY,
  SELECTION_LABEL,
  changedSections,
  describeOptions,
  optionsProblem,
  optionsRequest,
  type AdvancedOptions,
  type SectionId,
} from "@/features/trainer/options";
import { SplitPreviewView, useSplitPreview } from "@/features/trainer/SplitPreview";
import { fmtDateTime, fmtInt } from "@/lib/viz/format";

const fieldClass =
  "w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50";
const smallField =
  "mt-1 w-full rounded-lg border border-white/12 bg-[#0a0a0a]/70 px-3 py-2 text-[13.5px] text-[#F5F5F5] placeholder-[#F5F5F5]/35 focus:border-white/30 focus:ring-1 focus:ring-white/50";
const labelClass = "mb-2 block text-sm text-[#F5F5F5]/62";
const smallLabel = "text-[12.5px] text-[#F5F5F5]/50";
const hint = "mt-1.5 text-[12.5px] leading-relaxed text-white/45";

/** Number input that keeps an empty field as ``null`` instead of coercing it to 0. */
function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  disabled,
  help,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  placeholder?: string;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <label className="block" data-help={help}>
      <span className={smallLabel}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? "any"}
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const n = raw === "" ? null : Number(raw);
          onChange(n == null || Number.isNaN(n) ? null : n);
        }}
        className={cx(smallField, "font-digits tabular-nums disabled:opacity-50")}
      />
    </label>
  );
}

/** One expandable Advanced Training section with its effect and cost explanation. */
function AdvancedSection({
  id,
  open,
  changed,
  onToggle,
  help,
  children,
}: {
  id: SectionId;
  open: boolean;
  changed: boolean;
  onToggle: () => void;
  help: string;
  children: ReactNode;
}) {
  const copy = SECTION_COPY[id];
  return (
    <div className="border-t border-white/[0.07] first:border-t-0" data-help={help}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13.5px] text-white/75 transition hover:text-white"
      >
        <span>{copy.title}</span>
        <span className="flex items-center gap-2 text-[11.5px] text-white/40">
          {changed ? <span className="rounded-full border border-white/25 px-2 py-0.5 text-white/75">Changed</span> : "Default"}
          <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
        </span>
      </button>
      {open ? (
        <div className="space-y-4 px-4 pb-4">
          <div className="space-y-1 rounded-lg bg-white/[0.025] px-3 py-2">
            <p className="text-[12.5px] leading-relaxed text-white/60">{copy.effect}</p>
            <p className="text-[12.5px] leading-relaxed text-white/40">{copy.cost}</p>
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface TrainerConfig {
  use_standard_config: boolean;
  folder_name?: string;
  dataset_id?: string;
  model_name: string;
  image_height?: number;
  image_width?: number;
  batch_size?: number;
  epochs?: number;
  val_split?: number;
  random_seed?: number;
  architecture: string;
  accelerator: "cpu" | "gpu";
}

interface UploadedDataset {
  dataset_id: string;
  extracted_path: string;
  summary: {
    total_images: number;
    label_distribution: Record<string, number>;
    example_filenames: string[];
  };
}

const defaultConfig: TrainerConfig = {
  use_standard_config: true,
  folder_name: "",
  model_name: "",
  image_height: 224,
  image_width: 224,
  batch_size: 16,
  epochs: 30,
  val_split: 0.2,
  random_seed: 7,
  architecture: DEFAULT_ARCHITECTURE,
  accelerator: "cpu",
};

/** Values the server uses when "Standard configuration" is ticked (trainer_runner.py). */
const STANDARD = { image: 224, batch: 16, epochs: 30, val_split: 0.2, seed: 7 };

const sessionPath = (id: string) => `/tools/trainer/runs/${encodeURIComponent(id)}`;
const isLive = (r: GlobalRun) => r.tool === "trainer" && (r.status === "running" || r.status === "queued");
const runStatus = (s: string) => (s === "done" ? "succeeded" : s);

export default function Trainer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const forceNew = searchParams.get("new") === "1";
  const legacyRunId = searchParams.get("runId");

  const [config, setConfig] = useState<TrainerConfig>(defaultConfig);
  const [catalog, setCatalog] = useState<TrainerCatalog | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [opts, setOpts] = useState<AdvancedOptions>(DEFAULT_OPTIONS);
  const patchOpts = (p: Partial<AdvancedOptions>) => setOpts((o) => ({ ...o, ...p }));
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set());
  const toggleSection = (id: SectionId) =>
    setOpenSections((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** Pre-run review: nothing starts until the user presses Start training there. */
  const [reviewing, setReviewing] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    trainerApi.getCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);
  /** Dataset registered from a completed chart-generator ZIP (background default). */
  const [generatorDataset, setGeneratorDataset] = useState<UploadedDataset | null>(null);
  /** Optional override from the upload dropzone only (UI stays empty until user drops a file here). */
  const [manualUploadedDataset, setManualUploadedDataset] = useState<UploadedDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ingestingGenZip, setIngestingGenZip] = useState(false);
  /** Generator run the currently loaded `generatorDataset` came from (survives ref resets; used for lineage). */
  const [generatorDatasetRunId, setGeneratorDatasetRunId] = useState<string | null>(null);
  /** Last chart-generator run id we successfully registered as `generatorDataset` (avoids re-download loops). */
  const loadedGeneratorRunIdRef = useRef<string | null>(null);
  /** null = follow “latest completed” in the store; otherwise load that run’s ZIP. */
  const [preferredGeneratorRunId, setPreferredGeneratorRunId] = useState<string | null>(null);
  const lastSeenLatestGenIdRef = useRef<string | null>(null);
  /** Synchronous lock so rapid double-clicks / re-renders can't launch multiple trainings. */
  const startInFlightRef = useRef(false);
  /** Trainer run the server reports as active (source of truth for restore). */
  const [activeTrainerRun, setActiveTrainerRun] = useState<GlobalRun | null>(null);

  const runsById = useRunsStore((s) => s.runsById);

  // Old links (`/tools/trainer?runId=`) and returning to the Trainer while a run is active both
  // resume the session view instead of showing an empty form. `?new=1` opts out.
  useEffect(() => {
    if (legacyRunId) {
      navigate(sessionPath(legacyRunId), { replace: true });
      return;
    }
    let active = true;
    runsApi
      .getActiveRuns()
      .then(({ runs }) => {
        if (!active) return;
        const live = runs.filter(isLive).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0] ?? null;
        setActiveTrainerRun(live);
        if (live && !forceNew) navigate(sessionPath(live.id), { replace: true });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [legacyRunId, forceNew, navigate]);

  /** Friendly dataset info keyed by the generator run that produced it (for the run dropdown labels). */
  const [datasetsByGenRun, setDatasetsByGenRun] = useState<Record<string, DatasetListItem>>({});
  const [datasetsById, setDatasetsById] = useState<Record<string, DatasetListItem>>({});
  useEffect(() => {
    let active = true;
    datasetsApi
      .list()
      .then(({ datasets }) => {
        if (!active) return;
        const map: Record<string, DatasetListItem> = {};
        const byId: Record<string, DatasetListItem> = {};
        for (const d of datasets) {
          if (d.generator_run_id) map[d.generator_run_id] = d;
          byId[d.dataset_id] = d;
        }
        setDatasetsByGenRun(map);
        setDatasetsById(byId);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void useRunsStore.getState().mergeRunsFromBackendList(200);
  }, []);

  const genRunLabel = useCallback(
    (r: GlobalRun): string => {
      const dateStr = new Date(
        (r.updated_at ?? 0) > 1e12 ? (r.updated_at as number) : (r.updated_at ?? 0) * 1000,
      ).toLocaleDateString();
      const ds = datasetsByGenRun[r.id];
      return ds ? `${ds.name} · ${dateStr}` : `${r.id} · ${dateStr}`;
    },
    [datasetsByGenRun],
  );

  const chartGenRunsWithZip = useMemo(() => {
    return Object.values(runsById)
      .filter((r) => r.tool === "training-chart-generator" && r.status === "succeeded" && r.download_zip_url)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }, [runsById]);

  const latestCompletedChartGen = chartGenRunsWithZip[0] ?? null;

  const effectiveGeneratorRun = useMemo((): GlobalRun | null => {
    if (preferredGeneratorRunId) {
      const pick = runsById[preferredGeneratorRunId];
      if (pick && pick.tool === "training-chart-generator" && pick.status === "succeeded" && pick.download_zip_url) {
        return pick;
      }
    }
    return latestCompletedChartGen;
  }, [runsById, preferredGeneratorRunId, latestCompletedChartGen]);

  const recentTrainerRuns = useMemo(
    () =>
      Object.values(runsById)
        .filter((r) => r.tool === "trainer")
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        .slice(0, 6),
    [runsById],
  );

  const trainingDataset = manualUploadedDataset ?? generatorDataset;

  /** When “latest” in the store advances and we are not pinned to an older run, allow re-import of the new latest. */
  useEffect(() => {
    const lid = latestCompletedChartGen?.id ?? null;
    if (preferredGeneratorRunId != null) return;
    if (lid == null) return;
    if (lastSeenLatestGenIdRef.current !== lid) {
      lastSeenLatestGenIdRef.current = lid;
      loadedGeneratorRunIdRef.current = null;
    }
  }, [latestCompletedChartGen?.id, preferredGeneratorRunId]);

  useEffect(() => {
    if (!preferredGeneratorRunId) return;
    const r = runsById[preferredGeneratorRunId];
    if (!r || r.tool !== "training-chart-generator" || r.status !== "succeeded" || !r.download_zip_url) {
      setPreferredGeneratorRunId(null);
    }
  }, [preferredGeneratorRunId, runsById]);

  useEffect(() => {
    const run = effectiveGeneratorRun;
    if (!run?.id || manualUploadedDataset) return;
    if (loadedGeneratorRunIdRef.current === run.id && generatorDataset?.dataset_id) return;

    let cancelled = false;
    (async () => {
      setIngestingGenZip(true);
      try {
        const blob = await trainingChartGeneratorApi.fetchDatasetZipBlob(run.id);
        if (cancelled) return;
        const file = new File([blob], `training-dataset-${run.id}.zip`, { type: "application/zip" });
        const data = await uploadDataset<UploadedDataset>(file, {
          source: "generator",
          generatorRunId: run.id,
        });
        if (cancelled) return;
        setGeneratorDataset(data);
        setGeneratorDatasetRunId(run.id);
        setError(null);
        loadedGeneratorRunIdRef.current = run.id;
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load the generator dataset ZIP");
          loadedGeneratorRunIdRef.current = null;
        }
      } finally {
        if (!cancelled) setIngestingGenZip(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveGeneratorRun?.id, manualUploadedDataset, generatorDataset?.dataset_id]);

  const validateConfig = (): string | null => {
    if (ingestingGenZip) return "Still importing the training dataset from your latest chart generator run.";
    if (!trainingDataset && (!config.folder_name || !config.folder_name.trim())) {
      return "No training dataset yet. Finish a chart generator run (its ZIP is loaded automatically) or upload a ZIP.";
    }
    if (!config.model_name.trim()) return "Give the model a name.";
    if (!config.model_name.endsWith(".keras")) return "Model name must end with .keras";

    if (!config.use_standard_config) {
      if (!config.image_height || config.image_height < 32 || config.image_height > 1024) {
        return "Image height must be between 32 and 1024";
      }
      if (!config.image_width || config.image_width < 32 || config.image_width > 1024) {
        return "Image width must be between 32 and 1024";
      }
      if (!config.batch_size || config.batch_size < 1) return "Batch size must be at least 1";
      if (!config.epochs || config.epochs < 1) return "Epochs must be at least 1";
      if (config.val_split === undefined || config.val_split < 0 || config.val_split >= 1) {
        return "Validation split must be between 0 and 1";
      }
    }
    const size = config.use_standard_config ? STANDARD.image : Math.min(config.image_height ?? 224, config.image_width ?? 224);
    if (selectedArch?.min_input && size < selectedArch.min_input) {
      return `${selectedArch.label} needs images of at least ${selectedArch.min_input} px.`;
    }
    if (effValSplit + opts.test_fraction >= 0.8) return "Validation and test together must leave most charts for training.";
    return optionsProblem(opts, selectedArch);
  };

  const selectedArch = catalog?.architectures.find((a) => a.id === config.architecture) ?? null;
  const effSeed = config.use_standard_config ? STANDARD.seed : config.random_seed ?? STANDARD.seed;
  const effValSplit = config.use_standard_config ? STANDARD.val_split : config.val_split ?? STANDARD.val_split;
  const effEpochs = config.use_standard_config ? STANDARD.epochs : config.epochs ?? STANDARD.epochs;
  const lineageGeneratorRunId =
    !manualUploadedDataset && generatorDataset ? generatorDatasetRunId ?? loadedGeneratorRunIdRef.current ?? undefined : undefined;
  const changed = changedSections(opts, effSeed);

  const splitRequest = useMemo((): SplitPreviewRequest | null => {
    if (!trainingDataset) return null;
    return {
      dataset_id: trainingDataset.dataset_id,
      generator_run_id: lineageGeneratorRunId,
      validation_method: opts.validation_method,
      val_split: effValSplit,
      test_fraction: opts.test_fraction,
      random_seed: effSeed,
      purge_chart_windows: opts.purge_chart_windows,
      embargo_bars: opts.embargo_bars,
      label_horizon_bars: opts.label_horizon_bars ?? undefined,
      label_timeframe: opts.label_horizon_bars != null ? opts.label_timeframe : undefined,
    };
  }, [
    opts.label_timeframe,
    trainingDataset,
    lineageGeneratorRunId,
    opts.validation_method,
    opts.test_fraction,
    opts.purge_chart_windows,
    opts.embargo_bars,
    opts.label_horizon_bars,
    effValSplit,
    effSeed,
  ]);
  const previewWanted = reviewing || (showAdvanced && openSections.has("validation"));
  const splitPreview = useSplitPreview(previewWanted ? splitRequest : null);
  const splitRefused = splitPreview.data != null && !splitPreview.data.ok;

  const openReview = () => {
    const problem = validateConfig();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setReviewing(true);
    window.setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };

  const plan = splitPreview.data?.plan;
  const splitCountsText = plan
    ? (["train", "val", "test"] as const)
        .filter((k) => plan.partitions[k])
        .map((k) => `${fmtInt(plan.partitions[k]!.samples)} ${k === "train" ? "training" : k === "val" ? "validation" : "test"}`)
        .join(" · ")
    : splitPreview.loading
      ? "Computing the split…"
      : splitPreview.data && !splitPreview.data.ok
        ? "This split cannot be built"
        : splitPreview.error
          ? "Split preview unavailable"
          : "—";

  const pricingParams = useMemo(
    () => ({
      use_standard_config: config.use_standard_config,
      image_height: config.image_height,
      image_width: config.image_width,
      epochs: config.epochs,
      val_split: config.val_split,
      dataset_images: trainingDataset?.summary.total_images ?? null,
    }),
    [config.use_standard_config, config.image_height, config.image_width, config.epochs, config.val_split, trainingDataset],
  );

  const handleStartTraining = async () => {
    // Synchronous lock: the button's disabled state only updates after the request resolves.
    if (startInFlightRef.current) return;

    const validationError = validateConfig();
    if (validationError) {
      setError(validationError);
      return;
    }
    startInFlightRef.current = true;
    if (!(await confirmRun("trainer", pricingParams))) {
      startInFlightRef.current = false;
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const { architecture, accelerator, ...base } = config;
      const requestConfig = {
        ...base,
        // Defaults are omitted; the server fills them in and records the resolved options.
        ...optionsRequest(opts),
        architecture: architecture !== DEFAULT_ARCHITECTURE ? architecture : undefined,
        accelerator: accelerator === "gpu" ? accelerator : undefined,
        dataset_id: trainingDataset?.dataset_id,
        folder_name: trainingDataset ? undefined : config.folder_name,
        // Link the trained model back to the chart-generator run when the dataset came from one
        generator_run_id: lineageGeneratorRunId,
      };

      const response = await trainerApi.run(requestConfig);
      chargeRunCredits("trainer");

      useRunsStore.getState().registerRun({
        id: response.run_id,
        tool: "trainer",
        status: "running",
        progress: 0,
        stage: "starting",
        message: "Initializing CNN trainer...",
        route: sessionPath(response.run_id),
      });
      navigate(sessionPath(response.run_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start training");
    } finally {
      startInFlightRef.current = false;
      setStarting(false);
    }
  };

  const augmentations = catalog?.options?.augmentations ?? [];
  const setOptimizer = (p: Partial<OptimizerSettings>) => patchOpts({ optimizer: { ...opts.optimizer, ...p } });
  const setSchedule = (p: Partial<ScheduleSettings>) => patchOpts({ lr_schedule: { ...opts.lr_schedule, ...p } });
  const previewArch = architecturePreview(
    config.architecture,
    config.use_standard_config ? STANDARD.image : config.image_height ?? STANDARD.image,
    config.use_standard_config ? STANDARD.image : config.image_width ?? STANDARD.image,
    selectedArch,
  );

  const AdvancedPanel = (
    <div className="rounded-xl border border-white/[0.07] bg-[#05060B]/75" data-help="train-advanced">
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[#F5F5F5]/75"
        aria-expanded={showAdvanced}
      >
        <span>Advanced training</span>
        <span className="flex items-center gap-2 text-[12.5px] text-white/45">
          {changed.size ? `${changed.size} section${changed.size > 1 ? "s" : ""} changed` : "Defaults"}
          <ChevronDown className={cx("h-4 w-4 transition-transform", showAdvanced && "rotate-180")} aria-hidden />
        </span>
      </button>
      {showAdvanced ? (
        <div className="border-t border-white/[0.07]">
          <AdvancedSection id="validation" help="train-adv-validation" open={openSections.has("validation")} changed={changed.has("validation")} onToggle={() => toggleSection("validation")}>
            <div data-help="train-test-fraction">
              <span className={smallLabel}>Test period (latest charts, kept apart)</span>
              <select
                value={String(opts.test_fraction)}
                onChange={(e) => patchOpts({ test_fraction: Number(e.target.value), evaluate_test: Number(e.target.value) > 0 && opts.evaluate_test })}
                className={smallField}
              >
                {[0, 0.1, 0.15, 0.2, 0.25, 0.3].map((f) => (
                  <option key={f} value={f}>
                    {f === 0 ? "None (default)" : `Latest ${Math.round(f * 100)}%`}
                  </option>
                ))}
              </select>
              <p className={hint}>
                The test period is never used to pick the epoch, settings or thresholds. Look at it once, at the end; every
                further look that changes your choices makes it less independent.
              </p>
            </div>
            <label className="flex items-start gap-3" data-help="train-evaluate-test">
              <input
                type="checkbox"
                className="mt-1"
                checked={opts.evaluate_test && opts.test_fraction > 0}
                disabled={opts.test_fraction <= 0}
                onChange={(e) => patchOpts({ evaluate_test: e.target.checked })}
              />
              <span>
                <span className="block text-[13.5px] text-white/80">Evaluate the test period after training</span>
                <span className="block text-[12.5px] leading-relaxed text-white/45">
                  Off: the charts are reserved but not scored, so you can still use them later for one final check.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3" data-help="train-purge-chart-windows">
              <input
                type="checkbox"
                className="mt-1"
                checked={opts.purge_chart_windows}
                onChange={(e) => patchOpts({ purge_chart_windows: e.target.checked })}
              />
              <span>
                <span className="block text-[13.5px] text-white/80">Also leave out charts whose window overlaps a later period</span>
                <span className="block text-[12.5px] leading-relaxed text-white/45">
                  Those charts show candles that also appear in validation or test charts. Charts whose outcome window reaches a
                  later period are always left out.
                </span>
              </span>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumField
                label="Embargo (bars after each outcome window)"
                help="train-embargo"
                min={0}
                max={500}
                step={1}
                value={opts.embargo_bars}
                onChange={(v) => patchOpts({ embargo_bars: Math.max(0, Math.round(v ?? 0)) })}
              />
              <NumField
                label="Label horizon (bars)"
                help="train-label-horizon"
                min={1}
                max={1000}
                step={1}
                value={opts.label_horizon_bars}
                placeholder={
                  splitPreview.data?.label_window.label_horizon_source === "generator_config"
                    ? `${splitPreview.data.label_window.label_horizon_bars} (generator settings)`
                    : "From the generator settings"
                }
                onChange={(v) => patchOpts({ label_horizon_bars: v == null ? null : Math.round(v) })}
              />
              {opts.label_horizon_bars != null ? (
                <label className="block sm:col-start-2">
                  <span className={smallLabel}>Bar size of the horizon</span>
                  <select
                    value={opts.label_timeframe}
                    onChange={(e) => patchOpts({ label_timeframe: e.target.value as AdvancedOptions["label_timeframe"] })}
                    className={smallField}
                  >
                    <option value="1d">Daily bars</option>
                    <option value="1wk">Weekly bars</option>
                    <option value="1mo">Monthly bars</option>
                  </select>
                </label>
              ) : null}
            </div>
            <div className="rounded-lg border border-white/[0.07] px-3 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Split for these settings</p>
              {trainingDataset ? (
                <SplitPreviewView {...splitPreview} />
              ) : (
                <p className="text-[12.5px] text-white/45">Choose a dataset to see the partitions.</p>
              )}
            </div>
          </AdvancedSection>

          <AdvancedSection id="selection" help="train-adv-selection" open={openSections.has("selection")} changed={changed.has("selection")} onToggle={() => toggleSection("selection")}>
            <label className="block" data-help="train-selection-metric">
              <span className={smallLabel}>Selection metric</span>
              <select
                value={opts.selection_metric}
                onChange={(e) => patchOpts({ selection_metric: e.target.value as SelectionMetric })}
                className={smallField}
              >
                {(catalog?.options?.selection_metrics ?? (Object.keys(SELECTION_LABEL) as SelectionMetric[])).map((m) => (
                  <option key={m} value={m}>
                    {SELECTION_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            </label>
            <p className={hint}>
              Accuracy alone can look good by always predicting the more frequent label; the session compares every metric
              with that baseline.
            </p>
          </AdvancedSection>

          <AdvancedSection id="regularization" help="train-adv-early-stopping" open={openSections.has("regularization")} changed={changed.has("regularization")} onToggle={() => toggleSection("regularization")}>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={opts.early_stopping.enabled}
                onChange={(e) => patchOpts({ early_stopping: { ...opts.early_stopping, enabled: e.target.checked } })}
              />
              <span className="text-[13.5px] text-white/80">Stop early when the selection metric stops improving</span>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumField
                label="Patience (epochs)"
                min={1}
                max={100}
                step={1}
                disabled={!opts.early_stopping.enabled}
                value={opts.early_stopping.patience}
                onChange={(v) => patchOpts({ early_stopping: { ...opts.early_stopping, patience: Math.round(v ?? 5) } })}
              />
              <NumField
                label="Minimum improvement"
                min={0}
                max={1}
                disabled={!opts.early_stopping.enabled}
                value={opts.early_stopping.min_delta}
                onChange={(v) => patchOpts({ early_stopping: { ...opts.early_stopping, min_delta: v ?? 0 } })}
              />
            </div>
          </AdvancedSection>

          <AdvancedSection id="optimizer" help="train-adv-optimizer" open={openSections.has("optimizer")} changed={changed.has("optimizer")} onToggle={() => toggleSection("optimizer")}>
            <label className="block">
              <span className={smallLabel}>Optimizer</span>
              <select
                value={opts.optimizer.name}
                onChange={(e) => patchOpts({ optimizer: { ...OPTIMIZER_DEFAULTS[e.target.value as OptimizerSettings["name"]] } })}
                className={smallField}
              >
                {(Object.keys(OPTIMIZER_LABEL) as OptimizerSettings["name"][]).map((n) => (
                  <option key={n} value={n}>
                    {OPTIMIZER_LABEL[n]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumField label="Learning rate" min={0.000001} max={1} value={opts.optimizer.learning_rate} onChange={(v) => setOptimizer({ learning_rate: v ?? undefined })} />
              {opts.optimizer.name === "adamw" ? (
                <NumField label="Weight decay" min={0} max={0.5} value={opts.optimizer.weight_decay} onChange={(v) => setOptimizer({ weight_decay: v ?? 0 })} />
              ) : null}
              {opts.optimizer.name === "sgd" ? (
                <NumField label="Momentum" min={0} max={0.999} value={opts.optimizer.momentum} onChange={(v) => setOptimizer({ momentum: v ?? 0 })} />
              ) : null}
              <NumField
                label="Gradient clipping (norm)"
                min={0.001}
                max={100}
                placeholder="Off"
                value={opts.optimizer.clipnorm ?? null}
                onChange={(v) => setOptimizer({ clipnorm: v ?? undefined })}
              />
            </div>
            {opts.optimizer.name === "sgd" ? (
              <p className={hint}>SGD usually needs a higher learning rate than Adam; 0.01 with momentum 0.9 is the starting point.</p>
            ) : null}
          </AdvancedSection>

          <AdvancedSection id="schedule" help="train-adv-schedule" open={openSections.has("schedule")} changed={changed.has("schedule")} onToggle={() => toggleSection("schedule")}>
            <label className="block">
              <span className={smallLabel}>Schedule</span>
              <select
                value={opts.lr_schedule.name}
                onChange={(e) => patchOpts({ lr_schedule: { ...SCHEDULE_DEFAULTS[e.target.value as ScheduleSettings["name"]] } })}
                className={smallField}
              >
                {(Object.keys(SCHEDULE_LABEL) as ScheduleSettings["name"][]).map((n) => (
                  <option key={n} value={n}>
                    {SCHEDULE_LABEL[n]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {opts.lr_schedule.name === "reduce_on_plateau" ? (
                <>
                  <NumField label="Reduction factor" min={0.05} max={0.95} value={opts.lr_schedule.factor} onChange={(v) => setSchedule({ factor: v ?? 0.5 })} />
                  <NumField label="Plateau patience (epochs)" min={1} max={50} step={1} value={opts.lr_schedule.patience} onChange={(v) => setSchedule({ patience: Math.round(v ?? 2) })} />
                </>
              ) : null}
              {opts.lr_schedule.name === "warmup_cosine" ? (
                <NumField label="Warmup epochs" min={1} max={50} step={1} value={opts.lr_schedule.warmup_epochs} onChange={(v) => setSchedule({ warmup_epochs: Math.round(v ?? 1) })} />
              ) : null}
              {opts.lr_schedule.name === "cosine" || opts.lr_schedule.name === "warmup_cosine" ? (
                <NumField label="Final rate (fraction of start)" min={0} max={1} value={opts.lr_schedule.alpha} onChange={(v) => setSchedule({ alpha: v ?? 0 })} />
              ) : null}
            </div>
            {opts.lr_schedule.name === "cosine" || opts.lr_schedule.name === "warmup_cosine" ? (
              <p className={hint}>
                Cosine schedules are planned over the maximum epochs; when early stopping ends the run sooner, the rate has not
                reached its final value.
              </p>
            ) : null}
          </AdvancedSection>

          <AdvancedSection id="architecture" help="train-adv-architecture" open={openSections.has("architecture")} changed={changed.has("architecture")} onToggle={() => toggleSection("architecture")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumField
                label="Dropout before the output"
                min={0}
                max={0.8}
                placeholder={`Network default (${selectedArch?.default_dropout ?? 0})`}
                value={opts.dropout}
                onChange={(v) => patchOpts({ dropout: v })}
              />
              <NumField label="L2 penalty on weights" min={0} max={0.1} value={opts.l2} onChange={(v) => patchOpts({ l2: v ?? 0 })} />
            </div>
            {opts.optimizer.name === "adamw" ? (
              <p className={hint}>AdamW already applies weight decay; add an L2 penalty only with weight decay set to 0.</p>
            ) : null}
            {selectedArch?.supports_transfer ? (
              <div data-help="train-transfer">
                <span className={smallLabel}>Starting weights</span>
                <div className="mt-1.5 space-y-2">
                  {(
                    [
                      ["scratch", "From scratch", "Random initial weights, like every other network here."],
                      ["frozen", "ImageNet, frozen", "Only the new output layer trains. Fast, but ImageNet features describe photographs, not charts."],
                      ["fine_tune", "ImageNet, fine-tuned", "The last layers adapt to charts too. Batch normalization statistics stay frozen."],
                    ] as const
                  ).map(([mode, title, text]) => (
                    <label key={mode} className="flex cursor-pointer gap-3 rounded-lg border border-white/[0.07] px-3 py-2">
                      <input
                        type="radio"
                        name="transfer_mode"
                        className="mt-1"
                        checked={opts.transfer.mode === mode}
                        onChange={() => patchOpts({ transfer: { ...opts.transfer, mode } })}
                      />
                      <span>
                        <span className="block text-[13.5px] text-white/80">{title}</span>
                        <span className="block text-[12.5px] leading-relaxed text-white/45">{text}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {opts.transfer.mode === "fine_tune" ? (
                  <div className="mt-3 sm:w-1/2">
                    <NumField
                      label="Layers to fine-tune (from the top)"
                      min={1}
                      max={300}
                      step={1}
                      value={opts.transfer.trainable_layers}
                      onChange={(v) => patchOpts({ transfer: { ...opts.transfer, trainable_layers: Math.round(v ?? 20) } })}
                    />
                  </div>
                ) : null}
                <p className={hint}>
                  The network converts chart pixels to the input range the ImageNet weights expect inside the model, so Analysis
                  Lab and the Backtester feed it exactly like any other model.
                </p>
              </div>
            ) : (
              <p className={hint}>Pretrained starting weights are available for EfficientNet-B0 only.</p>
            )}
          </AdvancedSection>

          <AdvancedSection id="imbalance" help="train-adv-imbalance" open={openSections.has("imbalance")} changed={changed.has("imbalance")} onToggle={() => toggleSection("imbalance")}>
            {(
              [
                ["none", "Natural label mix (default)", "Every chart counts once."],
                ["balanced", "Balanced class weights", "Charts of the rarer label count more in the training loss."],
              ] as const
            ).map(([value, title, text]) => (
              <label key={value} className="flex cursor-pointer gap-3 rounded-lg border border-white/[0.07] px-3 py-2">
                <input type="radio" name="class_weighting" className="mt-1" checked={opts.class_weighting === value} onChange={() => patchOpts({ class_weighting: value })} />
                <span>
                  <span className="block text-[13.5px] text-white/80">{title}</span>
                  <span className="block text-[12.5px] leading-relaxed text-white/45">{text}</span>
                </span>
              </label>
            ))}
          </AdvancedSection>

          <AdvancedSection id="augmentation" help="train-adv-augmentation" open={openSections.has("augmentation")} changed={changed.has("augmentation")} onToggle={() => toggleSection("augmentation")}>
            <ul className="space-y-2">
              {augmentations.map((a) => (
                <li key={a.id}>
                  <label className={cx("flex gap-3 rounded-lg border border-white/[0.07] px-3 py-2", a.allowed ? "cursor-pointer" : "opacity-55")}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={!a.allowed}
                      checked={opts.augmentation.includes(a.id)}
                      onChange={(e) =>
                        patchOpts({
                          augmentation: e.target.checked ? [...opts.augmentation, a.id] : opts.augmentation.filter((x) => x !== a.id),
                        })
                      }
                    />
                    <span>
                      <span className="block text-[13.5px] text-white/80">
                        {a.label}
                        {a.allowed ? "" : " · not offered"}
                      </span>
                      <span className="block text-[12.5px] leading-relaxed text-white/45">{a.detail}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </AdvancedSection>

          <AdvancedSection id="reproducibility" help="train-adv-reproducibility" open={openSections.has("reproducibility")} changed={changed.has("reproducibility")} onToggle={() => toggleSection("reproducibility")}>
            <div className="sm:w-1/2">
              <NumField
                label="Random seed"
                help="train-random_seed"
                step={1}
                disabled={config.use_standard_config}
                value={effSeed}
                onChange={(v) => setConfig({ ...config, random_seed: Math.round(v ?? STANDARD.seed) })}
              />
            </div>
            <p className={hint}>
              {config.use_standard_config
                ? "The standard configuration always uses seed 7. Untick it to choose another seed."
                : "Train twice with different seeds to see how much results move by chance alone."}
            </p>
          </AdvancedSection>
        </div>
      ) : null}
    </div>
  );

  const ReviewPanel = (
    <section className="space-y-4 rounded-xl border border-white/15 bg-white/[0.02] px-4 py-4" data-help="train-review" aria-label="Review before training">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Review before training</p>
        <button type="button" onClick={() => setReviewing(false)} className="flex items-center gap-1 text-[12.5px] text-white/55 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Change settings
        </button>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
        {(
          [
            ["Dataset", trainingDataset ? `${datasetsById[trainingDataset.dataset_id]?.name || trainingDataset.dataset_id.slice(-8)} · ${fmtInt(trainingDataset.summary.total_images)} charts` : config.folder_name],
            ["Model file", config.model_name],
            [
              "Network",
              `${selectedArch?.label ?? "Original (v1)"}${previewArch.totalParams != null ? ` · ${fmtInt(previewArch.totalParams)} parameters` : ""}`,
            ],
            [
              "Training",
              `${previewArch.input[0]} × ${previewArch.input[1]} px · batch ${config.use_standard_config ? STANDARD.batch : config.batch_size} · up to ${effEpochs} epochs`,
            ],
            [
              "Validation",
              `${opts.validation_method === "chronological" ? "Most recent period" : "Random sample"} · ${Math.round(effValSplit * 100)}% of charts`,
            ],
            ["Hardware", config.accelerator === "gpu" ? "GPU" : "CPU"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10.5px] uppercase tracking-wide text-white/40">{k}</dt>
            <dd className="truncate text-white/80">{v}</dd>
          </div>
        ))}
      </dl>
      {trainingDataset ? (
        <details className="group" open={splitRefused}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12.5px] text-white/70 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="mr-2 text-[10.5px] uppercase tracking-wide text-white/40">Images</span>
              {splitCountsText}
            </span>
            <span className="shrink-0 text-white/40 group-open:hidden">Split details</span>
            <span className="hidden shrink-0 text-white/40 group-open:inline">Hide</span>
          </summary>
          <div className="mt-3">
            <SplitPreviewView {...splitPreview} />
          </div>
        </details>
      ) : (
        <p className="text-[12.5px] text-white/45">Server folder: the split is computed when training starts.</p>
      )}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12.5px] text-white/70 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="mr-2 text-[10.5px] uppercase tracking-wide text-white/40">Settings</span>
            {changed.size ? `${changed.size} section${changed.size === 1 ? "" : "s"} changed from the defaults` : "Defaults"}
          </span>
          <span className="shrink-0 text-white/40 group-open:hidden">Show all</span>
          <span className="hidden shrink-0 text-white/40 group-open:inline">Hide</span>
        </summary>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px] leading-relaxed text-white/60">
          {describeOptions(opts, effSeed).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
      {splitRefused ? (
        <p className="text-[12.5px] text-amber-100/80">Change the validation settings above; this split would make the run fail.</p>
      ) : null}
    </section>
  );

  const runSummary = [
    trainingDataset ? `${fmtInt(trainingDataset.summary.total_images)} charts` : config.folder_name ? "server folder" : "no dataset",
    selectedArch?.label ?? "Original (v1)",
    previewArch.totalParams != null ? `${fmtInt(previewArch.totalParams)} parameters` : null,
    `${previewArch.input[0]} × ${previewArch.input[1]} px`,
    `up to ${effEpochs} epochs`,
  ]
    .filter(Boolean)
    .join(" · ");

  const ActionBar = (
    <div className="sticky bottom-0 z-20 -mb-px border-t border-white/[0.08] bg-[#0a0a0a] pb-1 pt-3" data-tour="train-run">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 truncate text-[12.5px] text-white/55" title={runSummary}>
          {runSummary}
        </p>
        {reviewing ? (
          <button
            type="button"
            data-help="train-run"
            onClick={handleStartTraining}
            disabled={starting || splitRefused || (splitPreview.loading && !splitPreview.data)}
            className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-[#0a0a0a] transition-all hover:shadow-lg hover:shadow-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {starting ? (
              "Starting…"
            ) : (
              <>
                Train model <RunCost tool="trainer" params={pricingParams} />
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            data-help="train-review-open"
            onClick={openReview}
            disabled={starting}
            className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-[#0a0a0a] transition-all hover:shadow-lg hover:shadow-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ClipboardCheck className="h-4 w-4" />
            Review run <RunCost tool="trainer" params={pricingParams} />
          </button>
        )}
      </div>
      <RunCostHint tool="trainer" params={pricingParams} className="mt-1 text-right" />
    </div>
  );

  const InputPanel = (
    <div className="space-y-6">
      {activeTrainerRun ? (
        <Link
          to={sessionPath(activeTrainerRun.id)}
          className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-[13.5px] text-white/80 transition hover:border-white/30"
        >
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            A training run is in progress. A new run may wait in the queue until it finishes.
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap text-white">
            Open session <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      ) : null}

      <div data-tour="train-dataset" data-help="train-dataset">
        <label className={labelClass}>
          Training dataset <span className="text-[#e5e5e5]">*</span>
        </label>
        <p className="mb-3 text-[13px] leading-relaxed text-[#F5F5F5]/52">
          Your latest completed chart generator dataset is used by default. Pick another run below, or upload your own ZIP, which then takes precedence.
        </p>
        {chartGenRunsWithZip.length > 0 ? (
          <div className="mb-3 space-y-2">
            <label className={smallLabel}>Dataset from generator run</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={preferredGeneratorRunId ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  loadedGeneratorRunIdRef.current = null;
                  setPreferredGeneratorRunId(v === "" ? null : v);
                }}
                className={`${fieldClass} min-w-0 flex-1`}
              >
                <option value="">
                  Latest completed
                  {latestCompletedChartGen ? ` (${genRunLabel(latestCompletedChartGen)})` : ""}
                </option>
                {chartGenRunsWithZip.map((r) => (
                  <option key={r.id} value={r.id}>
                    {genRunLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-[13px] text-white/55">No completed chart generator run with a dataset yet. Generate one first, or upload a ZIP below.</p>
        )}
        {effectiveGeneratorRun && generatorDataset && !ingestingGenZip ? (
          <p className="mb-3 text-[12.5px] text-white/45">
            {fmtInt(generatorDataset.summary.total_images)} images ready
            {manualUploadedDataset ? " · your uploaded ZIP is used instead" : ""}
          </p>
        ) : null}
        {ingestingGenZip ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white/70">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Importing generator dataset…
          </div>
        ) : null}
        <label className={cx(smallLabel, "mb-2 block")}>Upload your own ZIP (optional)</label>
        <DatasetUploader
          onDatasetUploaded={(dataset) => {
            setManualUploadedDataset(dataset);
            setError(null);
          }}
          onDatasetRemoved={() => setManualUploadedDataset(null)}
          uploadedDataset={manualUploadedDataset}
        />
        {!trainingDataset ? (
          <div className="mt-4">
            <label className={smallLabel}>Or a folder path on the server</label>
            <input
              type="text"
              value={config.folder_name}
              onChange={(e) => setConfig({ ...config, folder_name: e.target.value })}
              placeholder="/path/to/labeled/images"
              className={`mt-1 ${fieldClass}`}
            />
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-white/45">
            Training on {datasetsById[trainingDataset.dataset_id]?.name || `dataset ${trainingDataset.dataset_id.slice(-8)}`} ·{" "}
            {fmtInt(trainingDataset.summary.total_images)} images
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>
          Model name <span className="text-[#e5e5e5]">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={config.model_name.replace(/\.keras$/i, "")}
            onChange={(e) => {
              const base = e.target.value.replace(/\.keras$/i, "").trim();
              setConfig({ ...config, model_name: base ? `${base}.keras` : "" });
            }}
            placeholder="e.g. aapl_daily_cnn"
            className={`${fieldClass} pr-20`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white/10 px-2 py-0.5 font-mono text-sm text-white/55">
            .keras
          </span>
        </div>
      </div>

      <div data-tour="train-config" data-help="train-standard">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={config.use_standard_config}
            onChange={(e) => setConfig({ ...config, use_standard_config: e.target.checked })}
            className="h-4 w-4 rounded border-white/30 bg-[#0a0a0a] text-white focus:ring-2 focus:ring-white"
          />
          <span className="text-sm text-[#F5F5F5]/80">Standard configuration (224 × 224 px, batch 16, up to 30 epochs, 20% validation)</span>
        </label>
      </div>

      {!config.use_standard_config && (
        <div className="space-y-3 rounded-xl border border-white/[0.07] bg-[#05060B]/75 p-4">
          <h3 className="text-sm font-medium text-[#F5F5F5]/70">Hyperparameters</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["Image height (px)", "image_height", { min: 32, max: 1024 }, (v: string) => parseInt(v, 10) || 224],
                ["Image width (px)", "image_width", { min: 32, max: 1024 }, (v: string) => parseInt(v, 10) || 224],
                ["Batch size", "batch_size", { min: 1 }, (v: string) => parseInt(v, 10) || 16],
                ["Maximum epochs", "epochs", { min: 1 }, (v: string) => parseInt(v, 10) || 30],
                ["Validation split", "val_split", { min: 0.05, max: 0.45, step: 0.05 }, (v: string) => parseFloat(v) || 0.2],
              ] as const
            ).map(([label, key, attrs, parse]) => (
              <div key={key} data-help={`train-${key}`}>
                <label className={smallLabel}>{label}</label>
                <input
                  type="number"
                  {...attrs}
                  value={config[key]}
                  onChange={(e) => setConfig({ ...config, [key]: parse(e.target.value) })}
                  className={`mt-1 ${fieldClass} font-digits text-sm tabular-nums`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-5">
            <div data-help="train-architecture">
              <label className={smallLabel}>Network</label>
              <select
                value={config.architecture}
                onChange={(e) => {
                  const next = catalog?.architectures.find((a) => a.id === e.target.value);
                  setConfig({ ...config, architecture: e.target.value });
                  if (!next?.supports_transfer && opts.transfer.mode !== "scratch") patchOpts({ transfer: { ...opts.transfer, mode: "scratch" } });
                }}
                className={`mt-1 ${fieldClass} text-sm`}
              >
                {(catalog?.architectures ?? [{ id: DEFAULT_ARCHITECTURE, label: "Original (v1)" }]).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                    {"default" in a && a.default ? " · default" : ""}
                  </option>
                ))}
              </select>
              <p className={hint}>
                {selectedArch?.description ?? "The original Convolve CNN."}
                {selectedArch?.status_note ? ` ${selectedArch.status_note}` : ""}
                {config.architecture !== DEFAULT_ARCHITECTURE
                  ? " Saved under its own identifier; existing models and bots are unaffected."
                  : ""}
              </p>
            </div>

            <div data-help="train-validation-method">
              <span className={smallLabel}>Validation images</span>
              <div className="mt-1.5 space-y-2">
                {(
                  [
                    [
                      "chronological",
                      "Most recent period (recommended)",
                      "The latest charts are held out, and training charts whose window or outcome overlaps them are left out. Needs dated charts, as the chart generator writes them.",
                    ],
                    [
                      "random",
                      "Random sample",
                      "A random share of all charts. Neighbouring charts share almost the same candles, so validation images are near-copies of training images and the score reads higher than on a later period.",
                    ],
                  ] as const
                ).map(([value, title, text]) => (
                  <label key={value} className="flex cursor-pointer gap-3 rounded-lg border border-white/[0.07] px-3 py-2.5">
                    <input
                      type="radio"
                      name="validation_method"
                      checked={opts.validation_method === value}
                      onChange={() => patchOpts({ validation_method: value })}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-[13.5px] text-white/80">{title}</span>
                      <span className="block text-[12.5px] leading-relaxed text-white/45">{text}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className={hint}>
                Test period, purging and the resulting image counts: Advanced training › Validation and purging.
              </p>
            </div>

            {catalog?.accelerators.includes("gpu") ? (
              <div data-help="train-accelerator">
                <span className={smallLabel}>Hardware</span>
                <div className="mt-1.5 flex gap-2">
                  {(["cpu", "gpu"] as const).map((acc) => (
                    <button
                      key={acc}
                      type="button"
                      onClick={() => setConfig({ ...config, accelerator: acc })}
                      className={cx(
                        "rounded-lg border px-3 py-1.5 text-[13px]",
                        config.accelerator === acc ? "border-white/40 text-white" : "border-white/10 text-white/55",
                      )}
                    >
                      {acc === "cpu" ? "CPU (standard)" : "GPU"}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[12.5px] text-white/45">
                  Same network and float32 arithmetic on either; GPU results can differ from CPU in the last decimal places.
                </p>
              </div>
            ) : null}
      </div>

      {AdvancedPanel}

      {error && (
        <div className="rounded-xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3 text-[13.5px] text-red-100/90" role="alert">
          {error}
        </div>
      )}

      {reviewing ? <div ref={reviewRef}>{ReviewPanel}</div> : null}

      {ActionBar}
    </div>
  );

  const OutputPanel = (
    <div className="space-y-5">
      <section className={cx(surface, "px-5 py-5")} data-help="train-network">
        <PanelTitle>Network</PanelTitle>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          {(
            [
              ["Model", selectedArch?.label ?? "Original (v1)"],
              ["Parameters", previewArch.totalParams != null ? fmtInt(previewArch.totalParams) : "image too small"],
              ["Input", `${previewArch.input[0]} × ${previewArch.input[1]} × 3`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10.5px] uppercase tracking-wide text-white/40">{k}</dt>
              <dd className="mt-0.5 truncate font-digits text-[13.5px] tabular-nums text-white/85" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <details className="group mt-4 border-t border-white/[0.06] pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[12.5px] text-white/55 hover:text-white/80 [&::-webkit-details-marker]:hidden">
            {previewArch.stages ? "Stages" : `Layer by layer · ${previewArch.layers.length} layers`}
            <span className="text-white/35 group-open:hidden">Show</span>
            <span className="hidden text-white/35 group-open:inline">Hide</span>
          </summary>
          {previewArch.stages ? (
            <ol className="mt-2 space-y-1.5 text-[13px]">
              {previewArch.stages.map((s) => (
                <li key={s} className="border-t border-white/[0.06] pt-1.5 text-white/75">
                  {s}
                </li>
              ))}
            </ol>
          ) : (
            <table className="mt-2 w-full text-[13px]">
              <tbody>
                {previewArch.layers.map((l, i) => (
                  <tr key={i} className="border-t border-white/[0.06]">
                    <td className="py-1.5 text-white/80">{l.name}</td>
                    <td className="py-1.5 text-right font-digits tabular-nums text-white/50">{l.shape.join(" × ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      </section>

      {trainingDataset ? (
        <section className={cx(surface, "px-5 py-5")}>
          <PanelTitle>Dataset</PanelTitle>
          <p className="mt-1 truncate text-[13px] text-white/60">
            {datasetsById[trainingDataset.dataset_id]?.name || `dataset ${trainingDataset.dataset_id.slice(-8)}`}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            {(
              [
                ["Charts", fmtInt(trainingDataset.summary.total_images)],
                [
                  "Label 0 / 1",
                  `${fmtInt(trainingDataset.summary.label_distribution?.["0"] ?? 0)} / ${fmtInt(trainingDataset.summary.label_distribution?.["1"] ?? 0)}`,
                ],
                [
                  "Label 1 share",
                  trainingDataset.summary.total_images
                    ? `${(((trainingDataset.summary.label_distribution?.["1"] ?? 0) / trainingDataset.summary.total_images) * 100).toFixed(1)}%`
                    : "—",
                ],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[10.5px] uppercase tracking-wide text-white/40">{k}</dt>
                <dd className="mt-0.5 truncate font-digits text-[13.5px] tabular-nums text-white/85">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className={cx(surface, "px-5 py-5")} data-help="train-process">
        <PanelTitle>When you start</PanelTitle>
        <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-white/60">
          {[
            `${opts.validation_method === "chronological" ? "The most recent charts are held out for validation, with overlapping windows purged" : "A random share of charts is held out for validation"}${
              opts.test_fraction > 0 ? `; the latest ${Math.round(opts.test_fraction * 100)}% form a test period` : ""
            }.`,
            opts.early_stopping.enabled
              ? `Training runs epoch by epoch and stops after ${opts.early_stopping.patience} epochs without a better ${SELECTION_LABEL[opts.selection_metric].replace(/ \(.*\)$/, "").toLowerCase()}; the best epoch is kept.`
              : `Every epoch runs; the epoch with the best ${SELECTION_LABEL[opts.selection_metric].replace(/ \(.*\)$/, "").toLowerCase()} is kept.`,
            "The saved model is scored against always predicting the more frequent label. You can leave the page meanwhile.",
          ].map((t, i) => (
            <li key={i} className="grid grid-cols-[1.25rem_1fr] border-t border-white/[0.06] pt-2 first:border-t-0 first:pt-0">
              <span className="font-mono text-[11px] text-white/35">{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </section>

      {recentTrainerRuns.length ? (
        <section className={cx(surface, "px-5 py-5")}>
          <div className="flex items-center justify-between">
            <PanelTitle>Recent training runs</PanelTitle>
            <Link to="/tools/run-log?tab=models" className="text-[13px] text-white/55 transition hover:text-white">
              All models →
            </Link>
          </div>
          <ul className="mt-3">
            {recentTrainerRuns.map((r) => (
              <li key={r.id} className="border-t border-white/[0.06]">
                <Link to={sessionPath(r.id)} className="flex items-center justify-between gap-3 py-2 text-[13px] transition hover:text-white">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12px] text-white/70">{r.id}</span>
                    <span className="text-[12px] text-white/40">{fmtDateTime(r.updated_at > 1e12 ? r.updated_at / 1000 : r.updated_at)}</span>
                  </span>
                  <StatusPill status={runStatus(r.status)} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ToolLayout
        title="Trainer"
        description="Train a CNN on labeled chart images. Training runs on the server and continues if you leave this page."
        contentMaxWidthClass="w-full max-w-none"
        outputPlacement="integrated"
        integratedOutputWide
        inputPanel={InputPanel}
        outputPanel={OutputPanel}
      />
    </div>
  );
}
