import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Play, Zap, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useRunsStore } from "@/state/runsStore";
import {
  backtesterApi,
  realtimeBacktesterApi,
  testDataGeneratorApi,
  BacktestStatusResponse,
  TestDataGeneratorStatusResponse,
  TestDataGeneratorResultResponse
} from "@/lib/api";
import ModelUploader from "@/components/ModelUploader";
import DatasetUploader from "@/components/DatasetUploader";
import TestDataGeneratorModal from "@/components/TestDataGeneratorModal";

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
  // Trading parameters
  startingCapital: number;
  positionSizePct: number;
  commissionPct: number;
  slippagePct: number;
  // Risk management
  maxDrawdownPct: number;
}

export default function Backtester() {
  const navigate = useNavigate();
  const { registerRun } = useRunsStore();

  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);

  // New real-time backtester state
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<BacktestStatusResponse | null>(null);
  const [runLogs, setRunLogs] = useState<string>("");
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const pollingTokenRef = useRef(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [uploadedDataset, setUploadedDataset] = useState<UploadedDataset | null>(null);
  const [isTestDataModalOpen, setIsTestDataModalOpen] = useState(false);
  const [showTestDataBanner, setShowTestDataBanner] = useState(false);
  const [testDataBannerMessage, setTestDataBannerMessage] = useState("");
  const [testDataRunId, setTestDataRunId] = useState<string | null>(null);
  const [testDataStatus, setTestDataStatus] = useState<TestDataGeneratorStatusResponse | null>(null);
  const [testDataResult, setTestDataResult] = useState<TestDataGeneratorResultResponse | null>(null);
  const [showTestDataResultModal, setShowTestDataResultModal] = useState(false);
  const [testDataError, setTestDataError] = useState<string | null>(null);

  const [config, setConfig] = useState<BacktesterConfig>({
    sampleSize: "all",
    confidenceThreshold: 0.5,
    tpPct: 2.0,
    slPct: 2.0,
    imgSize: 224,
    // Trading parameters
    startingCapital: 10000,
    positionSizePct: 10.0,
    commissionPct: 0.1,
    slippagePct: 0.05,
    // Risk management
    maxDrawdownPct: 20.0,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [runLogs]);

  // Polling effect for current run
  useEffect(() => {
    if (!currentRunId) return;

    const pollStatus = async () => {
      try {
        const status = await realtimeBacktesterApi.getStatus(currentRunId);
        setRunStatus(status);
        setRunLogs(status.log_tail);
        useRunsStore.getState().updateRun(currentRunId, {
          status: status.status,
          progress: status.progress,
          stage: status.message || 'running',
          message: status.message || 'Running'
        });

        // Stop polling if completed or failed
        if (status.status === 'succeeded' || status.status === 'failed') {
          setPollingInterval(null);
          if (status.status === 'succeeded') {
            // Navigate to results page
            navigate(`/tools/backtester/runs/${currentRunId}`);
          }
        }
      } catch (err) {
        console.error('Error polling backtest status:', err);
        setError('Failed to get backtest status');
        setPollingInterval(null);
      }
    };

    // Initial poll
    pollStatus();

    // Set up polling interval (every 1 second)
    const token = ++pollingTokenRef.current;
    const interval = setInterval(pollStatus, 1000);
    setPollingInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
      if (token === pollingTokenRef.current) {
        pollingTokenRef.current += 1;
      }
    };
  }, [currentRunId, navigate]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const handleModelUploaded = (model: UploadedModel) => {
    setUploadedModel(model);
    setConfig(prev => ({ ...prev, modelId: model.model_id }));
  };

  const handleModelRemoved = () => {
    setUploadedModel(null);
    setConfig(prev => ({ ...prev, modelId: undefined }));
  };

  const handleDatasetUploaded = (dataset: UploadedDataset) => {
    setUploadedDataset(dataset);
    setConfig(prev => ({ ...prev, datasetId: dataset.dataset_id }));
  };

  const handleDatasetRemoved = () => {
    setUploadedDataset(null);
    setConfig(prev => ({ ...prev, datasetId: undefined }));
  };

  const handleTestDataGenerationStarted = (runId: string) => {
    setTestDataRunId(runId);
    setTestDataResult(null);
    setTestDataStatus(null);
    setTestDataError(null);
    setShowTestDataResultModal(false);
    setTestDataBannerMessage(`Test data generation started (Run ID: ${runId.slice(-8)})`);
    setShowTestDataBanner(true);
    // Auto-hide banner after 5 seconds
    setTimeout(() => setShowTestDataBanner(false), 5000);
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

        if (status.status === 'succeeded') {
          const result = await testDataGeneratorApi.getResult(testDataRunId);
          if (!isActive) return;
          setTestDataResult(result);
          setShowTestDataResultModal(true);
          if (interval) clearInterval(interval);
        } else if (status.status === 'failed') {
          setTestDataError(status.message || 'Test data generation failed');
          setShowTestDataResultModal(true);
          if (interval) clearInterval(interval);
        }
      } catch (err) {
        if (!isActive) return;
        setTestDataError(err instanceof Error ? err.message : 'Failed to get test data status');
        setShowTestDataResultModal(true);
        if (interval) clearInterval(interval);
      }
    };

    pollTestData();
    interval = setInterval(pollTestData, 2000);

    return () => {
      isActive = false;
      if (interval) clearInterval(interval);
    };
  }, [testDataRunId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!uploadedModel) {
      setError("Please upload a Keras model first");
      return;
    }

    if (!uploadedDataset) {
      setError("Please upload a test dataset first");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setCurrentRunId(null);
    setRunStatus(null);
    setRunLogs("");

    try {
      const datasetPath = `backend/datasets/${uploadedDataset.dataset_id}/images`;

      const requestData = {
        model_id: uploadedModel.model_id,
        dataset_path: datasetPath,
        sample_size: config.sampleSize,
        confidence_threshold: config.confidenceThreshold,
        tp_pct: config.tpPct,
        sl_pct: config.slPct,
        img_size: config.imgSize,
        starting_capital: config.startingCapital,
        position_size_pct: config.positionSizePct,
        commission_pct: config.commissionPct,
        slippage_pct: config.slippagePct,
        max_drawdown_pct: config.maxDrawdownPct,
      };

      console.log('Starting real-time backtester with data:', requestData);

      const response = await realtimeBacktesterApi.startRun(requestData);
      const runId = response.run_id;

      console.log('Backtester started with run ID:', runId);

      // Register the run in the global store
      registerRun({
        id: runId,
        tool: 'backtester',
        status: 'running',
        progress: 0,
        stage: 'starting',
        message: 'Initializing backtester...',
        route: `/tools/backtester/runs/${runId}`,
      });

      // Start polling
      setCurrentRunId(runId);

    } catch (err) {
      console.error('Failed to start backtester:', err);
      setError(err instanceof Error ? err.message : "Failed to start backtest");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0a0a0a]">
      {/* Background gradients */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-20 left-10 w-96 h-96 bg-[rgba(255,255,255,0.06)] rounded-full blur-3xl"></div>
        <div className="absolute top-40 right-20 w-80 h-80 bg-[rgba(255,255,255,0.15)] rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-[rgba(236,72,153,0.12)] rounded-full blur-3xl"></div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden">
          {/* Form */}
          <div className="tech-surface p-5 sm:p-6 md:p-7">
            {/* Test Data Banner */}
            {showTestDataBanner && (
              <div className="mb-4 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.06)] p-3">
                <p className="text-sm text-[#737373]">{testDataBannerMessage}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Model + dataset — tight configuration row */}
              <div>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[rgba(255,255,255,0.55)]">
                    Model &amp; dataset
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsTestDataModalOpen(true)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-xs font-medium text-white transition hover:border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.06)]"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Generate test data
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
                  <div className="min-w-0">
                    <p className="mb-2 text-[11px] font-medium text-[rgba(255,255,255,0.5)]">Model (.keras)</p>
                    <ModelUploader
                      compact
                      onModelUploaded={handleModelUploaded}
                      onModelRemoved={handleModelRemoved}
                      uploadedModel={uploadedModel}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-2 text-[11px] font-medium text-[rgba(255,255,255,0.5)]">Test dataset (.zip)</p>
                    <DatasetUploader
                      compact
                      onDatasetUploaded={handleDatasetUploaded}
                      onDatasetRemoved={handleDatasetRemoved}
                      uploadedDataset={uploadedDataset}
                    />
                  </div>
                </div>
              </div>

              {/* Backtest Settings */}
              <div>
                <h2 className="text-lg font-medium text-white mb-4">Backtest Settings</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Sample Size */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Sample Size
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="sampleSize"
                          value="all"
                          checked={config.sampleSize === "all"}
                          onChange={(e) => setConfig({ ...config, sampleSize: e.target.value })}
                          className="mr-2 text-white focus:ring-white"
                        />
                        <span className="text-white">All</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="sampleSize"
                          value="custom"
                          checked={typeof config.sampleSize === 'number'}
                          onChange={() => setConfig({ ...config, sampleSize: 1000 })}
                          className="mr-2 text-white focus:ring-white"
                        />
                        <span className="text-white">Custom</span>
                      </label>
        </div>
                    {typeof config.sampleSize === 'number' && (
                      <input
                        type="number"
                        value={config.sampleSize}
                        onChange={(e) => setConfig({ ...config, sampleSize: parseInt(e.target.value) || 1000 })}
                        min="100"
                        max="10000"
                        className="mt-2 w-full px-3 py-2 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                      />
      )}
    </div>

                  {/* Confidence Threshold */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Confidence Threshold: {config.confidenceThreshold.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="0.9"
                      step="0.01"
                      value={config.confidenceThreshold}
                      onChange={(e) => setConfig({ ...config, confidenceThreshold: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-[rgba(255,255,255,0.15)] rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-xs text-[rgba(255,255,255,0.5)] mt-1">
                      <span>0.1</span>
                      <span>0.5</span>
                      <span>0.9</span>
          </div>
        </div>

                  {/* TP % */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Take Profit %
                    </label>
                    <input
                      type="number"
                      value={config.tpPct}
                      onChange={(e) => setConfig({ ...config, tpPct: parseFloat(e.target.value) || 0 })}
                      step="0.001"
                      min="0.001"
                      max="10"
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    />
                  </div>

                  {/* SL % */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Stop Loss %
                    </label>
                    <input
                      type="number"
                      value={config.slPct}
                      onChange={(e) => setConfig({ ...config, slPct: parseFloat(e.target.value) || 0 })}
                      step="0.001"
                      min="0.001"
                      max="10"
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    />
                  </div>

                  {/* Image Size */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Image Size
                    </label>
                    <select
                      value={config.imgSize}
                      onChange={(e) => setConfig({ ...config, imgSize: parseInt(e.target.value) })}
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    >
                      <option value="224">224x224 (Default)</option>
                      <option value="128">128x128</option>
                      <option value="256">256x256</option>
                    </select>
                  </div>
          </div>
        </div>

              {/* Trading Parameters */}
              <div>
                <h2 className="text-lg font-medium text-white mb-4">Trading Parameters</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Starting Capital */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Starting Capital
                    </label>
                    <input
                      type="number"
                      value={config.startingCapital}
                      onChange={(e) => setConfig({ ...config, startingCapital: parseFloat(e.target.value) || 10000 })}
                      step="1000"
                      min="1000"
                      max="1000000"
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    />
                  </div>

                  {/* Position Size % */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Position Size % of Capital
                    </label>
                    <input
                      type="number"
                      value={config.positionSizePct}
                      onChange={(e) => setConfig({ ...config, positionSizePct: parseFloat(e.target.value) || 10.0 })}
                      step="1"
                      min="1"
                      max="100"
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    />
                  </div>

                  {/* Commission % */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Commission % per Trade
                    </label>
                    <input
                      type="number"
                      value={config.commissionPct}
                      onChange={(e) => setConfig({ ...config, commissionPct: parseFloat(e.target.value) || 0.1 })}
                      step="0.01"
                      min="0"
                      max="1"
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    />
                  </div>

                  {/* Slippage % */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Slippage % per Trade
                    </label>
                    <input
                      type="number"
                      value={config.slippagePct}
                      onChange={(e) => setConfig({ ...config, slippagePct: parseFloat(e.target.value) || 0.05 })}
                      step="0.01"
                      min="0"
                      max="1"
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Risk Management */}
              <div>
                <h2 className="text-lg font-medium text-white mb-4">Risk Management</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Max Drawdown % */}
                  <div>
                    <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                      Max Drawdown % (Stop Trading)
                    </label>
                    <input
                      type="number"
                      value={config.maxDrawdownPct}
                      onChange={(e) => setConfig({ ...config, maxDrawdownPct: parseFloat(e.target.value) || 20.0 })}
                      step="1"
                      min="5"
                      max="50"
                      className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none transition-colors"
                    />
                  </div>

                </div>
              </div>

              {/* Error Display */}
              {error && (
                <div className="p-4 bg-[rgba(236,72,153,0.1)] border border-[rgba(236,72,153,0.2)] rounded-lg">
                  <p className="text-[rgba(236,72,153,0.8)]">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <div className="flex justify-center pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-8 py-4 bg-white text-[#0a0a0a] font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 text-lg"
                >
                  <Play className="w-5 h-5" />
                  {isSubmitting ? 'Starting Backtest...' : 'Run Backtest'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Live Backtest Progress */}
      {currentRunId && runStatus && (
        <div className="mt-8">
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.15)] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {runStatus.status === 'running' && (
                  <div className="w-5 h-5 border-2 border-[rgba(255,255,255,0.06)] border-t-[rgba(255,255,255,0.06)] rounded-full animate-spin"></div>
                )}
                {runStatus.status === 'succeeded' && (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                )}
                {runStatus.status === 'failed' && (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
                <h3 className="text-lg font-medium text-white">
                  Backtest {runStatus.status === 'running' ? 'Running' : runStatus.status === 'succeeded' ? 'Completed' : 'Failed'}
                </h3>
              </div>
              <div className="text-xs text-[rgba(255,255,255,0.5)]">
                Run ID: {currentRunId.slice(-8)}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="w-full bg-[rgba(0,0,0,0.3)] rounded-full h-3 mb-2">
                <div
                  className="bg-white h-3 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(5, Math.min(100, runStatus.progress * 100))}%` }}
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[rgba(255,255,255,0.7)]">{runStatus.message}</span>
                <span className="text-[rgba(255,255,255,0.5)]">{Math.round(runStatus.progress * 100)}%</span>
              </div>
            </div>

            {/* Live Logs */}
            <div className="bg-black/30 border border-[rgba(255,255,255,0.15)] rounded-lg p-4 max-h-64 overflow-y-auto">
              <div className="text-xs font-mono text-[rgba(255,255,255,0.7)] whitespace-pre-wrap">
                {runLogs || 'Waiting for logs...'}
                <div ref={logsEndRef} />
              </div>
            </div>

            {/* Error Display */}
            {runStatus.status === 'failed' && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <span className="text-red-400 font-medium">Backtest Failed</span>
                </div>
                <p className="text-red-300 text-sm">{runStatus.message}</p>
                <button
                  onClick={() => {
                    setCurrentRunId(null);
                    setRunStatus(null);
                    setRunLogs("");
                  }}
                  className="mt-3 px-4 py-2 bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors text-sm"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Test Data Generator Modal */}
      <TestDataGeneratorModal
        isOpen={isTestDataModalOpen}
        onClose={() => setIsTestDataModalOpen(false)}
        onGenerationStarted={handleTestDataGenerationStarted}
      />

      {showTestDataResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowTestDataResultModal(false)} />
          <div className="relative max-w-lg w-full bg-gradient-to-br from-[#0B0D14] to-[#1A1D2E] border border-[rgba(255,255,255,0.15)] rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Test Dataset</h2>
              <button
                onClick={() => setShowTestDataResultModal(false)}
                className="p-2 hover:bg-[rgba(255,255,255,0.05)] rounded-lg transition-colors"
              >
                <XCircle className="w-5 h-5 text-white" />
              </button>
            </div>

            {testDataError ? (
              <div className="p-4 bg-[rgba(236,72,153,0.1)] border border-[rgba(236,72,153,0.2)] rounded-lg text-[rgba(236,72,153,0.9)]">
                {testDataError}
              </div>
            ) : testDataResult ? (
              <div className="space-y-4">
                <div className="p-4 bg-[rgba(34,211,238,0.1)] border border-[rgba(34,211,238,0.2)] rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-[#e5e5e5]" />
                    <div>
                      <div className="text-sm font-medium text-white">Test dataset ready</div>
                      <div className="text-xs text-[rgba(255,255,255,0.65)]">
                        Dataset ID: {testDataResult.dataset_id}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 bg-[rgba(0,0,0,0.2)] rounded-lg">
                    <div className="text-[rgba(255,255,255,0.65)]">Total Images</div>
                    <div className="text-white font-medium">{testDataResult.summary.total_images}</div>
                  </div>
                  <div className="p-3 bg-[rgba(0,0,0,0.2)] rounded-lg">
                    <div className="text-[rgba(255,255,255,0.65)]">Date Range</div>
                    <div className="text-white font-medium">
                      {testDataResult.summary.start_date && testDataResult.summary.end_date
                        ? `${testDataResult.summary.start_date} → ${testDataResult.summary.end_date}`
                        : '—'}
                    </div>
                  </div>
                </div>

                {testDataRunId && (
                  <button
                    onClick={() => testDataGeneratorApi.downloadZip(testDataRunId)}
                    className="w-full px-4 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Download Test Dataset ZIP
                  </button>
                )}
              </div>
            ) : (
              <div className="p-4 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.06)] rounded-lg text-sm text-[#737373]">
                Test data generation in progress…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}