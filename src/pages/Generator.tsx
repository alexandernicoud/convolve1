import { useState, useEffect, useRef } from "react";
import { Download, RotateCcw, ArrowRight, X, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import ToolLayout from "@/components/ToolLayout";
import StatusPanel, { Status } from "@/components/StatusPanel";
import { trainingChartGeneratorApi } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";

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
}

const mapPhaseToStatus = (phase?: string) => {
  const normalized = (phase || '').toLowerCase();
  if (['done', 'completed', 'succeeded'].includes(normalized)) return 'succeeded';
  if (['error', 'failed'].includes(normalized)) return 'failed';
  if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
  return 'running';
};

const defaultConfig: GeneratorConfig = {
  symbols: "AAPL,MSFT,GOOGL,AMZN",
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
};

export default function Generator() {
  const [config, setConfig] = useState<GeneratorConfig>(defaultConfig);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [datasetStats, setDatasetStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<any>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const cancelFlagRef = useRef(false);
  const pollTokenRef = useRef(0);

  // Validation
  const validateConfig = (): string | null => {
    if (!config.symbols.trim()) return "Symbols are required";
    if (config.chartsPerLabel < 1) return "Charts per label must be at least 1";
    if (config.timespanCount < 1) return "Timespan count must be at least 1";
    if (config.horizonBars < 1) return "Horizon bars must be at least 1";
    if (config.takeProfitFraction <= 0 || config.takeProfitFraction > 1) return "Take profit fraction must be between 0 and 1";
    if (config.stopLossFraction <= 0 || config.stopLossFraction > 1) return "Stop loss fraction must be between 0 and 1";
    if (config.imageDimension < 64 || config.imageDimension > 1024) return "Image dimension must be between 64 and 1024";
    if (config.endOffset < 0) return "End offset must be non-negative";
    return null;
  };

  const handleGenerate = async () => {
    const validationError = validateConfig();
    if (validationError) {
      setError(validationError);
      setErrorDetails(null);
      return;
    }

    setStatus('running');
    setProgress(0);
    setCurrentPhase('Starting...');
    setElapsedTime(0);
    setRunId(null);
    setDatasetStats(null);
    setError(null);
    setErrorDetails(null);
    setIsCancelling(false);
    cancelFlagRef.current = false;

    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    startTimeRef.current = Date.now();

    try {
      // Start the generation
      const response = await trainingChartGeneratorApi.run(config);
      const newRunId = response.run_id;
      setRunId(newRunId);

      // Register the run in the global store
      useRunsStore.getState().registerRun({
        id: newRunId,
        tool: 'training-chart-generator',
        status: 'running',
        progress: 0.01,
        stage: 'starting',
        message: 'Initializing chart generator...',
        route: `/tools/generator/runs/${newRunId}`,
      });

      // Update status to running immediately
      console.log('Setting status to running for run:', newRunId);
      setStatus('running');
      setProgress(1); // Show immediate progress
      setCurrentPhase('Starting...');

      // Start polling for progress with a small delay
      const token = ++pollTokenRef.current;
      setTimeout(() => {
      console.log('Starting progress polling for run:', newRunId);
      pollProgress(newRunId, token);
      }, 500);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to start generation');
      setErrorDetails({
        type: 'network_error',
        message: 'Failed to communicate with backend',
        details: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const handleCancel = async () => {
    if (!runId || status !== 'running') {
      console.log('Cancel called but conditions not met:', { runId, status });
      return;
    }

    console.log('Starting cancel process for run:', runId);
    setIsCancelling(true);
    cancelFlagRef.current = true;

    try {
      // First try to cancel on the backend
      console.log('Calling backend cancel API...');
      await trainingChartGeneratorApi.cancel(runId);
      console.log('Successfully cancelled run on backend');

      // Stop polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      // Keep the cancelled state visible
      setStatus('cancelled');
      setIsCancelling(false);
      cancelFlagRef.current = false;
      useRunsStore.getState().updateRun(runId, {
        status: 'cancelled',
        message: 'Cancelled by user',
        stage: 'cancelled',
        progress: 0
      });
      } catch (cancelErr) {
      console.error('Backend cancel failed, doing local cancel:', cancelErr);

      // Even if backend cancel fails, stop polling and reset UI
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

      setStatus('cancelled');
      setIsCancelling(false);
      cancelFlagRef.current = false;
      useRunsStore.getState().updateRun(runId, {
        status: 'cancelled',
        message: 'Cancelled locally (backend may still be running)',
        stage: 'cancelled',
        progress: 0
      });

      // Show a message that local cancel was used
      setError('Generation cancelled locally (backend may still be running)');
      setErrorDetails({
        type: 'cancel_error',
        message: 'Local cancellation completed, but backend cancel failed',
        details: cancelErr instanceof Error ? cancelErr.message : String(cancelErr)
      });
    }
  };

  const pollProgress = async (runId: string, token: number) => {
    console.log('Starting progress polling for run:', runId);

    pollIntervalRef.current = setInterval(async () => {
      if (token !== pollTokenRef.current) {
        return;
      }
      // Check if cancelled
      if (cancelFlagRef.current) {
        console.log('Polling cancelled');
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
        }
        return;
      }

      try {
        console.log('Polling progress for run:', runId, 'at', new Date().toISOString());
        const progressData = await trainingChartGeneratorApi.getProgress(runId);
        console.log('Progress response:', progressData);

        const rawProgress = progressData.percent || 0;
        setProgress(prev => Math.max(prev, rawProgress));
        setCurrentPhase(progressData.phase || 'Processing...');
        useRunsStore.getState().updateRun(runId, {
          status: mapPhaseToStatus(progressData.phase),
          progress: rawProgress > 1 ? rawProgress / 100 : rawProgress,
          stage: progressData.phase || 'running',
          message: progressData.error_message || progressData.phase || 'Running'
        });

                if (startTimeRef.current) {
          setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }

        if (progressData.phase === 'done') {
          console.log('Generation completed');
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setStatus('done');
          useRunsStore.getState().updateRun(runId, {
            status: 'succeeded',
            progress: 1,
            stage: 'done',
            message: 'Completed'
          });

          // Fetch final stats
          try {
            const artifacts = await trainingChartGeneratorApi.getArtifacts(runId);
              setDatasetStats(artifacts);
            } catch (statsErr) {
              console.warn('Could not fetch dataset stats:', statsErr);
            setError('Generation completed but failed to load dataset statistics');
            setErrorDetails({
              type: 'stats_error',
              message: 'Could not load dataset statistics',
              details: statsErr instanceof Error ? statsErr.message : String(statsErr)
            });
          }
        } else if (progressData.phase === 'error') {
          console.log('Generation failed:', progressData.error_message);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setStatus('error');
          useRunsStore.getState().updateRun(runId, {
            status: 'failed',
            stage: 'error',
            message: progressData.error_message || 'Generation failed'
          });
          setError(progressData.error_message || 'Generation failed');
          setErrorDetails({
            type: 'generation_error',
            message: 'Chart generation process failed',
            details: progressData.error_message || 'Unknown error during generation',
            phase: progressData.phase,
            progress: progressData.percent
          });
        }
      } catch (err) {
        console.warn('Progress polling error:', err);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
          setStatus('error');
          setError('Lost connection to generation process');
          setErrorDetails({
            type: 'connection_error',
            message: 'Lost connection to backend during generation',
          details: err instanceof Error ? err.message : String(err)
          });
      }
    }, 2000); // Poll every 2 seconds
  };

  const handleDownload = async () => {
    if (!runId) return;

    try {
      await trainingChartGeneratorApi.download(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleRunAgain = () => {
    handleGenerate();
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const InputPanel = (
    <div className="space-y-5">
      <div>
        <label className="block text-sm text-[#F5F5F5]/62 mb-2">
          Symbols <span className="text-[#e5e5e5]">*</span>
        </label>
        <input
          type="text"
          value={config.symbols}
          onChange={(e) => setConfig({ ...config, symbols: e.target.value.toUpperCase() })}
          className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
          placeholder="AAPL,MSFT,GOOGL,AMZN"
        />
        <p className="text-xs text-[#F5F5F5]/50 mt-1">Comma-separated stock symbols</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Charts per Label <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="number"
            min="1"
            value={config.chartsPerLabel}
            onChange={(e) => setConfig({ ...config, chartsPerLabel: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Per symbol, per label (0/1)</p>
        </div>
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Chart Type <span className="text-[#e5e5e5]">*</span>
          </label>
          <select
            value={config.useCandles ? 'candles' : 'line'}
            onChange={(e) => setConfig({ ...config, useCandles: e.target.value === 'candles' })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
          >
            <option value="candles">Candlestick</option>
            <option value="line">Line Chart</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Timeframe <span className="text-[#e5e5e5]">*</span>
          </label>
          <select
            value={config.timeframe}
            onChange={(e) => setConfig({ ...config, timeframe: e.target.value as '1d' | '1wk' | '1mo' })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
          >
            <option value="1d">Daily (1d)</option>
            <option value="1wk">Weekly (1wk)</option>
            <option value="1mo">Monthly (1mo)</option>
          </select>
        </div>
      <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Timespan Unit <span className="text-[#e5e5e5]">*</span>
          </label>
        <input
          type="text"
            value={config.timespanUnit}
            onChange={(e) => setConfig({ ...config, timespanUnit: e.target.value })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
            placeholder="months"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">e.g., months, weeks, days</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Timespan Count <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="number"
            min="1"
            value={config.timespanCount}
            onChange={(e) => setConfig({ ...config, timespanCount: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">How many units for chart window</p>
        </div>
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Future Horizon (bars) <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="number"
            min="1"
            value={config.horizonBars}
            onChange={(e) => setConfig({ ...config, horizonBars: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Trading bars to look forward (7 recommended)</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Take Profit (fraction) <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0.001"
            max="1"
            value={config.takeProfitFraction}
            onChange={(e) => setConfig({ ...config, takeProfitFraction: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
            placeholder="0.02"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Profit target as fraction (0.02 = 2%)</p>
        </div>
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Stop Loss (fraction) <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0.001"
            max="1"
            value={config.stopLossFraction}
            onChange={(e) => setConfig({ ...config, stopLossFraction: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
            placeholder="0.01"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Loss limit as fraction (0.01 = 1%)</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
      <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            Image Dimension <span className="text-[#e5e5e5]">*</span>
          </label>
        <select
            value={config.imageDimension}
            onChange={(e) => setConfig({ ...config, imageDimension: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] focus:border-white/30 focus:ring-1 focus:ring-white/50"
          >
            <option value="128">128x128</option>
            <option value="224">224x224 (CNN standard)</option>
            <option value="256">256x256</option>
            <option value="512">512x512</option>
        </select>
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Square image size for CNN input</p>
        </div>
        <div>
          <label className="block text-sm text-[#F5F5F5]/62 mb-2">
            End Offset <span className="text-[#e5e5e5]">*</span>
          </label>
          <input
            type="number"
            min="0"
            value={config.endOffset}
            onChange={(e) => setConfig({ ...config, endOffset: parseInt(e.target.value) || 0 })}
            className="w-full px-3 py-2 bg-[#0a0a0a]/60 border border-white/8 rounded-lg text-[#F5F5F5] placeholder-[#F5F5F5]/40 focus:border-white/30 focus:ring-1 focus:ring-white/50"
            placeholder="1"
          />
          <p className="text-xs text-[#F5F5F5]/50 mt-1">Charts end N timeframe units ago</p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[#f87171]/10 border border-[#f87171]/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#f87171] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[#f87171] mb-2">
                {errorDetails?.type === 'network_error' ? 'Connection Error' :
                 errorDetails?.type === 'stats_error' ? 'Statistics Error' :
                 errorDetails?.type === 'generation_error' ? 'Generation Error' :
                 errorDetails?.type === 'connection_error' ? 'Connection Lost' :
                 'Error'}
              </h4>
              <p className="text-sm text-[#F5F5F5]/80 mb-2">{error}</p>
              {errorDetails && (
                <details className="text-xs text-[#F5F5F5]/60">
                  <summary className="cursor-pointer hover:text-[#F5F5F5]/80">Show technical details</summary>
                  <div className="mt-2 p-2 bg-[#0a0a0a]/60 rounded border border-white/5 font-mono">
                    {errorDetails.type && <div>Type: {errorDetails.type}</div>}
                    {errorDetails.phase && <div>Phase: {errorDetails.phase}</div>}
                    {errorDetails.progress !== undefined && <div>Progress: {errorDetails.progress}%</div>}
                    {errorDetails.details && (
                      <div className="mt-1 whitespace-pre-wrap break-all">
                        Details: {errorDetails.details}
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-6">
      <button
        onClick={handleGenerate}
          disabled={status === 'running' || isCancelling}
          className="flex-1 px-6 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'running' ? 'Generating Dataset...' : isCancelling ? 'Cancelling...' : 'Generate Dataset'}
        </button>

        {status === 'running' && !isCancelling && (
            <button
              onClick={() => {
                console.log('Cancel button clicked, status:', status, 'runId:', runId, 'isCancelling:', isCancelling);
                if (runId && status === 'running') {
                  handleCancel();
                } else {
                  console.log('Cancel conditions not met');
                }
              }}
              className="px-6 py-3 bg-transparent border border-[#f87171]/50 text-[#f87171] font-medium rounded-lg hover:bg-[#f87171]/10 hover:border-[#f87171] transition-all duration-200 flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
              </button>
        )}

        {isCancelling && (
          <div className="px-6 py-3 bg-[#f87171]/20 border border-[#f87171]/50 text-[#f87171] font-medium rounded-lg flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-[#f87171] border-t-transparent rounded-full animate-spin" />
            Cancelling...
          </div>
        )}
      </div>
    </div>
  );

  const OutputPanel = (
    <div className="space-y-6">
      {/* Status Display */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${
            status === 'idle' ? 'bg-[#0a0a0a] text-[#F5F5F5]/62' :
            status === 'running' ? 'bg-white/10 text-white' :
            status === 'done' ? 'bg-[#e5e5e5]/20 text-[#e5e5e5]' :
            'bg-[#f87171]/20 text-[#f87171]'
          }`}>
            {status === 'idle' ? 'Ready' :
             status === 'running' ? 'Running' :
             status === 'done' ? 'Complete' : 'Failed'}
          </div>
          {status === 'running' && (
            <span className="text-sm text-[#F5F5F5]/62">
              {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')} elapsed
            </span>
          )}
        </div>
      </div>

      {status === 'idle' && (
        <div className="text-center py-12">
          <div className="text-[#F5F5F5]/62 text-sm">
            Configure parameters and run the tool to see output here.
          </div>
        </div>
      )}

      {status === 'running' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[#F5F5F5]/80 text-sm font-medium">
              {currentPhase || 'Initializing...'}
            </div>
            <div className="text-[#F5F5F5]/62 text-xs">
              {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
            </div>
          </div>

          <div className="w-full bg-[#0a0a0a]/60 rounded-full h-3">
            <div
              className="bg-white h-3 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="text-[#F5F5F5]/62">
              {Math.round(progress)}% complete
            </div>
            {runId && (
              <div className="text-[#F5F5F5]/40 text-xs font-mono">
                ID: {runId.slice(-8)}
              </div>
            )}
          </div>

          {progress === 0 && elapsedTime > 10 && (
            <div className="p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                <div className="text-sm text-[#F5F5F5]/80">
                  <div className="font-medium text-[#F59E0B] mb-1">Still starting up...</div>
                  <div>This may take a moment. The backend is initializing the chart generation process.</div>
                </div>
              </div>
            </div>
          )}

          {progress > 0 && progress < 5 && elapsedTime > 30 && (
            <div className="p-3 bg-[#737373]/10 border border-[#737373]/20 rounded-lg">
              <div className="flex items-start gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-[#737373] border-t-transparent animate-spin flex-shrink-0 mt-0.5" />
                <div className="text-sm text-[#F5F5F5]/80">
                  <div className="font-medium text-[#737373] mb-1">Processing data...</div>
                  <div>Downloading market data and preparing chart generation. This step can take several minutes.</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'done' && datasetStats && (
        <div className="space-y-6">
          {/* Dataset Summary */}
          <div className="bg-[#0a0a0a]/60 border border-white/8 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#F5F5F5] mb-3">Dataset Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[#F5F5F5]/62">Symbols:</span>
                <span className="text-[#F5F5F5] ml-2">{config.symbols.split(',').length}</span>
              </div>
              <div>
                <span className="text-[#F5F5F5]/62">Timeframe:</span>
                <span className="text-[#F5F5F5] ml-2">{config.timeframe}</span>
              </div>
              <div>
                <span className="text-[#F5F5F5]/62">Total Charts:</span>
                <span className="text-[#F5F5F5] ml-2">{datasetStats.total_charts || 'Unknown'}</span>
              </div>
              <div>
                <span className="text-[#F5F5F5]/62">Chart Type:</span>
                <span className="text-[#F5F5F5] ml-2">{config.useCandles ? 'Candlestick' : 'Line'}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
          <button
            onClick={handleDownload}
              className="w-full px-4 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download ZIP
          </button>

            <button
              onClick={handleRunAgain}
              className="w-full px-4 py-3 bg-transparent border border-white/18 text-[#F5F5F5] font-medium rounded-lg hover:border-white/30/55 hover:bg-white/8 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Run Another Iteration
            </button>

            <Link to="/tools/trainer" className="block">
              <button className="w-full px-4 py-3 bg-transparent border border-white/18 text-[#F5F5F5] font-medium rounded-lg hover:border-white/30/55 hover:bg-white/8 transition-all duration-200 flex items-center justify-center gap-2">
                <ArrowRight className="w-4 h-4" />
                Continue to Trainer
              </button>
            </Link>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-4">
          <div className="bg-[#f87171]/10 border border-[#f87171]/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#f87171] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-[#f87171] mb-2">Generation Failed</h3>
                <p className="text-sm text-[#F5F5F5]/80 mb-2">{error}</p>
                {errorDetails && (
                  <details className="text-xs text-[#F5F5F5]/60">
                    <summary className="cursor-pointer hover:text-[#F5F5F5]/80">Show technical details</summary>
                    <div className="mt-2 p-2 bg-[#0a0a0a]/60 rounded border border-white/5 font-mono">
                      {errorDetails.type && <div>Error Type: {errorDetails.type}</div>}
                      {errorDetails.phase && <div>Last Phase: {errorDetails.phase}</div>}
                      {errorDetails.progress !== undefined && <div>Progress: {errorDetails.progress}%</div>}
                      {errorDetails.details && (
                        <div className="mt-1 whitespace-pre-wrap break-all">
                          Details: {errorDetails.details}
                        </div>
                      )}
                      {runId && <div>Run ID: {runId}</div>}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setStatus('idle');
                setError(null);
                setErrorDetails(null);
              }}
              className="flex-1 px-4 py-3 bg-transparent border border-white/18 text-[#F5F5F5] font-medium rounded-lg hover:border-white/30/55 hover:bg-white/8 transition-all duration-200"
            >
              Try Again
            </button>
            {runId && (
              <button
                onClick={() => {
                  // Reset everything
                  setStatus('idle');
                  setProgress(0);
                  setCurrentPhase('');
                  setElapsedTime(0);
                  setRunId(null);
                  setDatasetStats(null);
                  setError(null);
                  setErrorDetails(null);
                  setIsCancelling(false);
                  cancelFlagRef.current = false;
                  if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                  }
                }}
                className="px-4 py-3 bg-transparent border border-white/18 text-[#F5F5F5]/60 font-medium rounded-lg hover:border-[#F5F5F5]/40 hover:text-[#F5F5F5]/80 transition-all duration-200"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ToolLayout
        title="Generator"
        description="Create labeled candlestick chart datasets at scale for training visual market models."
        inputPanel={InputPanel}
        outputPanel={OutputPanel}
      />
    </div>
  );
}
