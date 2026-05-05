import { useState, useEffect } from "react";
import { Download, RotateCcw, ArrowRight, Play, Eye, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import ToolLayout from "@/components/ToolLayout";
import { trainerApi, ApiError, type TrainerRunRequest } from "@/lib/api";

interface TrainerConfig {
  use_standard_config: boolean;
  folder_name: string;
  model_name: string;
  image_height?: number;
  image_width?: number;
  batch_size?: number;
  epochs?: number;
  val_split?: number;
  random_seed?: number;
}

interface TrainerProgress {
  status: 'ready' | 'running' | 'done' | 'failed';
  progress: {
    phase: string;
    percent: number;
    message: string;
    epoch?: number;
    epochs?: number;
    loss?: number;
    accuracy?: number;
    val_loss?: number;
    val_accuracy?: number;
  };
  last_metrics?: {
    epoch: number;
    epochs: number;
    loss: number;
    accuracy: number;
    val_loss: number;
    val_accuracy: number;
  };
  history_preview?: Array<{
    epoch: number;
    loss: number;
    accuracy: number;
    val_loss: number;
    val_accuracy: number;
  }>;
  artifact_paths?: string[];
}

interface AnalysisStatus {
  status: 'ready' | 'running' | 'done' | 'failed';
  progress: {
    phase: string;
    percent: number;
    message: string;
  };
  generated_files?: string[];
}

const defaultConfig: TrainerConfig = {
  use_standard_config: true,
  folder_name: "",
  model_name: "trained_model.keras",
  image_height: 224,
  image_width: 224,
  batch_size: 16,
  epochs: 30,
  val_split: 0.2,
  random_seed: 7,
};

export default function TrainerTechnicalPage() {
  const [config, setConfig] = useState<TrainerConfig>(defaultConfig);
  const [trainerProgress, setTrainerProgress] = useState<TrainerProgress | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Validation
  const validateConfig = (): string | null => {
    if (!config.folder_name.trim()) return "Training folder is required";
    if (!config.model_name.trim()) return "Model name is required";
    if (!config.model_name.endsWith('.keras')) return "Model name must end with .keras";

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

  // Start training
  const handleStartTraining = async () => {
    const validationError = validateConfig();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);

    try {
      const payload: TrainerRunRequest = {
        use_standard_config: config.use_standard_config,
        folder_name: config.folder_name,
        model_name: config.model_name,
        image_height: config.image_height,
        image_width: config.image_width,
        batch_size: config.batch_size,
        epochs: config.epochs,
        val_split: config.val_split,
        random_seed: config.random_seed,
      };
      const data = await trainerApi.run(payload);
      setRunId(data.run_id);
      setTrainerProgress({
        status: 'running',
        progress: { phase: 'starting', percent: 0, message: 'Initializing...' },
      });

      startPolling(data.run_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to start training');
    }
  };

  // Start analysis
  const handleStartAnalysis = async () => {
    if (!runId) return;

    try {
      const data = await trainerApi.startAnalysis(runId);
      setAnalysisId(data.analysis_id);
      setAnalysisStatus({
        status: 'running',
        progress: { phase: 'starting', percent: 0, message: 'Starting analysis...' },
      });

      startAnalysisPolling(runId, data.analysis_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to start analysis');
    }
  };

  // Polling functions
  const startPolling = (runId: string) => {
    if (pollingInterval) clearInterval(pollingInterval);

    const interval = setInterval(async () => {
      try {
        const data = await trainerApi.getProgress(runId);
        setTrainerProgress(data as TrainerProgress);

        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(interval);
          setPollingInterval(null);
        }
      } catch (err) {
        console.error('Polling error:', err);
        clearInterval(interval);
        setPollingInterval(null);
      }
    }, 2000);

    setPollingInterval(interval);
  };

  const startAnalysisPolling = (runId: string, analysisId: string) => {
    const interval = setInterval(async () => {
      try {
        const data = await trainerApi.getAnalysisStatus(runId, analysisId);
        setAnalysisStatus(data as AnalysisStatus);

        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Analysis polling error:', err);
        clearInterval(interval);
      }
    }, 2000);
  };

  // Download functions
  const handleDownloadModel = async () => {
    if (!runId) return;
    try {
      await trainerApi.downloadModel(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const handleDownloadAnalysis = async () => {
    if (!runId || !analysisId) return;
    try {
      await trainerApi.downloadAnalysis(runId, analysisId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  // Input panel
  const InputPanel = (
    <div className="space-y-6">
      {/* Standard Config Toggle */}
      <div>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.use_standard_config}
            onChange={(e) => setConfig({ ...config, use_standard_config: e.target.checked })}
            className="w-4 h-4 text-white bg-[#0a0a0a] border-white/30 rounded focus:ring-white focus:ring-2"
          />
          <span className="text-[#F5F5F5]/80">Use standard configuration (224x224, 16 batch, 30 epochs)</span>
        </label>
      </div>

      {/* Basic inputs */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Training Folder <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="text"
            value={config.folder_name}
            onChange={(e) => setConfig({ ...config, folder_name: e.target.value })}
            placeholder="e.g., /path/to/training/images"
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Path to folder containing labeled PNG images</p>
        </div>

        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Model Name <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="text"
            value={config.model_name}
            onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
            placeholder="trained_model.keras"
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Must end with .keras</p>
        </div>
      </div>

      {/* Advanced config */}
      {!config.use_standard_config && (
        <div className="space-y-4 p-4 bg-[#0a0a0a]/40 border border-white/8 rounded-lg">
          <h3 className="text-sm font-semibold text-[#F5F5F5]">Custom Configuration</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#F5F5F5]/62 mb-2">Image Height</label>
              <input
                type="number"
                min="32"
                max="1024"
                value={config.image_height}
                onChange={(e) => setConfig({ ...config, image_height: parseInt(e.target.value) || 224 })}
                className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="block text-sm text-[#F5F5F5]/62 mb-2">Image Width</label>
              <input
                type="number"
                min="32"
                max="1024"
                value={config.image_width}
                onChange={(e) => setConfig({ ...config, image_width: parseInt(e.target.value) || 224 })}
                className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="block text-sm text-[#F5F5F5]/62 mb-2">Batch Size</label>
              <input
                type="number"
                min="1"
                value={config.batch_size}
                onChange={(e) => setConfig({ ...config, batch_size: parseInt(e.target.value) || 16 })}
                className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="block text-sm text-[#F5F5F5]/62 mb-2">Epochs</label>
              <input
                type="number"
                min="1"
                value={config.epochs}
                onChange={(e) => setConfig({ ...config, epochs: parseInt(e.target.value) || 30 })}
                className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="block text-sm text-[#F5F5F5]/62 mb-2">Val Split</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="0.9"
                value={config.val_split}
                onChange={(e) => setConfig({ ...config, val_split: parseFloat(e.target.value) || 0.2 })}
                className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
            <div>
              <label className="block text-sm text-[#F5F5F5]/62 mb-2">Random Seed</label>
              <input
                type="number"
                value={config.random_seed}
                onChange={(e) => setConfig({ ...config, random_seed: parseInt(e.target.value) || 7 })}
                className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
              />
            </div>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="p-4 bg-[#f87171]/10 border border-[#f87171]/20 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 text-[#f87171] mt-0.5">⚠️</div>
            <div>
              <h4 className="text-sm font-semibold text-[#f87171] mb-1">Configuration Error</h4>
              <p className="text-sm text-[#F5F5F5]/80">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Start button */}
      <button
        onClick={handleStartTraining}
        disabled={trainerProgress?.status === 'running'}
        className="w-full px-6 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Play className="w-4 h-4" />
        {trainerProgress?.status === 'running' ? 'Training in Progress...' : 'Start Training'}
      </button>
    </div>
  );

  // Output panel
  const OutputPanel = (
    <div className="space-y-6">
      {/* Status */}
      {trainerProgress && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${
              trainerProgress.status === 'running' ? 'bg-white/10 text-white' :
              trainerProgress.status === 'done' ? 'bg-[#e5e5e5]/20 text-[#e5e5e5]' :
              'bg-[#f87171]/20 text-[#f87171]'
            }`}>
              {trainerProgress.status === 'running' ? 'Training' :
               trainerProgress.status === 'done' ? 'Complete' : 'Failed'}
            </div>
            {trainerProgress.status === 'running' && runId && (
              <span className="text-[#F5F5F5]/62 text-xs font-mono">
                ID: {runId.slice(-8)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Progress display */}
      {trainerProgress?.status === 'running' && (
        <div className="space-y-4">
          <div className="text-[#F5F5F5]/80 text-sm font-medium">
            {trainerProgress.progress.message}
          </div>

          <div className="w-full bg-[#0a0a0a]/60 rounded-full h-3">
            <div
              className="bg-white h-3 rounded-full transition-all duration-500"
              style={{ width: `${trainerProgress.progress.percent}%` }}
            />
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-[#F5F5F5]/62">
              {trainerProgress.progress.percent.toFixed(1)}% complete
            </span>
            {trainerProgress.last_metrics && (
              <span className="text-[#F5F5F5]/62">
                Epoch {trainerProgress.last_metrics.epoch}/{trainerProgress.last_metrics.epochs}
              </span>
            )}
          </div>

          {/* Live metrics */}
          {trainerProgress.last_metrics && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-[#0a0a0a]/40 border border-white/8 rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">
                  {trainerProgress.last_metrics.accuracy.toFixed(3)}
                </div>
                <div className="text-xs text-[#F5F5F5]/62">Accuracy</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white">
                  {trainerProgress.last_metrics.val_accuracy.toFixed(3)}
                </div>
                <div className="text-xs text-[#F5F5F5]/62">Val Accuracy</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white/90">
                  {trainerProgress.last_metrics.loss.toFixed(3)}
                </div>
                <div className="text-xs text-[#F5F5F5]/62">Loss</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white/90">
                  {trainerProgress.last_metrics.val_loss.toFixed(3)}
                </div>
                <div className="text-xs text-[#F5F5F5]/62">Val Loss</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completed state */}
      {trainerProgress?.status === 'done' && (
        <div className="space-y-4">
          <div className="p-4 bg-[#e5e5e5]/10 border border-[#e5e5e5]/20 rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-[#e5e5e5]/20 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-[#e5e5e5] rounded-full"></div>
              </div>
              <h3 className="text-lg font-semibold text-[#e5e5e5]">Training Completed!</h3>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <span className="text-[#F5F5F5]/62 text-sm">Model:</span>
                <span className="text-[#F5F5F5] ml-2">{config.model_name}</span>
              </div>
              <div>
                <span className="text-[#F5F5F5]/62 text-sm">Final Accuracy:</span>
                <span className="text-[#F5F5F5] ml-2">
                  {trainerProgress.last_metrics?.accuracy.toFixed(3) || 'N/A'}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDownloadModel}
                className="flex-1 px-4 py-2 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Model
              </button>

              <button
                onClick={handleStartAnalysis}
                disabled={analysisStatus?.status === 'running'}
                className="flex-1 rounded-lg border border-white/25 bg-transparent px-4 py-2 font-medium text-white transition-all duration-200 hover:border-white/40 hover:bg-white/[0.06] flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Eye className="w-4 h-4" />
                {analysisStatus?.status === 'running' ? 'Analyzing...' : 'Visual Analysis'}
              </button>
            </div>
          </div>

          {/* Analysis progress */}
          {analysisStatus && (
            <div className="p-4 bg-[#0a0a0a]/40 border border-white/8 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-[#F5F5F5]">CNN Analysis</h4>
                <div className={`rounded-full px-2 py-1 text-xs font-medium ${
                  analysisStatus.status === 'running' ? 'bg-white/10 text-white' :
                  analysisStatus.status === 'done' ? 'bg-white/15 text-white' :
                  'bg-white/5 text-white/70'
                }`}>
                  {analysisStatus.status === 'running' ? 'Running' :
                   analysisStatus.status === 'done' ? 'Complete' : 'Failed'}
                </div>
              </div>

              {analysisStatus.status === 'running' && (
                <>
                  <div className="text-sm text-[#F5F5F5]/80 mb-2">
                    {analysisStatus.progress.message}
                  </div>
                  <div className="w-full bg-[#0a0a0a]/60 rounded-full h-2 mb-2">
                    <div
                      className="h-2 rounded-full bg-white/80 transition-all duration-300"
                      style={{ width: `${analysisStatus.progress.percent}%` }}
                    />
                  </div>
                </>
              )}

              {analysisStatus.status === 'done' && analysisId && (
                <button
                  onClick={handleDownloadAnalysis}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 font-medium text-[#0a0a0a] transition-all duration-200 hover:bg-white/90"
                >
                  <Download className="w-4 h-4" />
                  Download Analysis ZIP
                </button>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setTrainerProgress(null);
                setRunId(null);
                setAnalysisStatus(null);
                setAnalysisId(null);
                setError(null);
              }}
              className="flex-1 px-4 py-3 bg-transparent border border-white/18 text-[#F5F5F5] font-medium rounded-lg hover:border-white/30/55 hover:bg-white/8 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Train Another Model
            </button>

            <Link to="/tools/backtester" className="flex-1">
              <button className="w-full px-4 py-3 bg-transparent border border-white/18 text-[#F5F5F5] font-medium rounded-lg hover:border-[#e5e5e5]/55 hover:bg-[#e5e5e5]/8 transition-all duration-200 flex items-center justify-center gap-2">
                <ArrowRight className="w-4 h-4" />
                Continue to Backtester
              </button>
            </Link>
          </div>
        </div>
      )}

      {/* Error state */}
      {trainerProgress?.status === 'failed' && (
        <div className="p-4 bg-[#f87171]/10 border border-[#f87171]/20 rounded-lg">
          <h3 className="text-sm font-semibold text-[#f87171] mb-2">Training Failed</h3>
          <p className="text-sm text-[#F5F5F5]/80">
            {trainerProgress.progress.message || 'An unknown error occurred during training.'}
          </p>
          <button
            onClick={() => {
              setTrainerProgress(null);
              setRunId(null);
              setError(null);
            }}
            className="mt-3 px-4 py-2 bg-transparent border border-white/18 text-[#F5F5F5] font-medium rounded-lg hover:border-white/30/55 hover:bg-white/8 transition-all duration-200"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!trainerProgress && (
        <div className="text-center py-12">
          <div className="text-[#F5F5F5]/62 text-sm">
            Configure parameters and start training to see live metrics here.
          </div>
        </div>
      )}
    </div>
  );

  return (
    <ToolLayout
      title="Trainer"
      description="Train convolutional neural networks on labeled candlestick chart datasets."
      inputPanel={InputPanel}
      outputPanel={OutputPanel}
    />
  );
}
