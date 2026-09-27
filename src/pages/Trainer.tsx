import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Download,
  RotateCcw,
  ArrowRight,
  Play,
  Eye,
  XCircle,
  Activity,
  Terminal,
  Loader2,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import ToolLayout from "@/components/ToolLayout";
import DatasetUploader from "@/components/DatasetUploader";
import { trainerApi, ApiError, TrainerProgressResponse, trainingChartGeneratorApi, apiUrl, datasetsApi, type GlobalRun, type DatasetListItem } from "@/lib/api";
import { requestRunCredits, chargeRunCredits } from "@/state/creditsStore";
import { useRunsStore } from "@/state/runsStore";

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

interface AnalysisStatus {
  status: string;
  progress: {
    phase: string;
    percent: number;
    message?: string;
  };
  generated_files?: string[];
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function normalizePct(percent: number | undefined): number {
  if (percent == null || !Number.isFinite(percent)) return 0;
  return percent > 1 ? percent : percent * 100;
}

const chartTip = {
  backgroundColor: "rgba(7, 8, 21, 0.94)",
  border: "1px solid rgba(124, 92, 255, 0.22)",
  borderRadius: "8px",
  fontSize: "11px",
  fontFamily: "ui-monospace, monospace",
};

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

export default function Trainer() {
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState<TrainerConfig>(defaultConfig);
  const [trainerProgress, setTrainerProgress] = useState<TrainerProgressResponse | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  /** Dataset registered from a completed chart-generator ZIP (background default). */
  const [generatorDataset, setGeneratorDataset] = useState<UploadedDataset | null>(null);
  /** Optional override from the upload dropzone only (UI stays empty until user drops a file here). */
  const [manualUploadedDataset, setManualUploadedDataset] = useState<UploadedDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [tick, setTick] = useState(0);
  const [activityFeed, setActivityFeed] = useState<string[]>([]);
  const [ingestingGenZip, setIngestingGenZip] = useState(false);
  /** Generator run the currently loaded `generatorDataset` came from (survives ref resets; used for lineage). */
  const [generatorDatasetRunId, setGeneratorDatasetRunId] = useState<string | null>(null);
  /** Last chart-generator run id we successfully registered as `generatorDataset` (avoids re-download loops). */
  const loadedGeneratorRunIdRef = useRef<string | null>(null);
  /** null = follow “latest completed” in the store; otherwise load that run’s ZIP. */
  const [preferredGeneratorRunId, setPreferredGeneratorRunId] = useState<string | null>(null);
  const lastSeenLatestGenIdRef = useRef<string | null>(null);

  const pollingTokenRef = useRef(0);
  const analysisPollingTokenRef = useRef(0);
  const wallStartRef = useRef<number | null>(null);
  const epochMarkRef = useRef<number[]>([]);
  const lastEpochRef = useRef(0);
  const lastProgressKeyRef = useRef<string>("");
  const logRef = useRef<HTMLDivElement>(null);
  const stickLogBottomRef = useRef(true);
  /** Synchronous lock so rapid double-clicks / re-renders can't launch multiple trainings. */
  const startInFlightRef = useRef(false);

  const runsById = useRunsStore((s) => s.runsById);

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

  const latestCompletedChartGen = useMemo((): GlobalRun | null => {
    const rows = Object.values(runsById).filter(
      (r) => r.tool === "training-chart-generator" && r.status === "succeeded" && r.download_zip_url,
    );
    rows.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return rows[0] ?? null;
  }, [runsById]);

  const chartGenRunsWithZip = useMemo(() => {
    return Object.values(runsById)
      .filter((r) => r.tool === "training-chart-generator" && r.status === "succeeded" && r.download_zip_url)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }, [runsById]);

  const effectiveGeneratorRun = useMemo((): GlobalRun | null => {
    if (preferredGeneratorRunId) {
      const pick = runsById[preferredGeneratorRunId];
      if (
        pick &&
        pick.tool === "training-chart-generator" &&
        pick.status === "succeeded" &&
        pick.download_zip_url
      ) {
        return pick;
      }
    }
    return latestCompletedChartGen;
  }, [runsById, preferredGeneratorRunId, latestCompletedChartGen]);

  const trainingDataset = useMemo(
    () => manualUploadedDataset ?? generatorDataset,
    [manualUploadedDataset, generatorDataset],
  );

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
        const fd = new FormData();
        fd.append("file", file);
        fd.append("source", "generator");
        fd.append("generator_run_id", run.id);
        const res = await fetch(apiUrl("/datasets/upload"), { method: "POST", body: fd });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Dataset upload failed (${res.status})`);
        }
        const data = (await res.json()) as UploadedDataset;
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

  const chartData = useMemo(() => {
    const h = trainerProgress?.history_preview;
    if (!h?.length) return [];
    return h.map((row) => ({
      epoch: row.epoch,
      accuracy: row.accuracy,
      val_accuracy: row.val_accuracy ?? null,
      loss: row.loss,
      val_loss: row.val_loss ?? null,
    }));
  }, [trainerProgress?.history_preview]);

  const validateConfig = (): string | null => {
    if (ingestingGenZip) return "Still importing the training dataset from your latest chart generator run…";
    if (!trainingDataset && (!config.folder_name || !config.folder_name.trim())) {
      return "No training dataset yet—finish a chart generator run (ZIP is loaded automatically) or upload a ZIP / enter a folder path";
    }
    if (!config.model_name.trim()) return "Model name is required";
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

  const pushActivity = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString(undefined, { hour12: false });
    setActivityFeed((prev) => [...prev.slice(-120), `[${ts}] ${line}`]);
  }, []);

  const ingestProgressForActivity = useCallback(
    (data: TrainerProgressResponse) => {
      const ep = data.progress?.epoch ?? 0;
      const ph = data.progress?.phase ?? "";
      const msg = data.progress?.message ?? "";
      const st = data.status;
      const key = `${st}|${ph}|${ep}|${msg}`;
      if (key === lastProgressKeyRef.current) return;
      lastProgressKeyRef.current = key;

      if (ep > 0 && ep !== lastEpochRef.current) {
        epochMarkRef.current.push(performance.now());
        lastEpochRef.current = ep;
        pushActivity(
          `epoch ${ep}/${data.progress.epochs ?? "?"} · ${msg || ph} · val_acc ${data.progress.val_accuracy != null ? data.progress.val_accuracy.toFixed(4) : "—"}`
        );
      } else if (ph === "loading") {
        pushActivity(`pipeline · ${msg || ph}`);
      } else if (ph === "building") {
        pushActivity(`model · ${msg || ph}`);
      } else if (ph === "saving" || ph === "training") {
        pushActivity(`${ph} · ${msg || ph}`);
      } else if (st === "done") {
        pushActivity(`status · training complete`);
      } else if (st === "failed" || st === "cancelled") {
        pushActivity(`status · ${st}: ${msg || ph}`);
      }
    },
    [pushActivity]
  );

  const handleStartTraining = async () => {
    // Guard against double-submits: a synchronous ref lock plus the already-running check
    // (the button's disabled state only updates after the request resolves, which is too late).
    if (startInFlightRef.current || trainerProgress?.status === "running") return;

    const validationError = validateConfig();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!requestRunCredits("trainer")) return;

    startInFlightRef.current = true;
    setError(null);
    wallStartRef.current = performance.now();
    epochMarkRef.current = [];
    lastEpochRef.current = 0;
    lastProgressKeyRef.current = "";
    setActivityFeed([]);
    // Optimistically mark running immediately so the button disables before the await resolves.
    setTrainerProgress({
      status: "running",
      progress: { phase: "starting", percent: 0, message: "Initializing..." },
    });

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
      setRunId(response.run_id);
      pushActivity(`run · ${response.run_id.slice(-12)} · polling`);

      useRunsStore.getState().registerRun({
        id: response.run_id,
        tool: "trainer",
        status: "running",
        progress: 0,
        stage: "starting",
        message: "Initializing CNN trainer...",
        route: `/tools/trainer/runs/${response.run_id}`,
      });

      startPolling(response.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start training");
      wallStartRef.current = null;
      setTrainerProgress(null);
    } finally {
      startInFlightRef.current = false;
    }
  };

  const handleCancelTraining = async () => {
    if (!runId || trainerProgress?.status !== "running") return;
    setIsCancelling(true);
    try {
      await trainerApi.cancelRun(runId);
      setTrainerProgress((prev) =>
        prev
          ? {
              ...prev,
              status: "cancelled",
              progress: { phase: "cancelled", percent: 0, message: "Training cancelled" },
            }
          : prev
      );
      pushActivity("client · cancel requested");
      useRunsStore.getState().updateRun(runId, {
        status: "cancelled",
        progress: 0,
        stage: "cancelled",
        message: "Training cancelled",
      });
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setPollingInterval(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel training");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleStartAnalysis = async () => {
    if (!runId) return;
    if (!requestRunCredits("analysis")) return;

    try {
      let imgPath: string | undefined;
      if (trainingDataset && trainingDataset.summary.example_filenames.length > 0) {
        imgPath = `${trainingDataset.extracted_path}/${trainingDataset.summary.example_filenames[0]}`;
      }

      const data = await trainerApi.startAnalysis(runId, imgPath);
      chargeRunCredits("analysis");
      setAnalysisId(data.analysis_id);
      setAnalysisStatus({
        status: "running",
        progress: { phase: "starting", percent: 0, message: "Starting analysis..." },
      });
      pushActivity(`analysis · job ${data.analysis_id.slice(-12)}`);

      const analysisRunId = `${runId}_${data.analysis_id}`;
      useRunsStore.getState().registerRun({
        id: analysisRunId,
        tool: "analysis",
        status: "running",
        progress: 0,
        stage: "starting",
        message: "Starting CNN analysis...",
        route: `/tools/trainer/runs/${runId}/analysis`,
        parent_run_id: runId,
        trainer_run_id: runId,
        analysis_id: data.analysis_id,
      });

      startAnalysisPolling(runId, data.analysis_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start analysis");
    }
  };

  const startPolling = (pollRunId: string) => {
    if (pollingInterval) clearInterval(pollingInterval);
    const token = ++pollingTokenRef.current;

    const interval = setInterval(async () => {
      if (token !== pollingTokenRef.current) return;
      try {
        const data = await trainerApi.getProgress(pollRunId);
        ingestProgressForActivity(data);
        setTrainerProgress(data);
        useRunsStore.getState().updateRun(pollRunId, {
          status:
            data.status === "done" ? "succeeded" : data.status === "failed" ? "failed" : data.status,
          progress: data.progress?.percent
            ? normalizePct(data.progress.percent) / 100
            : 0,
          stage: data.progress?.phase || "running",
          message: data.progress?.message || data.progress?.phase || "Running",
        });

        requestAnimationFrame(() => {
          const el = logRef.current;
          if (el && stickLogBottomRef.current) el.scrollTop = el.scrollHeight;
        });

        if (data.status === "done" || data.status === "failed" || data.status === "cancelled") {
          clearInterval(interval);
          setPollingInterval(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setTrainerProgress((prev) =>
            prev
              ? {
                  ...prev,
                  status: "failed",
                  progress: { phase: "stale", percent: 0, message: "Run not found (stale)" },
                }
              : prev
          );
          useRunsStore.getState().updateRun(pollRunId, {
            status: "failed",
            progress: 0,
            stage: "stale",
            message: "Run not found (stale)",
          });
        } else {
          console.error("Polling error:", err);
        }
        clearInterval(interval);
        setPollingInterval(null);
      }
    }, 2000);

    setPollingInterval(interval);
  };

  const startAnalysisPolling = (aidRunId: string, aid: string) => {
    const token = ++analysisPollingTokenRef.current;
    const interval = setInterval(async () => {
      if (token !== analysisPollingTokenRef.current) return;
      try {
        const data = await trainerApi.getAnalysisStatus(aidRunId, aid);
        setAnalysisStatus(data);
        const analysisRunId = `${aidRunId}_${aid}`;
        useRunsStore.getState().updateRun(analysisRunId, {
          status:
            data.status === "done" ? "succeeded" : data.status === "failed" ? "failed" : data.status,
          progress: data.progress?.percent
            ? normalizePct(data.progress.percent) / 100
            : 0,
          stage: data.progress?.phase || "running",
          message: data.progress?.message || data.progress?.phase || "Running",
        });

        if (data.status === "done" || data.status === "failed") {
          clearInterval(interval);
          if (data.status === "done") pushActivity("analysis · complete");
        }
      } catch (err) {
        console.error("Analysis polling error:", err);
        clearInterval(interval);
      }
    }, 2000);
  };

  const handleDownloadModel = async () => {
    if (!runId) return;
    try {
      await trainerApi.downloadModel(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download model");
    }
  };

  const handleDownloadAnalysis = async () => {
    if (!runId || !analysisId) return;
    try {
      await trainerApi.downloadAnalysis(runId, analysisId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download analysis zip");
    }
  };

  useEffect(() => {
    void useRunsStore.getState().mergeRunsFromBackendList(200);
  }, []);

  useEffect(() => {
    const rid = searchParams.get("runId");
    if (!rid) return;
    const run = useRunsStore.getState().runsById[rid];
    if (run?.tool !== "trainer") return;
    if (run.status === "running" || run.status === "queued") {
      setRunId(rid);
      startPolling(rid);
    }
  }, [searchParams]);

  useEffect(() => {
    const checkExistingRuns = () => {
      const activeRuns = useRunsStore.getState().activeRunIds;
      const byId = useRunsStore.getState().runsById;

      const activeTrainerRun = activeRuns.find((id) => {
        const run = byId[id];
        return run && run.tool === "trainer";
      });

      if (activeTrainerRun && byId[activeTrainerRun]) {
        const run = byId[activeTrainerRun];
        setRunId(run.id);

        if (run.status === "running" && !pollingInterval) {
          startPolling(run.id);
        }
      }
    };

    checkExistingRuns();
    const unsubscribe = useRunsStore.subscribe(() => {
      checkExistingRuns();
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  useEffect(() => {
    if (trainerProgress?.status !== "running") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [trainerProgress?.status]);

  const telemetry = trainerProgress?.telemetry;
  const wallMs =
    telemetry?.wall_elapsed_seconds != null
      ? telemetry.wall_elapsed_seconds * 1000
      : wallStartRef.current != null
        ? performance.now() - wallStartRef.current
        : null;

  const plannedEp = trainerProgress?.progress?.epochs ?? config.epochs ?? 30;
  const currentEp = trainerProgress?.progress?.epoch ?? telemetry?.completed_epochs ?? 0;

  let estRemainingMs: number | null = null;
  if (telemetry?.estimated_remaining_seconds != null && telemetry.estimated_remaining_seconds >= 0) {
    estRemainingMs = telemetry.estimated_remaining_seconds * 1000;
  } else if (currentEp >= 1 && plannedEp > currentEp) {
    const marks = epochMarkRef.current;
    if (marks.length >= 2) {
      const span = marks[marks.length - 1] - marks[0];
      const avg = span / (marks.length - 1);
      estRemainingMs = avg * (plannedEp - currentEp);
    } else if (marks.length === 1 && wallStartRef.current != null) {
      const firstEpochDur = marks[0] - wallStartRef.current;
      estRemainingMs = firstEpochDur * (plannedEp - currentEp);
    }
  }
  void tick;

  const pct = normalizePct(trainerProgress?.progress?.percent);
  const logLines =
    trainerProgress?.log_lines && trainerProgress.log_lines.length > 0
      ? trainerProgress.log_lines
      : activityFeed;

  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stickLogBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const fmtMetric = (v: number | undefined, decimals: number) =>
    v != null && Number.isFinite(v) ? v.toFixed(decimals) : "—";

  const fieldClass =
    "w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50";

  const InputPanel = (
    <div className="space-y-6">
      <div>
        <label className="block text-sm text-[#F5F5F5]/62 mb-2">
          Training dataset <span className="text-[#e5e5e5]">*</span>
        </label>
        <p className="mb-3 text-xs leading-relaxed text-[#F5F5F5]/52">
          The <strong className="text-white/75">latest completed</strong> chart generator ZIP is registered as your
          default training set automatically. Use the dropdown to switch runs, or drop a ZIP in the upload area
          below—only that field shows a manual file; it overrides the generator dataset for this session when present.
        </p>
        {chartGenRunsWithZip.length > 0 ? (
          <div className="mb-3 space-y-2">
            <label className="block text-xs font-medium text-white/55">Load dataset from generator run</label>
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
              <button
                type="button"
                className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/15"
                onClick={() => {
                  loadedGeneratorRunIdRef.current = null;
                  setPreferredGeneratorRunId(null);
                }}
              >
                Use latest
              </button>
              <Link
                to="/tools/run-log"
                className="text-xs text-sky-300/90 underline-offset-2 hover:text-sky-200 hover:underline"
              >
                Run log
              </Link>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-amber-200/85">
            No completed chart generator run with a ZIP in this workspace yet—generate one first, or upload a ZIP
            below.
          </p>
        )}
        {effectiveGeneratorRun ? (
          <p className="mb-2 font-mono text-[11px] text-white/55">
            Default ZIP run: {effectiveGeneratorRun.id}
            {generatorDataset && !ingestingGenZip ? (
              <span className="ml-2 text-white/40">
                · {generatorDataset.summary.total_images} images on server
                {manualUploadedDataset ? " (manual ZIP overrides for training)" : ""}
              </span>
            ) : null}
          </p>
        ) : null}
        {ingestingGenZip ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white/70">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Importing generator ZIP…
          </div>
        ) : null}
        <label className="mb-2 block text-xs font-medium text-white/55">Upload your own ZIP (optional)</label>
        <DatasetUploader
          onDatasetUploaded={(dataset) => {
            setManualUploadedDataset(dataset);
            setError(null);
          }}
          onDatasetRemoved={() => setManualUploadedDataset(null)}
          uploadedDataset={manualUploadedDataset}
        />
      </div>

      <div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.use_standard_config}
            onChange={(e) => setConfig({ ...config, use_standard_config: e.target.checked })}
            className="w-4 h-4 text-white bg-[#0a0a0a] border-white/30 rounded focus:ring-white focus:ring-2"
          />
          <span className="text-[#F5F5F5]/80 text-sm">
            Use standard configuration (224×224, batch 16, 30 epochs)
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Training Folder{" "}
            {trainingDataset ? (
              <span className="text-[#F5F5F5]/40">(dataset id from active training set)</span>
            ) : (
              <span className="text-[#e5e5e5]">*</span>
            )}
          </label>
          <input
            type="text"
            value={
              trainingDataset
                ? datasetsById[trainingDataset.dataset_id]?.name || `Dataset ${trainingDataset.dataset_id.slice(-8)}`
                : config.folder_name
            }
            onChange={(e) => setConfig({ ...config, folder_name: e.target.value })}
            disabled={!!trainingDataset}
            placeholder={trainingDataset ? "" : "e.g., /path/to/training/images"}
            className={`${fieldClass} ${trainingDataset ? "opacity-60 cursor-not-allowed" : ""}`}
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">
            {trainingDataset
              ? `${trainingDataset.summary.total_images} images in the active training set`
              : "Path to folder containing labeled PNG images"}
          </p>
        </div>

        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Model Name <span className="text-[#e5e5e5]">*</span>
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
          <p className="text-xs text-[#F5F5F5]/50 mt-1">The .keras extension is added automatically.</p>
        </div>
      </div>

      {!config.use_standard_config && (
        <div className="space-y-3 p-4 rounded-xl bg-[#05060B]/75 border border-white/[0.07]">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#F5F5F5]/50">
            Hyperparameters
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-[11px] text-[#F5F5F5]/45">Image height</label>
              <input
                type="number"
                min="32"
                max="1024"
                value={config.image_height}
                onChange={(e) => setConfig({ ...config, image_height: parseInt(e.target.value, 10) || 224 })}
                className={`mt-1 ${fieldClass} font-mono text-sm`}
              />
            </div>
            <div>
              <label className="text-[11px] text-[#F5F5F5]/45">Image width</label>
              <input
                type="number"
                min="32"
                max="1024"
                value={config.image_width}
                onChange={(e) => setConfig({ ...config, image_width: parseInt(e.target.value, 10) || 224 })}
                className={`mt-1 ${fieldClass} font-mono text-sm`}
              />
            </div>
            <div>
              <label className="text-[11px] text-[#F5F5F5]/45">Batch size</label>
              <input
                type="number"
                min="1"
                value={config.batch_size}
                onChange={(e) => setConfig({ ...config, batch_size: parseInt(e.target.value, 10) || 16 })}
                className={`mt-1 ${fieldClass} font-mono text-sm`}
              />
            </div>
            <div>
              <label className="text-[11px] text-[#F5F5F5]/45">Epochs</label>
              <input
                type="number"
                min="1"
                value={config.epochs}
                onChange={(e) => setConfig({ ...config, epochs: parseInt(e.target.value, 10) || 30 })}
                className={`mt-1 ${fieldClass} font-mono text-sm`}
              />
            </div>
            <div>
              <label className="text-[11px] text-[#F5F5F5]/45">Validation split</label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="0.45"
                value={config.val_split}
                onChange={(e) => setConfig({ ...config, val_split: parseFloat(e.target.value) || 0.2 })}
                className={`mt-1 ${fieldClass} font-mono text-sm`}
              />
            </div>
            <div>
              <label className="text-[11px] text-[#F5F5F5]/45">Random seed</label>
              <input
                type="number"
                value={config.random_seed}
                onChange={(e) => setConfig({ ...config, random_seed: parseInt(e.target.value, 10) || 7 })}
                className={`mt-1 ${fieldClass} font-mono text-sm`}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-[#f87171]/10 border border-[#f87171]/20 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 text-[#f87171] mt-0.5 shrink-0">⚠️</div>
            <div>
              <h4 className="text-sm font-semibold text-[#f87171] mb-1">Configuration Error</h4>
              <p className="text-sm text-[#F5F5F5]/80">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={handleStartTraining}
          disabled={trainerProgress?.status === "running"}
          className="w-full px-6 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg hover:shadow-lg hover:shadow-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
        >
          <Play className="w-4 h-4" />
          {trainerProgress?.status === "running" ? "Training in progress…" : "Start training"}
        </button>
        {trainerProgress?.status === "running" && (
          <button
            type="button"
            onClick={handleCancelTraining}
            disabled={isCancelling}
            className="w-full px-6 py-3 bg-transparent border border-[#F59E0B]/55 text-[#F59E0B] font-medium rounded-lg hover:bg-[#F59E0B]/10 transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
          >
            <XCircle className="w-4 h-4" />
            {isCancelling ? "Cancelling…" : "Cancel run"}
          </button>
        )}
      </div>
    </div>
  );

  const OutputPanel = (
    <div className="rounded-xl border border-white/[0.08] bg-[#05060B]/92 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {!trainerProgress && (
        <div className="px-6 py-14 text-center text-sm text-[#F5F5F5]/45">
          Start a run to open the training console — telemetry, curves, and activity stream here.
        </div>
      )}

      {trainerProgress && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-white/[0.06] bg-[#0a0a0a]/55">
            <Activity className="w-3.5 h-3.5 text-white shrink-0" />
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                trainerProgress.status === "running"
                  ? "bg-white/22 text-[#D4C8FF]"
                  : trainerProgress.status === "done"
                    ? "bg-[#e5e5e5]/16 text-[#fafafa]"
                    : trainerProgress.status === "cancelled"
                      ? "bg-[#F59E0B]/16 text-[#FCD34D]"
                      : "bg-[#f87171]/16 text-[#F9A8D4]"
              }`}
            >
              {trainerProgress.status === "running"
                ? "RUNNING"
                : trainerProgress.status === "done"
                  ? "COMPLETE"
                  : trainerProgress.status === "cancelled"
                    ? "CANCELLED"
                    : "FAILED"}
            </span>
            {runId && (
              <span className="text-[10px] font-mono text-[#F5F5F5]/38">run_{runId.slice(-12)}</span>
            )}
            <span className="text-[11px] text-[#F5F5F5]/55">
              {trainerProgress.progress.epoch != null && trainerProgress.progress.epochs != null
                ? `epoch ${trainerProgress.progress.epoch} / ${trainerProgress.progress.epochs}`
                : trainerProgress.progress.phase}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-[#F5F5F5]/62">
              <span>
                elapsed{" "}
                <span className="text-[#F5F5F5]/90">
                  {wallMs != null ? formatDurationMs(wallMs) : "—"}
                </span>
              </span>
              {trainerProgress.status === "running" && currentEp >= 1 && estRemainingMs != null && (
                <>
                  <span className="text-white/15">|</span>
                  <span>
                    ~remain{" "}
                    <span className="text-[#a3a3a3]">{formatDurationMs(estRemainingMs)}</span>
                  </span>
                </>
              )}
            </div>
          </div>

          {trainerProgress.status === "running" && (
            <div className="px-4 py-3 border-b border-white/[0.05]">
              <div className="flex justify-between text-[10px] text-[#F5F5F5]/48 mb-1 font-mono">
                <span className="truncate pr-2">{trainerProgress.progress.message}</span>
                <span>{pct.toFixed(1)}%</span>
              </div>
              <div className="h-1 rounded-full bg-[#0a0a0a] overflow-hidden">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-500"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          )}

          {(trainerProgress.status === "running" || trainerProgress.status === "done") && (
            <div className="px-4 py-4 border-b border-white/[0.05] space-y-4">
              {trainerProgress.last_metrics && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.06]">
                  {(
                    [
                      ["train acc", trainerProgress.last_metrics.accuracy, 4, "#F5F5F5"],
                      ["val acc", trainerProgress.last_metrics.val_accuracy, 4, "#a3a3a3"],
                      ["train loss", trainerProgress.last_metrics.loss, 4, "rgba(245,247,255,0.78)"],
                      ["val loss", trainerProgress.last_metrics.val_loss, 4, "#E879F9"],
                    ] as const
                  ).map(([label, val, dec, color]) => (
                    <div
                      key={label}
                      className="bg-[#0a0a0a]/96 px-3 py-2.5 min-h-[3rem] flex flex-col justify-center"
                    >
                      <span className="text-[9px] uppercase tracking-[0.12em] text-[#F5F5F5]/35">
                        {label}
                      </span>
                      <span
                        className="text-[13px] font-mono tabular-nums leading-tight mt-0.5"
                        style={{ color }}
                      >
                        {fmtMetric(val, dec)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {chartData.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[#F5F5F5]/40">
                    Training telemetry
                  </div>
                  <div className="h-[130px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="epoch" tick={{ fill: "rgba(245,247,255,0.35)", fontSize: 10 }} />
                        <YAxis
                          domain={[0, 1]}
                          tick={{ fill: "rgba(245,247,255,0.35)", fontSize: 10 }}
                          width={26}
                        />
                        <Tooltip contentStyle={chartTip} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Line
                          type="monotone"
                          dataKey="accuracy"
                          name="train acc"
                          stroke="#F5F5F5"
                          strokeWidth={1.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="val_accuracy"
                          name="val acc"
                          stroke="#e5e5e5"
                          strokeWidth={1.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-[130px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="epoch" tick={{ fill: "rgba(245,247,255,0.35)", fontSize: 10 }} />
                        <YAxis tick={{ fill: "rgba(245,247,255,0.35)", fontSize: 10 }} width={26} />
                        <Tooltip contentStyle={chartTip} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Line
                          type="monotone"
                          dataKey="loss"
                          name="train loss"
                          stroke="rgba(245,247,255,0.82)"
                          strokeWidth={1.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="val_loss"
                          name="val loss"
                          stroke="#E879F9"
                          strokeWidth={1.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-white/[0.05] bg-[#020308]/85">
            <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.05]">
              <span className="text-[10px] uppercase tracking-[0.16em] text-[#F5F5F5]/42 flex items-center gap-2">
                <Terminal className="w-3 h-3 opacity-60" />
                {trainerProgress.log_lines?.length ? "Runner log" : "Activity"}
              </span>
            </div>
            <div
              ref={logRef}
              onScroll={onLogScroll}
              className="h-[200px] overflow-y-auto px-3 py-2 font-mono text-[10px] leading-relaxed text-[#94A3B8] selection:bg-white/28"
            >
              {(logLines.length ? logLines : ["— waiting for events —"]).map((line, i) => (
                <div key={`${i}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-all py-0.5">
                  {line}
                </div>
              ))}
            </div>
          </div>

          {trainerProgress.status === "done" && (
            <div className="p-4 space-y-4 border-t border-white/[0.05]">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownloadModel}
                  className="flex-1 min-w-[140px] px-4 py-2.5 text-sm rounded-lg bg-white text-[#0a0a0a] font-medium"
                >
                  <Download className="w-4 h-4 inline mr-2 -mt-0.5" />
                  Download model
                </button>
                <button
                  type="button"
                  onClick={handleStartAnalysis}
                  disabled={analysisStatus?.status === "running"}
                  className="flex-1 min-w-[140px] px-4 py-2.5 text-sm rounded-lg border border-[#E879F9]/42 text-[#E879F9] hover:bg-[#E879F9]/10 disabled:opacity-50"
                >
                  <Eye className="w-4 h-4 inline mr-2 -mt-0.5" />
                  {analysisStatus?.status === "running" ? "Analyzing…" : "Visual analysis"}
                </button>
              </div>

              {analysisStatus && (
                <div className="rounded-lg border border-white/10 p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#F5F5F5]/60">Analysis</span>
                    <span className="text-xs font-mono text-[#F5F5F5]/45">{analysisStatus.status}</span>
                  </div>
                  {analysisStatus.status === "running" && (
                    <div className="h-1 bg-[#0a0a0a] rounded overflow-hidden">
                      <div
                        className="h-full bg-[#E879F9]/75 transition-all"
                        style={{ width: `${normalizePct(analysisStatus.progress.percent)}%` }}
                      />
                    </div>
                  )}
                  {analysisStatus.status === "done" && analysisId && (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadAnalysis}
                        className="w-full py-2 rounded-lg bg-[#E879F9]/18 text-[#F9A8D4] text-xs"
                      >
                        Download analysis ZIP
                      </button>
                      <Link
                        to={`/products/trainer/analysis/${runId}/${analysisId}`}
                        className="block text-center py-2 rounded-lg border border-white/14 text-[#F5F5F5]/80 text-xs"
                      >
                        Advanced visuals
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTrainerProgress(null);
                    setRunId(null);
                    setAnalysisStatus(null);
                    setAnalysisId(null);
                    setError(null);
                    setActivityFeed([]);
                    wallStartRef.current = null;
                    epochMarkRef.current = [];
                    lastEpochRef.current = 0;
                    lastProgressKeyRef.current = "";
                  }}
                  className="flex-1 py-2.5 text-sm border border-white/16 rounded-lg text-[#F5F5F5]/85"
                >
                  <RotateCcw className="w-4 h-4 inline mr-2" />
                  New run
                </button>
                <Link to="/tools/backtester" className="flex-1">
                  <button
                    type="button"
                    className="w-full py-2.5 text-sm border border-white/16 rounded-lg text-[#F5F5F5]/85"
                  >
                    <ArrowRight className="w-4 h-4 inline mr-2" />
                    Backtester
                  </button>
                </Link>
              </div>
            </div>
          )}

          {trainerProgress.status === "failed" && (
            <div className="p-4 border-t border-[#f87171]/18 text-sm">
              <p className="text-[#F9A8D4] mb-2 font-medium text-xs uppercase tracking-wide">Failed</p>
              <p className="font-mono text-xs text-[#F5F5F5]/75">
                {trainerProgress.progress.message || "Unknown error."}
              </p>
              <button
                type="button"
                onClick={() => {
                  setTrainerProgress(null);
                  setRunId(null);
                  setError(null);
                  setActivityFeed([]);
                }}
                className="mt-3 text-xs text-white"
              >
                Dismiss
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ToolLayout
        title="Trainer"
        description="CNN training console — live curves and activity from the existing status stream."
        contentMaxWidthClass="w-full max-w-none"
        outputPlacement="integrated"
        integratedOutputWide
        inputPanel={InputPanel}
        outputPanel={OutputPanel}
      />
    </div>
  );
}
