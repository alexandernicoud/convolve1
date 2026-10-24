import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ToolLayout from "@/components/ToolLayout";
import DatasetUploader from "@/components/DatasetUploader";
import { trainerApi, runsApi, trainingChartGeneratorApi, datasetsApi, type GlobalRun, type DatasetListItem } from "@/lib/api";
import { uploadDataset } from "@/lib/directUpload";
import { requestRunCredits, chargeRunCredits } from "@/state/creditsStore";
import { RunCostHint } from "@/components/RunCostHint";
import { useRunsStore } from "@/state/runsStore";
import { cx, PanelTitle, StatusPill, surface } from "@/features/review/components/primitives";
import { standardArchitecturePreview } from "@/features/trainer/architecture";
import { fmtDateTime, fmtInt } from "@/lib/viz/format";

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
};

const sessionPath = (id: string) => `/tools/trainer/runs/${encodeURIComponent(id)}`;
const isLive = (r: GlobalRun) => r.tool === "trainer" && (r.status === "running" || r.status === "queued");
const runStatus = (s: string) => (s === "done" ? "succeeded" : s);

export default function Trainer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const forceNew = searchParams.get("new") === "1";
  const legacyRunId = searchParams.get("runId");

  const [config, setConfig] = useState<TrainerConfig>(defaultConfig);
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
    return null;
  };

  const handleStartTraining = async () => {
    // Synchronous lock: the button's disabled state only updates after the request resolves.
    if (startInFlightRef.current) return;

    const validationError = validateConfig();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!requestRunCredits("trainer")) return;

    startInFlightRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const requestConfig = {
        ...config,
        dataset_id: trainingDataset?.dataset_id,
        folder_name: trainingDataset ? undefined : config.folder_name,
        // Link the trained model back to the chart-generator run when the dataset came from one
        generator_run_id:
          !manualUploadedDataset && generatorDataset
            ? generatorDatasetRunId ?? loadedGeneratorRunIdRef.current ?? undefined
            : undefined,
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

  const fieldClass =
    "w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50";
  const labelClass = "mb-2 block text-sm text-[#F5F5F5]/62";
  const smallLabel = "text-[12.5px] text-[#F5F5F5]/50";

  const InputPanel = (
    <div className="space-y-6">
      {activeTrainerRun ? (
        <Link
          to={sessionPath(activeTrainerRun.id)}
          className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-[13.5px] text-white/80 transition hover:border-white/30"
        >
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            A training run is in progress. Starting another runs both at the same time.
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap text-white">
            Open session <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      ) : null}

      <div>
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

      <div>
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
                ["Random seed", "random_seed", {}, (v: string) => parseInt(v, 10) || 7],
              ] as const
            ).map(([label, key, attrs, parse]) => (
              <div key={key}>
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

      {error && (
        <div className="rounded-xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3 text-[13.5px] text-red-100/90" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={handleStartTraining}
          disabled={starting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-medium text-[#0a0a0a] transition-all hover:shadow-lg hover:shadow-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {starting ? "Starting…" : "Start training"}
        </button>
        <RunCostHint tool="trainer" />
      </div>
    </div>
  );

  const arch = standardArchitecturePreview(
    config.use_standard_config ? 224 : config.image_height ?? 224,
    config.use_standard_config ? 224 : config.image_width ?? 224,
  );

  const OutputPanel = (
    <div className="space-y-5">
      <section className={cx(surface, "px-5 py-5")}>
        <PanelTitle>What happens next</PanelTitle>
        <ol className="mt-3 space-y-2 pl-4 text-[13.5px] leading-relaxed text-white/60">
          <li>The dataset is split into training and validation images using the random seed.</li>
          <li>The network trains epoch by epoch; validation loss and accuracy are measured after each epoch.</li>
          <li>Early stopping ends training after 5 epochs without a lower validation loss and keeps the best weights.</li>
          <li>You can leave the page. The session keeps running and reopens from Trainer or the runs banner.</li>
        </ol>
      </section>

      <section className={cx(surface, "px-5 py-5")}>
        <PanelTitle>Network</PanelTitle>
        <p className="mt-1 pl-4 text-[13px] text-white/45">
          {arch.family} · {fmtInt(arch.totalParams)} parameters at {arch.input[0]} × {arch.input[1]} px
        </p>
        <table className="mt-3 w-full text-[13px]">
          <tbody>
            {arch.layers.map((l, i) => (
              <tr key={i} className="border-t border-white/[0.06]">
                <td className="py-1.5 text-white/80">{l.name}</td>
                <td className="py-1.5 text-right font-digits tabular-nums text-white/50">{l.shape.join(" × ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
