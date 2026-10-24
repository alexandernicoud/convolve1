import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  Play,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useRunsStore } from "@/state/runsStore";
import { confirmRun, chargeRunCredits } from "@/state/creditsStore";
import { RunCost, RunCostHint } from "@/components/RunCostHint";
import {
  realtimeBacktesterApi,
  testDataGeneratorApi,
  internalModelsApi,
  datasetsApi,
  getTrainerModelMetadata,
  getUploadedModelMetadata,
  type InternalModel,
  type DatasetListItem,
  type BacktestStatusResponse,
  type BacktestDatasetCapabilities,
  type BacktestRunRequest,
  type TestDataGeneratorStatusResponse,
  type TestDataGeneratorResultResponse,
  type GlobalRun,
  type ModelTrainingMetadata,
} from "@/lib/api";
import ModelUploader from "@/components/ModelUploader";
import DatasetUploader from "@/components/DatasetUploader";
import TestDataGeneratorModal from "@/components/TestDataGeneratorModal";
import RecentRunsBlock from "@/components/RecentRunsBlock";
import FieldTip from "@/components/generator/FieldTip";
import StepSection from "@/components/generator/StepSection";

type SourceMode = "library" | "upload";

/** Free-typed numeric field — no min/max HTML clamps; commits on blur / Enter. */
function FreeNumberField({
  value,
  onChange,
  className,
  step,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  step?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const cleaned = text.trim().replace(",", ".");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") {
      setText(String(value));
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    onChange(n);
    setText(String(n));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
}
interface UploadedModel {
  model_id: string;
  storage_key: string;
  absolute_path: string;
  original_filename: string;
  byte_size: number;
  content_type: string;
  saved_at: string;
  filename: string;
  size: number;
  uploaded_at: string;
  metadata_matched?: boolean;
  matched_training_run_id?: string | null;
  matched_model_name?: string | null;
  matched_metadata?: Record<string, unknown> | null;
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

interface BacktesterConfig {
  modelId?: string;
  datasetId?: string;
  sampleSize: string | number;
  confidenceThreshold: number;
  tpPct: number;
  slPct: number;
  imgSize: number;
  startingCapital: number;
  positionSizePct: number;
  commissionPct: number;
  slippagePct: number;
  maxDrawdownPct: number;
  thresholdMode: "fixed" | "validation";
  maxExposurePct: number;
  maxConcurrentPositions: number;
}

function formatRunStamp(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
}

function runLabel(run: GlobalRun): string {
  const short = run.id.slice(-8);
  const msg = run.message?.slice(0, 48);
  return msg ? `${short} · ${msg}` : short;
}

export default function Backtester() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { registerRun } = useRunsStore();
  const runsById = useRunsStore((s) => s.runsById);

  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);
  const [internalModels, setInternalModels] = useState<InternalModel[]>([]);
  const [selectedInternalModel, setSelectedInternalModel] = useState<InternalModel | null>(null);
  const [activityTrainerRunId, setActivityTrainerRunId] = useState("");
  const [activityTestdataRunId, setActivityTestdataRunId] = useState("");
  /** Exclusive input path: library (pick + generate) vs local upload. */
  const [sourceMode, setSourceMode] = useState<SourceMode>("library");
  const [modelMetadata, setModelMetadata] = useState<ModelTrainingMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [applyingTrainingParams, setApplyingTrainingParams] = useState(false);
  /** Pick a library model just to copy TP/SL/img — does not change the backtest model. */
  const [showParamsSourcePicker, setShowParamsSourcePicker] = useState(false);
  const [paramsSourceKey, setParamsSourceKey] = useState("");
  const [paramsSourceLabel, setParamsSourceLabel] = useState<string | null>(null);
  const [paramsSourceError, setParamsSourceError] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<BacktestStatusResponse | null>(null);
  const [runLogs, setRunLogs] = useState<string>("");
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const pollingTokenRef = useRef(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [uploadedDataset, setUploadedDataset] = useState<UploadedDataset | null>(null);
  /** Tracks whether the active dataset came from a local ZIP upload (keeps the uploader chip). */
  const [datasetFromUpload, setDatasetFromUpload] = useState(false);
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [pickedDatasetId, setPickedDatasetId] = useState("");
  const [isTestDataModalOpen, setIsTestDataModalOpen] = useState(false);
  const [showTestDataBanner, setShowTestDataBanner] = useState(false);
  const [testDataBannerMessage, setTestDataBannerMessage] = useState("");
  const [testDataRunId, setTestDataRunId] = useState<string | null>(null);
  const [testDataStatus, setTestDataStatus] = useState<TestDataGeneratorStatusResponse | null>(null);
  const [testDataResult, setTestDataResult] = useState<TestDataGeneratorResultResponse | null>(null);
  const [testDataError, setTestDataError] = useState<string | null>(null);

  const [config, setConfig] = useState<BacktesterConfig>({
    sampleSize: "all",
    confidenceThreshold: 0.5,
    tpPct: 2.0,
    slPct: 2.0,
    imgSize: 224,
    startingCapital: 10000,
    positionSizePct: 10.0,
    commissionPct: 0.1,
    slippagePct: 0.05,
    maxDrawdownPct: 20.0,
    thresholdMode: "validation",
    maxExposurePct: 100,
    maxConcurrentPositions: 10,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datasetCaps, setDatasetCaps] = useState<BacktestDatasetCapabilities | null>(null);
  const [datasetCapsError, setDatasetCapsError] = useState<string | null>(null);

  const fieldClass =
    "w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/50";
  const labelClass = "mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75";

  const trainerRunsFromActivity = useMemo(
    () =>
      Object.values(runsById)
        .filter((r) => r.tool === "trainer" && r.status === "succeeded")
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        .slice(0, 40),
    [runsById],
  );

  const testdataRunsFromActivity = useMemo(
    () =>
      Object.values(runsById)
        .filter((r) => r.tool === "testdata" && r.status === "succeeded")
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        .slice(0, 40),
    [runsById],
  );

  const loadDatasets = useCallback(async () => {
    try {
      const { datasets: rows } = await datasetsApi.list();
      setDatasets(rows.filter((d) => !d.archived));
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  const applyDatasetSelection = useCallback(
    (datasetId: string, extras?: { total_images?: number; example_filenames?: string[] }) => {
      if (!datasetId) {
        setUploadedDataset(null);
        setPickedDatasetId("");
        setDatasetFromUpload(false);
        setConfig((prev) => ({ ...prev, datasetId: undefined }));
        return;
      }
      const row = datasets.find((d) => d.dataset_id === datasetId);
      setPickedDatasetId(datasetId);
      setDatasetFromUpload(false);
      setUploadedDataset({
        dataset_id: datasetId,
        extracted_path: `backend/datasets/${datasetId}/images`,
        summary: {
          total_images: extras?.total_images ?? row?.total_images ?? 0,
          label_distribution: {},
          example_filenames: extras?.example_filenames ?? row?.example_filenames ?? [],
        },
      });
      setConfig((prev) => ({ ...prev, datasetId }));
    },
    [datasets],
  );

  const applyDatasetAsTestSet = useCallback(
    (result: TestDataGeneratorResultResponse) => {
      applyDatasetSelection(result.dataset_id, {
        total_images: result.summary?.total_images ?? 0,
      });
      void loadDatasets();
    },
    [applyDatasetSelection, loadDatasets],
  );

  useEffect(() => {
    void useRunsStore.getState().mergeRunsFromBackendList(200);
  }, []);

  // Load model registry + deep-link modelRunId / modelId
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { models } = await internalModelsApi.list();
        if (cancelled) return;
        setInternalModels(models.filter((m) => !m.archived));
        const wantedRun = searchParams.get("modelRunId");
        const wantedModel = searchParams.get("modelId");
        if (wantedRun) {
          const match = models.find((m) => m.kind === "trained" && m.training_run_id === wantedRun);
          if (match) {
            setSourceMode("library");
            setSelectedInternalModel(match);
            setUploadedModel(null);
            setActivityTrainerRunId(wantedRun);
          } else {
            setSourceMode("library");
            setSelectedInternalModel({
              model_id: wantedRun,
              kind: "trained",
              training_run_id: wantedRun,
              name: `Trainer run ${wantedRun.slice(-8)}`,
              metadata_available: false,
            });
            setUploadedModel(null);
            setActivityTrainerRunId(wantedRun);
          }
        } else if (wantedModel) {
          const match = models.find((m) => m.model_id === wantedModel);
          if (match) {
            setSourceMode("library");
            setSelectedInternalModel(match);
            setUploadedModel(null);
          }
        }
      } catch (e) {
        console.warn("Failed to load internal model list:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link datasetId once the registry is available
  useEffect(() => {
    const wanted = searchParams.get("datasetId");
    if (!wanted || datasets.length === 0) return;
    if (pickedDatasetId === wanted) return;
    applyDatasetSelection(wanted);
  }, [searchParams, datasets, pickedDatasetId, applyDatasetSelection]);

  useEffect(() => {
    const q = searchParams.get("runId");
    if (!q) return;
    const run = useRunsStore.getState().runsById[q];
    if (run?.tool === "backtester" && (run.status === "running" || run.status === "queued")) {
      setCurrentRunId(q);
    }
    if (run?.tool === "testdata") {
      setTestDataRunId(q);
      setActivityTestdataRunId(q);
    }
  }, [searchParams]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [runLogs]);

  useEffect(() => {
    if (!currentRunId) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    const pollStatus = async () => {
      try {
        const status = await realtimeBacktesterApi.getStatus(currentRunId);
        failures = 0;
        setRunStatus(status);
        setRunLogs(status.log_tail);
        useRunsStore.getState().updateRun(currentRunId, {
          status: status.status === "interrupted" || status.status === "cancelled" ? "failed" : status.status,
          progress: status.progress,
          stage: status.status || "running",
          message: status.message || "Running",
        });

        const terminal = status.terminal ?? ["succeeded", "failed", "cancelled", "interrupted"].includes(status.status);
        if (terminal && interval) clearInterval(interval);
        if (status.status === "succeeded") {
          navigate(`/tools/backtester/runs/${currentRunId}`);
        }
      } catch (err) {
        console.warn("Backtest status poll failed:", err);
        failures += 1;
        if (failures >= 5 && interval) {
          clearInterval(interval);
          setError("Lost contact with the server while polling this backtest. Open it from Recent backtests to check its status.");
        }
      }
    };

    void pollStatus();
    const token = ++pollingTokenRef.current;
    interval = setInterval(pollStatus, 1000);
    setPollingInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
      if (token === pollingTokenRef.current) {
        pollingTokenRef.current += 1;
      }
    };
  }, [currentRunId, navigate]);

  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  const handleModelUploaded = (model: UploadedModel) => {
    setSourceMode("upload");
    setUploadedModel(model);
    setSelectedInternalModel(null);
    setActivityTrainerRunId("");
    setConfig((prev) => ({ ...prev, modelId: model.model_id }));
    setError(null);
  };

  const handleModelRemoved = () => {
    setUploadedModel(null);
    setModelMetadata(null);
    setConfig((prev) => ({ ...prev, modelId: undefined }));
  };

  const selectInternalModel = (model: InternalModel | null) => {
    setSelectedInternalModel(model);
    if (model) {
      setSourceMode("library");
      setUploadedModel(null);
      setConfig((prev) => ({ ...prev, modelId: undefined }));
      if (model.kind === "trained" && model.training_run_id) {
        setActivityTrainerRunId(model.training_run_id);
      } else if (model.kind === "trained") {
        setActivityTrainerRunId(model.model_id);
      } else {
        setActivityTrainerRunId("");
      }
    }
  };

  const switchSourceMode = (mode: SourceMode) => {
    if (mode === sourceMode) return;
    setSourceMode(mode);
    setError(null);
    if (mode === "library") {
      setUploadedModel(null);
      if (datasetFromUpload) {
        setUploadedDataset(null);
        setPickedDatasetId("");
        setDatasetFromUpload(false);
        setActivityTestdataRunId("");
        setConfig((prev) => ({ ...prev, datasetId: undefined, modelId: undefined }));
      } else {
        setConfig((prev) => ({ ...prev, modelId: undefined }));
      }
    } else {
      setSelectedInternalModel(null);
      setActivityTrainerRunId("");
      setModelMetadata(null);
      setMetadataError(null);
      if (!datasetFromUpload) {
        setUploadedDataset(null);
        setPickedDatasetId("");
        setActivityTestdataRunId("");
        setConfig((prev) => ({ ...prev, datasetId: undefined }));
      }
    }
  };

  const resolveMetadataForKey = useCallback(async (key: string): Promise<ModelTrainingMetadata | null> => {
    if (!key) return null;
    if (key.startsWith("trainer:")) {
      return getTrainerModelMetadata(key.slice("trainer:".length));
    }
    if (key.startsWith("uploaded:")) {
      return getUploadedModelMetadata(key.slice("uploaded:".length));
    }
    if (key === "active-uploaded" && uploadedModel?.model_id) {
      return getUploadedModelMetadata(uploadedModel.model_id);
    }
    if (key === "active-library" && selectedInternalModel) {
      if (selectedInternalModel.kind === "trained") {
        return getTrainerModelMetadata(
          selectedInternalModel.training_run_id || selectedInternalModel.model_id,
        );
      }
      return getUploadedModelMetadata(selectedInternalModel.model_id);
    }
    return null;
  }, [uploadedModel, selectedInternalModel]);

  const resolveModelMetadata = useCallback(async (): Promise<ModelTrainingMetadata | null> => {
    if (selectedInternalModel?.kind === "trained") {
      const runId = selectedInternalModel.training_run_id || selectedInternalModel.model_id;
      return getTrainerModelMetadata(runId);
    }
    if (selectedInternalModel?.kind === "uploaded") {
      return getUploadedModelMetadata(selectedInternalModel.model_id);
    }
    if (uploadedModel?.model_id) {
      return getUploadedModelMetadata(uploadedModel.model_id);
    }
    return null;
  }, [selectedInternalModel, uploadedModel]);

  useEffect(() => {
    let cancelled = false;
    const hasTarget = Boolean(selectedInternalModel || uploadedModel);
    if (!hasTarget) {
      setModelMetadata(null);
      setMetadataError(null);
      return;
    }
    setMetadataLoading(true);
    setMetadataError(null);
    void (async () => {
      try {
        const meta = await resolveModelMetadata();
        if (cancelled) return;
        setModelMetadata(meta);
        if (!meta) setMetadataError("No training metadata found for this model.");
      } catch (e) {
        if (cancelled) return;
        setModelMetadata(null);
        setMetadataError(e instanceof Error ? e.message : "Could not load training metadata");
      } finally {
        if (!cancelled) setMetadataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedInternalModel, uploadedModel, resolveModelMetadata]);

  const applyMetaToConfig = (meta: ModelTrainingMetadata) => {
    setModelMetadata(meta);
    setConfig((prev) => ({
      ...prev,
      ...(meta.takeProfitFraction != null ? { tpPct: meta.takeProfitFraction * 100 } : {}),
      ...(meta.stopLossFraction != null ? { slPct: meta.stopLossFraction * 100 } : {}),
      ...(meta.imageDimension != null ? { imgSize: meta.imageDimension } : {}),
    }));
  };

  // After upload: if filename matched a Convolve training name, take over TP/SL/img automatically.
  useEffect(() => {
    if (!uploadedModel?.metadata_matched || !uploadedModel.matched_training_run_id) return;
    const runId = uploadedModel.matched_training_run_id;
    const label =
      uploadedModel.matched_model_name ||
      uploadedModel.original_filename ||
      runId;
    setParamsSourceKey(`trainer:${runId}`);
    setParamsSourceLabel(label);
    setShowParamsSourcePicker(false);
    setParamsSourceError(null);

    const embedded = uploadedModel.matched_metadata as ModelTrainingMetadata | null | undefined;
    if (
      embedded &&
      (embedded.takeProfitFraction != null ||
        embedded.stopLossFraction != null ||
        embedded.imageDimension != null)
    ) {
      applyMetaToConfig(embedded);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const meta = await getTrainerModelMetadata(runId);
        if (!cancelled) applyMetaToConfig(meta);
      } catch {
        /* user can still pick manually */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when the uploaded model id / match changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedModel?.model_id, uploadedModel?.matched_training_run_id]);

  const labelForParamsSourceKey = (key: string): string => {
    if (key === "active-uploaded" && uploadedModel) {
      return uploadedModel.original_filename || uploadedModel.model_id;
    }
    if (key === "active-library" && selectedInternalModel) {
      return (
        selectedInternalModel.display_name ||
        selectedInternalModel.name ||
        selectedInternalModel.model_id
      );
    }
    if (key.startsWith("trainer:")) {
      const id = key.slice("trainer:".length);
      const m = internalModels.find((x) => x.kind === "trained" && (x.training_run_id === id || x.model_id === id));
      return m?.display_name || m?.name || `Trainer · ${id.slice(-8)}`;
    }
    if (key.startsWith("uploaded:")) {
      const id = key.slice("uploaded:".length);
      const m = internalModels.find((x) => x.kind === "uploaded" && x.model_id === id);
      return m?.display_name || m?.name || `Uploaded · ${id.slice(-8)}`;
    }
    return key;
  };

  /** Open picker — upload path especially needs to look up a reference model. */
  const openTrainingParamsPicker = () => {
    setParamsSourceError(null);
    setShowParamsSourcePicker(true);
    // Prefer a sensible default selection
    if (!paramsSourceKey) {
      if (sourceMode === "library" && selectedInternalModel) {
        setParamsSourceKey("active-library");
      } else if (uploadedModel) {
        setParamsSourceKey("active-uploaded");
      } else if (internalModels[0]) {
        const m = internalModels[0];
        setParamsSourceKey(
          m.kind === "trained"
            ? `trainer:${m.training_run_id || m.model_id}`
            : `uploaded:${m.model_id}`,
        );
      }
    }
  };

  const applyTrainingParamsFromPicker = async () => {
    if (!paramsSourceKey) {
      setParamsSourceError("Pick the model whose training settings you want to copy.");
      return;
    }
    setApplyingTrainingParams(true);
    setParamsSourceError(null);
    setError(null);
    try {
      const meta = await resolveMetadataForKey(paramsSourceKey);
      if (!meta) {
        setParamsSourceError("No training metadata found for that model.");
        return;
      }
      if (
        meta.takeProfitFraction == null &&
        meta.stopLossFraction == null &&
        meta.imageDimension == null
      ) {
        setParamsSourceError("That model has metadata, but no TP / SL / image size to copy.");
        return;
      }
      applyMetaToConfig(meta);
      setParamsSourceLabel(labelForParamsSourceKey(paramsSourceKey));
      setShowParamsSourcePicker(false);
    } catch (e) {
      setParamsSourceError(e instanceof Error ? e.message : "Failed to load training parameters");
    } finally {
      setApplyingTrainingParams(false);
    }
  };
  const handleInternalModelSelected = (value: string) => {
    if (!value) {
      selectInternalModel(null);
      return;
    }
    const model = internalModels.find((m) => `${m.kind}:${m.model_id}` === value) ?? null;
    selectInternalModel(model);
    if (model?.kind === "trained" && !uploadedDataset && !pickedDatasetId) {
      setIsTestDataModalOpen(true);
    }
  };

  const handleActivityTrainerPicked = (runId: string) => {
    setActivityTrainerRunId(runId);
    if (!runId) return;
    const match = internalModels.find((m) => m.kind === "trained" && m.training_run_id === runId);
    if (match) {
      selectInternalModel(match);
    } else {
      selectInternalModel({
        model_id: runId,
        kind: "trained",
        training_run_id: runId,
        name: `Trainer run ${runId.slice(-8)}`,
        metadata_available: false,
      });
    }
    if (!uploadedDataset && !pickedDatasetId) {
      setIsTestDataModalOpen(true);
    }
  };

  const handleDatasetUploaded = (dataset: UploadedDataset) => {
    setSourceMode("upload");
    setUploadedDataset(dataset);
    setPickedDatasetId(dataset.dataset_id);
    setDatasetFromUpload(true);
    setActivityTestdataRunId("");
    setConfig((prev) => ({ ...prev, datasetId: dataset.dataset_id }));
    setError(null);
    void loadDatasets();
  };

  const handleDatasetRemoved = () => {
    setUploadedDataset(null);
    setPickedDatasetId("");
    setDatasetFromUpload(false);
    setActivityTestdataRunId("");
    setConfig((prev) => ({ ...prev, datasetId: undefined }));
  };
  const handleDatasetPicked = (datasetId: string) => {
    setActivityTestdataRunId("");
    applyDatasetSelection(datasetId);
  };

  const handleActivityTestdataPicked = async (runId: string) => {
    setActivityTestdataRunId(runId);
    if (!runId) return;
    setTestDataRunId(runId);
    setTestDataError(null);
    setTestDataResult(null);
    try {
      const result = await testDataGeneratorApi.getResult(runId);
      setTestDataResult(result);
      applyDatasetAsTestSet(result);
    } catch {
      // Fall back to polling if result isn't ready yet
      setTestDataBannerMessage("Loading test dataset from activity…");
      setShowTestDataBanner(true);
    }
  };

  const handleTestDataGenerationStarted = (runId: string) => {
    setTestDataRunId(runId);
    setTestDataResult(null);
    setTestDataStatus(null);
    setTestDataError(null);
    setTestDataBannerMessage("Generating test dataset…");
    setShowTestDataBanner(true);
  };

  useEffect(() => {
    if (!testDataRunId) return;

    let isActive = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const pollTestData = async () => {
      try {
        const status = await testDataGeneratorApi.getStatus(testDataRunId);
        if (!isActive) return;
        setTestDataStatus(status);
        useRunsStore.getState().updateRun(testDataRunId, {
          status: status.status,
          progress: status.progress,
          stage: status.stage || "running",
          message: status.message || "Running",
        });

        if (status.status === "succeeded") {
          const result = await testDataGeneratorApi.getResult(testDataRunId);
          if (!isActive) return;
          setTestDataResult(result);
          applyDatasetAsTestSet(result);
          setShowTestDataBanner(false);
          if (interval) clearInterval(interval);
        } else if (status.status === "failed") {
          setTestDataError(status.message || "Test data generation failed");
          setShowTestDataBanner(false);
          if (interval) clearInterval(interval);
        }
      } catch (err) {
        if (!isActive) return;
        setTestDataError(err instanceof Error ? err.message : "Failed to get test data status");
        setShowTestDataBanner(false);
        if (interval) clearInterval(interval);
      }
    };

    pollTestData();
    interval = setInterval(pollTestData, 1500);

    return () => {
      isActive = false;
      if (interval) clearInterval(interval);
    };
  }, [testDataRunId, applyDatasetAsTestSet]);

  const testFolders = datasets.filter((d) => d.kind === "test");
  const otherFolders = datasets.filter((d) => d.kind !== "test");
  const hasModel =
    sourceMode === "library" ? Boolean(selectedInternalModel) : Boolean(uploadedModel);
  const hasDataset = Boolean(uploadedDataset);
  const datasetIdForCaps = uploadedDataset?.dataset_id ?? null;
  useEffect(() => {
    setDatasetCaps(null);
    setDatasetCapsError(null);
    if (!datasetIdForCaps) return;
    let alive = true;
    realtimeBacktesterApi
      .getDatasetCapabilities(datasetIdForCaps)
      .then((c) => alive && setDatasetCaps(c))
      .catch((e) => alive && setDatasetCapsError(e instanceof Error ? e.message : "Could not read dataset capabilities"));
    return () => {
      alive = false;
    };
  }, [datasetIdForCaps]);
  const isV2 = datasetCaps?.engine === "v2";
  const labelDef = datasetCaps?.label_definition ?? null;

  const canRun = hasModel && hasDataset && !isSubmitting && (!datasetIdForCaps || datasetCaps != null || datasetCapsError != null);

  const pricingParams = useMemo(
    () => ({
      dataset_images: uploadedDataset?.summary?.total_images ?? null,
      sample_size: config.sampleSize,
      engine: isV2 ? "v2" : "v1",
    }),
    [uploadedDataset, config.sampleSize, isV2],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (sourceMode === "library" && !selectedInternalModel) {
      setError("Pick a model from the library (or switch to Upload)");
      return;
    }
    if (sourceMode === "upload" && !uploadedModel) {
      setError("Upload a .keras model (or switch to Library)");
      return;
    }

    if (!uploadedDataset) {
      setError(
        sourceMode === "library"
          ? "Generate or pick a test dataset for this model"
          : "Upload a test dataset ZIP",
      );
      return;
    }

    if (!(await confirmRun("backtester", pricingParams))) return;

    setIsSubmitting(true);
    setError(null);
    setCurrentRunId(null);
    setRunStatus(null);
    setRunLogs("");

    try {
      const datasetPath = `backend/datasets/${uploadedDataset.dataset_id}/images`;

      let modelRef: { trainer_run_id?: string; model_id?: string };
      if (selectedInternalModel?.kind === "trained") {
        modelRef = {
          trainer_run_id: selectedInternalModel.training_run_id || selectedInternalModel.model_id,
        };
      } else if (selectedInternalModel) {
        modelRef = { model_id: selectedInternalModel.model_id };
      } else {
        modelRef = { model_id: uploadedModel!.model_id };
      }

      const common = {
        ...modelRef,
        dataset_path: datasetPath,
        sample_size: config.sampleSize,
        confidence_threshold: config.confidenceThreshold,
        img_size: config.imgSize,
        starting_capital: config.startingCapital,
        position_size_pct: config.positionSizePct,
        commission_pct: config.commissionPct,
        slippage_pct: config.slippagePct,
        max_drawdown_pct: config.maxDrawdownPct,
      };
      // v2 exits come from the dataset's stored label definition, so TP/SL are not sent.
      const requestData: BacktestRunRequest = isV2
        ? {
            ...common,
            engine: "v2",
            threshold_mode: config.thresholdMode,
            max_exposure_pct: config.maxExposurePct,
            max_concurrent_positions: config.maxConcurrentPositions,
          }
        : { ...common, engine: datasetCaps ? "v1" : "auto", tp_pct: config.tpPct, sl_pct: config.slPct };

      const response = await realtimeBacktesterApi.startRun(requestData);
      const runId = response.run_id;
      chargeRunCredits("backtester");

      registerRun({
        id: runId,
        tool: "backtester",
        status: "running",
        progress: 0,
        stage: "starting",
        message: "Initializing backtester...",
        route: `/tools/backtester/runs/${runId}`,
      });

      setCurrentRunId(runId);
    } catch (err) {
      console.error("Failed to start backtester:", err);
      setError(err instanceof Error ? err.message : "Failed to start backtest");
    } finally {
      setIsSubmitting(false);
    }
  };

  const modelSelectValue = selectedInternalModel
    ? `${selectedInternalModel.kind}:${selectedInternalModel.model_id}`
    : "";

  return (
    <div className="relative pb-8 text-white">
        <form onSubmit={handleSubmit} className="space-y-6">
            {showTestDataBanner ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/65">
                {testDataBannerMessage}
              </div>
            ) : null}

            <div className="space-y-3" data-tour="bt-source" data-help="bt-source">
              <p className="text-sm text-white/65">
                Choose <span className="font-medium text-white">one</span> way to supply the model and test
                charts — library (pick + generate) or local upload. The other path is cleared when you switch.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/12 bg-white/[0.03] p-1.5">
                <button
                  type="button"
                  onClick={() => switchSourceMode("library")}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                    sourceMode === "library"
                      ? "bg-white text-[#0a0a0a]"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white/85"
                  }`}
                >
                  From library
                </button>
                <button
                  type="button"
                  onClick={() => switchSourceMode("upload")}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                    sourceMode === "upload"
                      ? "bg-white text-[#0a0a0a]"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white/85"
                  }`}
                >
                  Upload files
                </button>
              </div>
              <p className="text-xs text-white/45">
                {sourceMode === "library"
                  ? "Pick a trained / saved model, then generate a fitting test set (or choose an existing test folder). No re-upload needed."
                  : "Upload a .keras model and a labeled chart ZIP from your computer."}
              </p>
            </div>

            {sourceMode === "library" ? (
              <>
                <StepSection
                  step={1}
                  title="Pick model from library"
                  description="Select a workspace model or a completed trainer run. The file on disk is used directly — do not re-upload."
                >
                  <div className="space-y-4">
                    {internalModels.length > 0 ? (
                      <div>
                        <label className={labelClass}>
                          Workspace models
                          <FieldTip text="Models already on this server from training or earlier uploads." />
                        </label>
                        <select
                          value={modelSelectValue}
                          onChange={(e) => handleInternalModelSelected(e.target.value)}
                          className={fieldClass}
                        >
                          <option value="">Select a model…</option>
                          {internalModels.map((m) => (
                            <option key={`${m.kind}:${m.model_id}`} value={`${m.kind}:${m.model_id}`}>
                              {m.kind === "trained" ? "Trained" : "Uploaded"} ·{" "}
                              {m.display_name || m.name || m.model_id}
                              {m.symbols ? ` · ${m.symbols}` : ""}
                              {m.timeframe ? ` · ${m.timeframe}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {trainerRunsFromActivity.length > 0 ? (
                      <div>
                        <label className={labelClass}>
                          From activity (trainer runs)
                          <FieldTip text="Completed trainer runs from your run history." />
                        </label>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <select
                            value={activityTrainerRunId}
                            onChange={(e) => handleActivityTrainerPicked(e.target.value)}
                            className={`${fieldClass} min-w-0 flex-1`}
                          >
                            <option value="">Select a completed trainer run…</option>
                            {trainerRunsFromActivity.map((r) => (
                              <option key={r.id} value={r.id}>
                                {runLabel(r)} · {formatRunStamp(r.updated_at)}
                              </option>
                            ))}
                          </select>
                          <Link
                            to="/tools/run-log"
                            className="shrink-0 text-xs text-sky-300/90 underline-offset-2 hover:text-sky-200 hover:underline"
                          >
                            Open run log
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-white/45">
                        No trainer runs in activity yet.{" "}
                        <button
                          type="button"
                          onClick={() => switchSourceMode("upload")}
                          className="text-sky-300/90 underline-offset-2 hover:underline"
                        >
                          Switch to Upload
                        </button>{" "}
                        or train a model first.
                      </p>
                    )}

                    {selectedInternalModel ? (
                      <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100/90">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-emerald-50">
                              Ready ·{" "}
                              {selectedInternalModel.display_name ||
                                selectedInternalModel.name ||
                                selectedInternalModel.model_id}
                            </p>
                            <p className="mt-0.5 text-emerald-100/70">
                              {selectedInternalModel.kind === "trained"
                                ? "Will run from the trainer artifact (no .keras upload)."
                                : "Will run from the saved upload on this server."}
                              {selectedInternalModel.symbols
                                ? ` · ${selectedInternalModel.symbols}`
                                : ""}
                              {selectedInternalModel.timeframe
                                ? ` · ${selectedInternalModel.timeframe}`
                                : ""}
                            </p>
                            {metadataLoading ? (
                              <p className="mt-1 text-emerald-100/55">Loading training metadata…</p>
                            ) : modelMetadata ? (
                              <p className="mt-1 text-emerald-100/55">
                                Metadata linked
                                {modelMetadata.takeProfitFraction != null
                                  ? ` · TP ${(modelMetadata.takeProfitFraction * 100).toFixed(2)}%`
                                  : ""}
                                {modelMetadata.stopLossFraction != null
                                  ? ` · SL ${(modelMetadata.stopLossFraction * 100).toFixed(2)}%`
                                  : ""}
                                {modelMetadata.imageDimension != null
                                  ? ` · ${modelMetadata.imageDimension}px`
                                  : ""}
                              </p>
                            ) : metadataError ? (
                              <p className="mt-1 text-amber-200/80">{metadataError}</p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              selectInternalModel(null);
                              setActivityTrainerRunId("");
                            }}
                            className="shrink-0 text-emerald-100/60 underline-offset-2 hover:text-emerald-50 hover:underline"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </StepSection>

                <StepSection
                  step={2}
                  title="Test dataset for this model"
                  description="Generate a fitting out-of-sample set from the model's training metadata, or pick an existing test folder."
                >
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => setIsTestDataModalOpen(true)}
                      disabled={!selectedInternalModel || Boolean(testDataRunId && !testDataResult && !testDataError)}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/15 disabled:opacity-45"
                    >
                      {testDataRunId && !testDataResult && !testDataError ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Zap className="h-4 w-4" aria-hidden />
                      )}
                      {!selectedInternalModel
                        ? "Pick a model first"
                        : testDataRunId && !testDataResult && !testDataError
                          ? "Generating…"
                          : "Generate fitting test set"}
                    </button>

                    {datasets.length > 0 ? (
                      <div>
                        <label className={labelClass}>
                          Or pick an existing folder
                          <FieldTip text="Saved test / dataset folders already in this workspace." />
                        </label>
                        <div className="flex items-center gap-2">
                          <select
                            value={pickedDatasetId}
                            onChange={(e) => handleDatasetPicked(e.target.value)}
                            className={`${fieldClass} min-w-0 flex-1`}
                          >
                            <option value="">Select an existing folder…</option>
                            {testFolders.length > 0 && (
                              <optgroup label="Test folders">
                                {testFolders.map((d) => (
                                  <option key={d.dataset_id} value={d.dataset_id}>
                                    {d.display_name || d.name}
                                    {d.total_images ? ` · ${d.total_images} imgs` : ""}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {otherFolders.length > 0 && (
                              <optgroup label="Other datasets">
                                {otherFolders.map((d) => (
                                  <option key={d.dataset_id} value={d.dataset_id}>
                                    {d.display_name || d.name}
                                    {d.total_images ? ` · ${d.total_images} imgs` : ""}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <button
                            type="button"
                            onClick={() => void loadDatasets()}
                            title="Refresh folder list"
                            className="shrink-0 rounded-lg border border-white/12 bg-white/[0.04] p-2.5 text-white/60 transition hover:bg-white/[0.08]"
                          >
                            <RefreshCw className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {testdataRunsFromActivity.length > 0 ? (
                      <div>
                        <label className={labelClass}>
                          From activity (test data runs)
                          <FieldTip text="Completed test-dataset generator runs." />
                        </label>
                        <select
                          value={activityTestdataRunId}
                          onChange={(e) => void handleActivityTestdataPicked(e.target.value)}
                          className={fieldClass}
                        >
                          <option value="">Select a completed test-data run…</option>
                          {testdataRunsFromActivity.map((r) => (
                            <option key={r.id} value={r.id}>
                              {runLabel(r)} · {formatRunStamp(r.updated_at)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {pickedDatasetId && uploadedDataset ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">
                        <span className="truncate text-white/85">
                          Active:{" "}
                          {datasets.find((d) => d.dataset_id === pickedDatasetId)?.display_name ||
                            datasets.find((d) => d.dataset_id === pickedDatasetId)?.name ||
                            testDataResult?.dataset_name ||
                            pickedDatasetId}
                          {uploadedDataset.summary.total_images
                            ? ` · ${uploadedDataset.summary.total_images} imgs`
                            : ""}
                        </span>
                        <button
                          type="button"
                          onClick={handleDatasetRemoved}
                          className="shrink-0 text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}

                    {(testDataRunId || testDataResult || testDataError) && (
                      <div className="space-y-3 rounded-xl border border-white/12 bg-[#0a0a0a]/50 p-3">
                        {testDataError ? (
                          <div className="rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-200">
                            {testDataError}
                          </div>
                        ) : null}
                        {testDataRunId && !testDataResult && !testDataError ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-white/75">
                                {testDataStatus?.message || "Generating test charts…"}
                              </span>
                              <span className="tabular-nums text-white/45">
                                {Math.round((testDataStatus?.progress ?? 0) * 100)}%
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-white transition-all duration-500"
                                style={{
                                  width: `${Math.min(100, Math.max(4, (testDataStatus?.progress ?? 0) * 100))}%`,
                                }}
                              />
                            </div>
                          </div>
                        ) : null}
                        {testDataResult ? (
                          <div className="flex items-start gap-2">
                            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white">
                                {testDataResult.dataset_name || "Test dataset"} attached
                              </p>
                              <p className="text-xs text-white/55">
                                {testDataResult.summary.total_images} images
                                {testDataResult.summary.start_date && testDataResult.summary.end_date
                                  ? ` · ${testDataResult.summary.start_date} → ${testDataResult.summary.end_date}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </StepSection>
              </>
            ) : (
              <>
                <StepSection
                  step={1}
                  title="Upload model"
                  description="Drop a local .keras file. This replaces any library model selection."
                >
                  <ModelUploader
                    compact
                    onModelUploaded={handleModelUploaded}
                    onModelRemoved={handleModelRemoved}
                    uploadedModel={uploadedModel}
                  />
                </StepSection>

                <StepSection
                  step={2}
                  title="Upload test dataset"
                  description="ZIP of labeled chart images (folders for labels 0 / 1)."
                >
                  <DatasetUploader
                    compact
                    onDatasetUploaded={handleDatasetUploaded}
                    onDatasetRemoved={handleDatasetRemoved}
                    uploadedDataset={datasetFromUpload ? uploadedDataset : null}
                  />
                </StepSection>
              </>
            )}

            <StepSection
              step={3}
              title="Backtest settings"
              description="Signal thresholds, TP/SL, capital, and risk controls for the simulated run."
            >
              <div className="mb-5 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-white/50">
                    Copy TP / SL / image size from any model&apos;s training metadata — including when you
                    uploaded files and need to look up the matching trained model.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      showParamsSourcePicker
                        ? setShowParamsSourcePicker(false)
                        : openTrainingParamsPicker()
                    }
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                  >
                    Use same parameters as for training
                  </button>
                </div>

                {paramsSourceLabel && !showParamsSourcePicker ? (
                  <p className="text-xs text-emerald-200/80">
                    Settings copied from <span className="font-medium text-emerald-100">{paramsSourceLabel}</span>
                    {" · "}
                    <button
                      type="button"
                      onClick={openTrainingParamsPicker}
                      className="underline-offset-2 hover:underline"
                    >
                      Change
                    </button>
                  </p>
                ) : null}

                {showParamsSourcePicker ? (
                  <div className="space-y-3 rounded-xl border border-white/12 bg-white/[0.03] p-3 sm:p-4">
                    <p className="text-sm font-medium text-white">Find the training model</p>
                    <p className="text-xs text-white/50">
                      This only fills settings — it does not replace your uploaded / selected backtest model.
                    </p>
                    <div>
                      <label className={labelClass}>
                        Reference model
                        <FieldTip text="Pick the trained or saved model whose TP, SL, and image size should be copied into the fields below." />
                      </label>
                      <select
                        value={paramsSourceKey}
                        onChange={(e) => {
                          setParamsSourceKey(e.target.value);
                          setParamsSourceError(null);
                        }}
                        className={fieldClass}
                      >
                        <option value="">Select a model with training metadata…</option>
                        {uploadedModel ? (
                          <option value="active-uploaded">
                            Your upload · {uploadedModel.original_filename || uploadedModel.model_id}
                          </option>
                        ) : null}
                        {sourceMode === "library" && selectedInternalModel ? (
                          <option value="active-library">
                            Active library model ·{" "}
                            {selectedInternalModel.display_name ||
                              selectedInternalModel.name ||
                              selectedInternalModel.model_id}
                          </option>
                        ) : null}
                        {internalModels.length > 0 ? (
                          <optgroup label="Workspace models">
                            {internalModels.map((m) => (
                              <option
                                key={`params-${m.kind}:${m.model_id}`}
                                value={
                                  m.kind === "trained"
                                    ? `trainer:${m.training_run_id || m.model_id}`
                                    : `uploaded:${m.model_id}`
                                }
                              >
                                {m.kind === "trained" ? "Trained" : "Uploaded"} ·{" "}
                                {m.display_name || m.name || m.model_id}
                                {m.symbols ? ` · ${m.symbols}` : ""}
                                {m.timeframe ? ` · ${m.timeframe}` : ""}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {trainerRunsFromActivity.length > 0 ? (
                          <optgroup label="Trainer runs (activity)">
                            {trainerRunsFromActivity.map((r) => (
                              <option key={`params-trainer-${r.id}`} value={`trainer:${r.id}`}>
                                {runLabel(r)} · {formatRunStamp(r.updated_at)}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                    </div>
                    {paramsSourceError ? (
                      <p className="text-xs text-rose-200">{paramsSourceError}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void applyTrainingParamsFromPicker()}
                        disabled={applyingTrainingParams || !paramsSourceKey}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#0a0a0a] transition hover:bg-white/90 disabled:opacity-45"
                      >
                        {applyingTrainingParams ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Apply settings
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowParamsSourcePicker(false);
                          setParamsSourceError(null);
                        }}
                        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/[0.06]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {datasetIdForCaps ? (
                <div className="mb-5 rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-sm leading-relaxed">
                  {datasetCapsError ? (
                    <p className="text-white/60">Could not check which engine this dataset supports ({datasetCapsError}). The server will decide when the run starts.</p>
                  ) : !datasetCaps ? (
                    <p className="text-white/45">Checking dataset…</p>
                  ) : isV2 ? (
                    <>
                      <p className="font-medium text-white">Price-based simulation (v2)</p>
                      <p className="mt-1 text-white/60">
                        Entries at the next bar's open, exits on stored OHLC bars. Exits follow the dataset's label definition
                        {labelDef ? `: take profit ${((labelDef.tp_frac ?? 0) * 100).toFixed(2)}%, stop loss ${((labelDef.sl_frac ?? 0) * 100).toFixed(2)}%, ${labelDef.horizon_bars} ${labelDef.timeframe ?? ""} bars` : ""}.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-amber-100/90">Legacy label-payoff estimate — not a price-based trading simulation.</p>
                      <p className="mt-1 text-white/60">{datasetCaps.reason}</p>
                    </>
                  )}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    Sample size
                    <FieldTip text="Use every chart in the test folder, or cap the sample for a faster smoke run." />
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-white">
                      <input
                        type="radio"
                        name="sampleSize"
                        value="all"
                        checked={config.sampleSize === "all"}
                        onChange={(e) => setConfig({ ...config, sampleSize: e.target.value })}
                        className="text-white focus:ring-white"
                      />
                      All
                    </label>
                    <label className="flex items-center gap-2 text-sm text-white">
                      <input
                        type="radio"
                        name="sampleSize"
                        value="custom"
                        checked={typeof config.sampleSize === "number"}
                        onChange={() => setConfig({ ...config, sampleSize: 1000 })}
                        className="text-white focus:ring-white"
                      />
                      Custom
                    </label>
                  </div>
                  {typeof config.sampleSize === "number" ? (
                    <FreeNumberField
                      value={config.sampleSize}
                      onChange={(n) => setConfig({ ...config, sampleSize: Math.max(1, Math.round(n)) })}
                      className={`${fieldClass} mt-2`}
                    />
                  ) : null}
                </div>

                {isV2 ? (
                  <div>
                    <label className={labelClass}>
                      Threshold
                      <FieldTip text="Validation: chosen on the model's recorded validation split (max F1 for label 1), then locked before the test set is scored. Fixed: the value below; the run is labelled exploratory." />
                    </label>
                    <select
                      value={config.thresholdMode}
                      onChange={(e) => setConfig({ ...config, thresholdMode: e.target.value as BacktesterConfig["thresholdMode"] })}
                      className={fieldClass}
                    >
                      <option value="validation">Select on validation data (recommended)</option>
                      <option value="fixed">Use a fixed value</option>
                    </select>
                  </div>
                ) : null}

                {!isV2 || config.thresholdMode === "fixed" ? (
                  <div data-help="bt-threshold" data-tour="bt-threshold">
                    <label className={labelClass}>
                      Confidence threshold (0–1)
                      <FieldTip text="Minimum model confidence required before a trade is opened." />
                    </label>
                    <FreeNumberField
                      value={config.confidenceThreshold}
                      onChange={(n) => setConfig({ ...config, confidenceThreshold: n })}
                      className={fieldClass}
                    />
                  </div>
                ) : null}

                <div data-help="take-profit">
                  <label className={labelClass}>
                    Take profit %
                    <FieldTip text={isV2 ? "Fixed by the dataset's label definition so trades and labels use the same exit rule." : "Exit target as a percent of entry price for each simulated trade."} />
                  </label>
                  {isV2 ? (
                    <div className={`${fieldClass} text-white/55`} aria-readonly>{labelDef?.tp_frac != null ? `${(labelDef.tp_frac * 100).toFixed(2)} (from dataset)` : "From dataset"}</div>
                  ) : (
                    <FreeNumberField value={config.tpPct} onChange={(n) => setConfig({ ...config, tpPct: n })} className={fieldClass} />
                  )}
                </div>

                <div data-help="stop-loss">
                  <label className={labelClass}>
                    Stop loss %
                    <FieldTip text={isV2 ? "Fixed by the dataset's label definition." : "Stop distance as a percent of entry price."} />
                  </label>
                  {isV2 ? (
                    <div className={`${fieldClass} text-white/55`} aria-readonly>{labelDef?.sl_frac != null ? `${(labelDef.sl_frac * 100).toFixed(2)} (from dataset)` : "From dataset"}</div>
                  ) : (
                    <FreeNumberField value={config.slPct} onChange={(n) => setConfig({ ...config, slPct: n })} className={fieldClass} />
                  )}
                </div>

                {isV2 ? (
                  <>
                    <div>
                      <label className={labelClass}>
                        Max gross exposure %
                        <FieldTip text="New entries are skipped when open positions would exceed this share of equity." />
                      </label>
                      <FreeNumberField value={config.maxExposurePct} onChange={(n) => setConfig({ ...config, maxExposurePct: n })} className={fieldClass} />
                    </div>
                    <div>
                      <label className={labelClass}>
                        Max open positions
                        <FieldTip text="Maximum simultaneous positions; one position per symbol at a time." />
                      </label>
                      <FreeNumberField
                        value={config.maxConcurrentPositions}
                        onChange={(n) => setConfig({ ...config, maxConcurrentPositions: Math.max(1, Math.round(n)) })}
                        className={fieldClass}
                      />
                    </div>
                  </>
                ) : null}

                <div>
                  <label className={labelClass}>
                    Image size (px)
                    <FieldTip text="Must match the size the model was trained on (usually 224)." />
                  </label>
                  <FreeNumberField
                    value={config.imgSize}
                    onChange={(n) => setConfig({ ...config, imgSize: Math.max(1, Math.round(n)) })}
                    className={fieldClass}
                  />
                </div>

                <div data-help="bt-capital">
                  <label className={labelClass}>
                    Starting capital
                    <FieldTip text="Simulated account equity at the start of the backtest." />
                  </label>
                  <FreeNumberField
                    value={config.startingCapital}
                    onChange={(n) => setConfig({ ...config, startingCapital: n })}
                    className={fieldClass}
                  />
                </div>

                <div data-help="bt-position">
                  <label className={labelClass}>
                    Position size % of capital
                    <FieldTip text="Fraction of current equity allocated per open trade." />
                  </label>
                  <FreeNumberField
                    value={config.positionSizePct}
                    onChange={(n) => setConfig({ ...config, positionSizePct: n })}
                    className={fieldClass}
                  />
                </div>

                <div data-help="bt-costs">
                  <label className={labelClass}>
                    Commission % per trade
                    <FieldTip text="Fee as a percent of trade notional (any value, e.g. 0.1 for 0.1%)." />
                  </label>
                  <FreeNumberField
                    value={config.commissionPct}
                    onChange={(n) => setConfig({ ...config, commissionPct: n })}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    Slippage % per trade
                    <FieldTip text="Assumed adverse fill slippage as a percent (any value)." />
                  </label>
                  <FreeNumberField
                    value={config.slippagePct}
                    onChange={(n) => setConfig({ ...config, slippagePct: n })}
                    className={fieldClass}
                  />
                </div>

                <div data-help="max-drawdown">
                  <label className={labelClass}>
                    Max drawdown % (stop trading)
                    <FieldTip text="Halt new trades once equity drawdown from peak exceeds this percent." />
                  </label>
                  <FreeNumberField
                    value={config.maxDrawdownPct}
                    onChange={(n) => setConfig({ ...config, maxDrawdownPct: n })}
                    className={fieldClass}
                  />
                </div>
              </div>
            </StepSection>

            <RecentRunsBlock tool="backtester" title="Recent backtests" />

            {error ? (
              <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 p-3">
                <p className="text-sm text-rose-200">{error}</p>
              </div>
            ) : null}

            <div className="space-y-2" data-tour="bt-run">
              <button
                type="submit"
                data-help="bt-run"
                disabled={!canRun}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/25 bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Run backtest <RunCost tool="backtester" params={pricingParams} />
                  </>
                )}
              </button>
              <RunCostHint tool="backtester" params={pricingParams} className="text-center" />
              {!canRun && !isSubmitting ? (
                <p className="text-center text-[10px] text-white/40">
                  {!hasModel
                    ? sourceMode === "library"
                      ? "Pick a library model · "
                      : "Upload a .keras model · "
                    : null}
                  {!hasDataset
                    ? sourceMode === "library"
                      ? "Generate or pick a test dataset"
                      : "Upload a test dataset ZIP"
                    : null}
                </p>
              ) : null}
            </div>

            {currentRunId && runStatus ? (
              <div className="rounded-xl border border-white/15 bg-white/[0.03] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {runStatus.status === "running" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-white/70" />
                    ) : null}
                    {runStatus.status === "succeeded" ? (
                      <CheckCircle className="h-5 w-5 text-emerald-400" />
                    ) : null}
                    {runStatus.status === "failed" ? <XCircle className="h-5 w-5 text-red-400" /> : null}
                    <h3 className="text-lg font-medium text-white">
                      Backtest{" "}
                      {runStatus.status === "running"
                        ? "Running"
                        : runStatus.status === "succeeded"
                          ? "Completed"
                          : "Failed"}
                    </h3>
                  </div>
                  <div className="text-xs text-white/45">Run ID: {currentRunId.slice(-8)}</div>
                </div>

                <div className="mb-4">
                  <div className="mb-2 h-3 w-full overflow-hidden rounded-full bg-black/40">
                    <div
                      className="h-3 rounded-full bg-white transition-all duration-500 ease-out"
                      style={{ width: `${Math.max(5, Math.min(100, runStatus.progress * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/70">{runStatus.message}</span>
                    <span className="text-white/45">{Math.round(runStatus.progress * 100)}%</span>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-lg border border-white/15 bg-black/40 p-4">
                  <div className="whitespace-pre-wrap font-mono text-xs text-white/70">
                    {runLogs || "Waiting for logs..."}
                    <div ref={logsEndRef} />
                  </div>
                </div>

                {runStatus.status === "failed" ? (
                  <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <span className="font-medium text-red-300">Backtest failed</span>
                    </div>
                    <p className="text-sm text-red-200">{runStatus.message}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentRunId(null);
                        setRunStatus(null);
                        setRunLogs("");
                      }}
                      className="mt-3 rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-2 text-sm text-red-200 transition hover:bg-red-500/30"
                    >
                      Try again
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
        </form>

      <TestDataGeneratorModal
        isOpen={isTestDataModalOpen}
        onClose={() => setIsTestDataModalOpen(false)}
        onGenerationStarted={handleTestDataGenerationStarted}
        uploadedModel={
          uploadedModel ??
          (selectedInternalModel?.kind === "uploaded"
            ? {
                model_id: selectedInternalModel.model_id,
                original_filename:
                  selectedInternalModel.display_name ||
                  selectedInternalModel.name ||
                  `${selectedInternalModel.model_id}.keras`,
              }
            : null)
        }
        defaultSourceKey={
          selectedInternalModel?.kind === "trained"
            ? `trainer:${selectedInternalModel.training_run_id || selectedInternalModel.model_id}`
            : selectedInternalModel?.kind === "uploaded" || uploadedModel
              ? "uploaded-model"
              : undefined
        }
      />
    </div>
  );
}
