import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Loader2 } from "lucide-react";
import ModelUploader from "@/components/ModelUploader";
import DatasetUploader from "@/components/DatasetUploader";
import { trainerApi, ApiError } from "@/lib/api";
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
  const [model, setModel] = useState<UploadedModel | null>(null);
  const [dataset, setDataset] = useState<UploadedDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef<{ runId: string; analysisId: string } | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => clearPoll(), []);

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
    if (!model?.model_id || !dataset?.dataset_id) {
      setError("Upload a model and a test ZIP first.");
      return;
    }
    setError(null);
    setRunning(true);
    setPhase("Starting…");
    clearPoll();
    try {
      const { run_id, analysis_id } = await trainerApi.startStandaloneAnalysis({
        model_id: model.model_id,
        dataset_id: dataset.dataset_id,
      });
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

  const canRun = Boolean(model && dataset && !running);

  return (
    <div className="mx-auto w-full max-w-3xl pb-10 pt-1">
      <div className="mb-8 border-b border-white/[0.07] pb-6">
        <h1 className="text-xl font-semibold tracking-tight text-white">CNN analysis</h1>
        <p className="mt-1 text-[13px] text-white/45">Model · test images · run</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">Model</p>
          <ModelUploader
            compact
            uploadedModel={model}
            onModelUploaded={setModel}
            onModelRemoved={() => setModel(null)}
          />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">Test folder (ZIP)</p>
          <DatasetUploader
            compact
            uploadedDataset={dataset}
            onDatasetUploaded={setDataset}
            onDatasetRemoved={() => setDataset(null)}
          />
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-rose-300/90" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canRun}
          onClick={() => void handleRun()}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold transition",
            canRun
              ? "bg-white text-[#0a0a0a] shadow-[0_0_24px_rgba(255,255,255,0.12)] hover:bg-white/90"
              : "cursor-not-allowed bg-white/20 text-white/40",
          )}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {running ? "Running…" : "Run analysis"}
        </button>
        {running && phase ? (
          <span className="text-[12px] tabular-nums text-white/45">{phase}</span>
        ) : null}
      </div>
    </div>
  );
}
