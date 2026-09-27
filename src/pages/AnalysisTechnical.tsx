import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Loader2, Zap, RefreshCw } from "lucide-react";
import ModelUploader from "@/components/ModelUploader";
import DatasetUploader from "@/components/DatasetUploader";
import TestDataGeneratorModal from "@/components/TestDataGeneratorModal";
import {
  trainerApi,
  ApiError,
  internalModelsApi,
  datasetsApi,
  testDataGeneratorApi,
  type InternalModel,
  type DatasetListItem,
} from "@/lib/api";
import { requestRunCredits, chargeRunCredits } from "@/state/creditsStore";
import { cn } from "@/lib/utils";

type UploadedModel = {
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
};

type UploadedDataset = {
  dataset_id: string;
  extracted_path: string;
  summary: {
    total_images: number;
    label_distribution: Record<string, number>;
    example_filenames: string[];
  };
};

export default function AnalysisTechnical() {
  const navigate = useNavigate();

  // Model selection: internal (trained/uploaded registry) OR a freshly uploaded .keras
  const [internalModels, setInternalModels] = useState<InternalModel[]>([]);
  const [selectedInternalModel, setSelectedInternalModel] = useState<InternalModel | null>(null);
  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);

  // Test folder: existing dataset picked from the registry, an uploaded ZIP, or a freshly generated set
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [pickedDatasetId, setPickedDatasetId] = useState<string>("");
  const [uploadedDataset, setUploadedDataset] = useState<UploadedDataset | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);

  // Quick test-folder generation
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testDataRunId, setTestDataRunId] = useState<string | null>(null);
  const [testGenPhase, setTestGenPhase] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef<{ runId: string; analysisId: string } | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => clearPoll(), []);

  const loadDatasets = useCallback(async () => {
    try {
      const { datasets: list } = await datasetsApi.list();
      setDatasets(list);
    } catch {
      /* non-fatal — the uploader and generator still work */
    }
  }, []);

  useEffect(() => {
    void internalModelsApi
      .list()
      .then(({ models }) => setInternalModels(models))
      .catch(() => {});
    void loadDatasets();
  }, [loadDatasets]);

  // Resolve the active test-folder dataset id (upload wins, then picker)
  const resolvedDataset = uploadedDataset
    ? { dataset_id: uploadedDataset.dataset_id }
    : pickedDatasetId
      ? { dataset_id: pickedDatasetId }
      : null;

  const hasModel = Boolean(selectedInternalModel || uploadedModel);

  const handleInternalModelSelected = (value: string) => {
    if (!value) {
      setSelectedInternalModel(null);
      return;
    }
    const model = internalModels.find((m) => `${m.kind}:${m.model_id}` === value) ?? null;
    setSelectedInternalModel(model);
    if (model) setUploadedModel(null);
  };

  const handleDatasetPicked = (value: string) => {
    setPickedDatasetId(value);
    if (value) setUploadedDataset(null);
  };

  // ---- Quick test-folder generation (reuses the shared modal + fitting params) ----
  const modalUploadedModel = uploadedModel
    ? { model_id: uploadedModel.model_id, original_filename: uploadedModel.original_filename }
    : null;
  const modalSourceKey =
    selectedInternalModel?.kind === "trained" && selectedInternalModel.training_run_id
      ? `trainer:${selectedInternalModel.training_run_id}`
      : uploadedModel
        ? "uploaded-model"
        : undefined;

  const handleTestGenerationStarted = (runId: string) => {
    setTestDataRunId(runId);
    setTestGenPhase("Starting…");
  };

  useEffect(() => {
    if (!testDataRunId) return;
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const status = await testDataGeneratorApi.getStatus(testDataRunId);
        if (!active) return;
        setTestGenPhase(status.message || status.stage || "Generating…");
        if (status.status === "succeeded") {
          const result = await testDataGeneratorApi.getResult(testDataRunId);
          if (!active) return;
          setUploadedDataset(null);
          setPickedDatasetId(result.dataset_id);
          setTestGenPhase(null);
          setTestDataRunId(null);
          await loadDatasets();
          if (interval) clearInterval(interval);
        } else if (status.status === "failed") {
          setTestGenPhase(null);
          setError(status.message || "Test folder generation failed");
          setTestDataRunId(null);
          if (interval) clearInterval(interval);
        }
      } catch (err) {
        if (!active) return;
        setTestGenPhase(null);
        setError(err instanceof Error ? err.message : "Failed to track test folder generation");
        setTestDataRunId(null);
        if (interval) clearInterval(interval);
      }
    };
    void poll();
    interval = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [testDataRunId, loadDatasets]);

  const pollOnce = useCallback(async () => {
    const ids = runRef.current;
    if (!ids) return;
    try {
      const s = await trainerApi.getAnalysisStatus(ids.runId, ids.analysisId);
      setPhase(s.progress?.message ?? s.progress?.phase ?? "Running…");
      if (s.status === "done") {
        clearPoll();
        setRunning(false);
        navigate(`/products/trainer/analysis/${ids.runId}/${ids.analysisId}`, { replace: true });
      } else if (s.status === "failed") {
        clearPoll();
        setRunning(false);
        setError("Analysis failed. Check run logs or try another image sample.");
      }
    } catch {
      clearPoll();
      setRunning(false);
      setError("Lost connection while waiting for analysis.");
    }
  }, [navigate]);

  const handleRun = async () => {
    if (!hasModel) {
      setError("Select a model from this workspace or upload a .keras file.");
      return;
    }
    if (!resolvedDataset) {
      setError("Pick a test folder, upload a ZIP, or generate one first.");
      return;
    }
    if (!requestRunCredits("analysis")) return;
    setError(null);
    setRunning(true);
    setPhase("Starting…");
    clearPoll();
    try {
      const modelRef =
        selectedInternalModel?.kind === "trained" && selectedInternalModel.training_run_id
          ? { trainer_run_id: selectedInternalModel.training_run_id }
          : selectedInternalModel
            ? { model_id: selectedInternalModel.model_id }
            : { model_id: uploadedModel!.model_id };

      const { run_id, analysis_id } = await trainerApi.startStandaloneAnalysis({
        ...modelRef,
        dataset_id: resolvedDataset.dataset_id,
      });
      chargeRunCredits("analysis");
      runRef.current = { runId: run_id, analysisId: analysis_id };
      await pollOnce();
      pollRef.current = setInterval(() => void pollOnce(), 1200);
    } catch (e) {
      setRunning(false);
      setPhase(null);
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not start analysis";
      setError(msg);
    }
  };

  const canRun = hasModel && Boolean(resolvedDataset) && !running;
  const modelSelectValue = selectedInternalModel ? `${selectedInternalModel.kind}:${selectedInternalModel.model_id}` : "";
  const testFolders = datasets.filter((d) => d.kind === "test");
  const otherFolders = datasets.filter((d) => d.kind !== "test");

  return (
    <div className="pb-8">
      <div className="tech-surface space-y-8 p-5 sm:p-6 md:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Analysis</p>
          <h1 className="mt-1 text-lg font-semibold text-white">Model &amp; test folder</h1>
          <p className="mt-1 text-sm text-white/55">
            Pick a trained model, attach or generate a matching test folder, then run CNN analysis.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* Model */}
          <div className="min-w-0 rounded-2xl border border-white/12 bg-white/[0.04] p-5 md:p-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">1 · Model</p>
            {internalModels.length > 0 && (
              <div className="mb-3">
                <select
                  value={modelSelectValue}
                  onChange={(e) => handleInternalModelSelected(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-[#0a0a0a]/70 px-4 py-3 text-base text-white focus:border-white/30 focus:ring-1 focus:ring-white/40"
                >
                  <option value="">Select a model from this workspace…</option>
                  {internalModels.map((m) => (
                    <option key={`${m.kind}:${m.model_id}`} value={`${m.kind}:${m.model_id}`}>
                      {m.kind === "trained" ? "Trained" : "Uploaded"} · {m.name || m.model_id}
                      {m.symbols ? ` · ${m.symbols}` : ""}
                      {m.timeframe ? ` · ${m.timeframe}` : ""}
                    </option>
                  ))}
                </select>
                {selectedInternalModel ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">
                    <span className="truncate text-white/85">
                      {selectedInternalModel.name || selectedInternalModel.model_id}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedInternalModel(null)}
                      className="shrink-0 text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-[10px] text-white/35">or upload a .keras file below</p>
                )}
              </div>
            )}
            {!selectedInternalModel && (
              <ModelUploader
                compact
                uploadedModel={uploadedModel}
                onModelUploaded={setUploadedModel}
                onModelRemoved={() => setUploadedModel(null)}
              />
            )}
          </div>

          {/* Test folder */}
          <div className="min-w-0 rounded-2xl border border-white/12 bg-white/[0.04] p-5 md:p-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">2 · Test folder</p>
              <button
                type="button"
                onClick={() => setIsTestModalOpen(true)}
                disabled={Boolean(testDataRunId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
              >
                {testDataRunId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Zap className="h-3.5 w-3.5" aria-hidden />
                )}
                {testDataRunId ? "Generating…" : "Generate fitting test folder"}
              </button>
            </div>

            {datasets.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <select
                    value={pickedDatasetId}
                    onChange={(e) => handleDatasetPicked(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-[#0a0a0a]/70 px-4 py-3 text-base text-white focus:border-white/30 focus:ring-1 focus:ring-white/40"
                  >
                    <option value="">Select an existing folder…</option>
                    {testFolders.length > 0 && (
                      <optgroup label="Test folders">
                        {testFolders.map((d) => (
                          <option key={d.dataset_id} value={d.dataset_id}>
                            {d.name}
                            {d.total_images ? ` · ${d.total_images} imgs` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {otherFolders.length > 0 && (
                      <optgroup label="Other datasets">
                        {otherFolders.map((d) => (
                          <option key={d.dataset_id} value={d.dataset_id}>
                            {d.name}
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
                {pickedDatasetId ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">
                    <span className="truncate text-white/85">
                      {datasets.find((d) => d.dataset_id === pickedDatasetId)?.name ?? pickedDatasetId}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickedDatasetId("")}
                      className="shrink-0 text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-[10px] text-white/35">or drop a ZIP below</p>
                )}
              </div>
            )}

            {!pickedDatasetId && (
              <DatasetUploader
                compact
                uploadedDataset={uploadedDataset}
                onDatasetUploaded={setUploadedDataset}
                onDatasetRemoved={() => setUploadedDataset(null)}
              />
            )}
            {testGenPhase ? (
              <p className="mt-2 text-[11px] tabular-nums text-white/45">{testGenPhase}</p>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="text-sm text-rose-300/90" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canRun}
            onClick={() => void handleRun()}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-base font-semibold transition sm:w-auto",
              canRun
                ? "bg-white text-[#0a0a0a] shadow-[0_0_24px_rgba(255,255,255,0.12)] hover:bg-white/90"
                : "cursor-not-allowed bg-white/20 text-white/40",
            )}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {running ? "Running…" : "Run analysis"}
          </button>
          {running && phase ? <span className="text-[12px] tabular-nums text-white/45">{phase}</span> : null}
        </div>
      </div>

      <TestDataGeneratorModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        onGenerationStarted={handleTestGenerationStarted}
        uploadedModel={modalUploadedModel}
        defaultSourceKey={modalSourceKey}
      />
    </div>
  );
}
