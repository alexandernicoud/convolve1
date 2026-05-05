import { useState } from "react";
import { X, AlertTriangle, Play, Calendar, Zap } from "lucide-react";
import { testDataGeneratorApi } from "@/lib/api";

interface TestDataGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerationStarted: (runId: string) => void;
}

interface TestDataConfig {
  symbols: string;
  dataset_name: string;
  use_candles: boolean;
  timeframe: string;
  span_unit: string;
  span_units_count: number;
  future_horizon_bars: number;
  tp_frac: number;
  sl_frac: number;
  img_dim: number;
  period_length_units: number;
  end_offset_units: number;
  use_sma: boolean;
  sma_length: number;
  test_period_start?: string;
  test_period_end?: string;
}

export default function TestDataGeneratorModal({
  isOpen,
  onClose,
  onGenerationStarted
}: TestDataGeneratorModalProps) {
  const [config, setConfig] = useState<TestDataConfig>({
    symbols: "",
    dataset_name: "",
    use_candles: true,
    timeframe: "1d",
    span_unit: "months",
    span_units_count: 6,
    future_horizon_bars: 7,
    tp_frac: 0.02,
    sl_frac: 0.01,
    img_dim: 224,
    period_length_units: 30,
    end_offset_units: 0,
    use_sma: false,
    sma_length: 20,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const validateConfig = (): boolean => {
    const newWarnings: string[] = [];

    if (!config.symbols.trim()) {
      setError("Symbols are required");
      return false;
    }

    if (!config.dataset_name.trim()) {
      setError("Dataset name is required");
      return false;
    }

    if (config.tp_frac <= 0 || config.sl_frac <= 0) {
      setError("TP and SL fractions must be greater than 0");
      return false;
    }

    if (config.tp_frac <= config.sl_frac) {
      newWarnings.push("TP should typically be greater than SL for meaningful labels");
    }

    if (config.img_dim < 64) {
      setError("Image dimensions must be at least 64");
      return false;
    }

    setWarnings(newWarnings);
    setError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateConfig()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await testDataGeneratorApi.startRun(config);
      onGenerationStarted(response.run_id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start test data generation");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative max-w-4xl w-full max-h-[90vh] overflow-y-auto bg-gradient-to-br from-[#0B0D14] to-[#1A1D2E] border border-[rgba(255,255,255,0.15)] rounded-2xl shadow-2xl my-6">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[rgba(255,255,255,0.15)]">
          <div>
            <h2 className="text-2xl font-semibold text-white">Generate Test Dataset</h2>
            <p className="text-[rgba(255,255,255,0.65)] mt-1">Create labeled charts for out-of-sample backtesting</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[rgba(255,255,255,0.05)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Warning Callout */}
        <div className="mx-6 mt-6 p-4 bg-[rgba(236,72,153,0.08)] border border-[rgba(236,72,153,0.25)] rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#fca5a5] mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-[#fca5a5] mb-2">IMPORTANT DATA LEAKAGE WARNING</h3>
              <p className="text-sm text-[rgba(255,255,255,0.8)]">
                The test dataset time period must NOT overlap with the training dataset period. If you generate test data from the same time window you trained on, the backtest is meaningless (data leakage). Always use future data that the model hasn't seen.
              </p>
            </div>
          </div>
        </div>

        {/* Period Reference (Optional) */}
        <div className="mx-6 mt-4 p-4 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.06)] rounded-lg">
          <h4 className="text-sm font-medium text-[#737373] mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Period Reference (Optional - For Your Records)
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[rgba(255,255,255,0.65)] mb-1">
                Test Period Start
              </label>
              <input
                type="date"
                value={config.test_period_start || ""}
                onChange={(e) => setConfig({ ...config, test_period_start: e.target.value })}
                className="w-full px-3 py-2 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[rgba(255,255,255,0.65)] mb-1">
                Test Period End
              </label>
              <input
                type="date"
                value={config.test_period_end || ""}
                onChange={(e) => setConfig({ ...config, test_period_end: e.target.value })}
                className="w-full px-3 py-2 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none text-sm"
              />
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Data Scope Section */}
          <div>
            <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Data Scope
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Symbols (comma-separated)
                </label>
                <input
                  type="text"
                  value={config.symbols}
                  onChange={(e) => setConfig({ ...config, symbols: e.target.value })}
                  placeholder="SPY,QQQ,AAPL"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white placeholder-[rgba(255,255,255,0.4)] focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Dataset Name
                </label>
                <input
                  type="text"
                  value={config.dataset_name}
                  onChange={(e) => setConfig({ ...config, dataset_name: e.target.value })}
                  placeholder="test_data_2024"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white placeholder-[rgba(255,255,255,0.4)] focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Timeframe
                </label>
                <select
                  value={config.timeframe}
                  onChange={(e) => setConfig({ ...config, timeframe: e.target.value })}
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                >
                  <option value="1d">Daily (1d)</option>
                  <option value="1wk">Weekly (1wk)</option>
                  <option value="1mo">Monthly (1mo)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Span Unit
                </label>
                <select
                  value={config.span_unit}
                  onChange={(e) => setConfig({ ...config, span_unit: e.target.value })}
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                >
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                  <option value="years">Years</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Span Count
                </label>
                <input
                  type="number"
                  value={config.span_units_count}
                  onChange={(e) => setConfig({ ...config, span_units_count: parseInt(e.target.value) || 6 })}
                  min="1"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Period Length (units)
                </label>
                <input
                  type="number"
                  value={config.period_length_units}
                  onChange={(e) => setConfig({ ...config, period_length_units: parseInt(e.target.value) || 30 })}
                  min="1"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  End Offset (units ago)
                </label>
                <input
                  type="number"
                  value={config.end_offset_units}
                  onChange={(e) => setConfig({ ...config, end_offset_units: parseInt(e.target.value) || 0 })}
                  min="0"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Labeling Section */}
          <div>
            <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Labeling Rules
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Future Horizon (bars)
                </label>
                <input
                  type="number"
                  value={config.future_horizon_bars}
                  onChange={(e) => setConfig({ ...config, future_horizon_bars: parseInt(e.target.value) || 7 })}
                  min="1"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Take Profit (%)
                </label>
                <input
                  type="number"
                  value={config.tp_frac}
                  onChange={(e) => setConfig({ ...config, tp_frac: parseFloat(e.target.value) || 0.02 })}
                  step="0.001"
                  min="0.001"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Stop Loss (%)
                </label>
                <input
                  type="number"
                  value={config.sl_frac}
                  onChange={(e) => setConfig({ ...config, sl_frac: parseFloat(e.target.value) || 0.01 })}
                  step="0.001"
                  min="0.001"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Chart Section */}
          <div>
            <h3 className="text-lg font-medium text-white mb-4">Chart Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Image Size
                </label>
                <input
                  type="number"
                  value={config.img_dim}
                  onChange={(e) => setConfig({ ...config, img_dim: parseInt(e.target.value) || 224 })}
                  min="64"
                  max="1024"
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Use Candlesticks
                </label>
                <select
                  value={config.use_candles ? "yes" : "no"}
                  onChange={(e) => setConfig({ ...config, use_candles: e.target.value === "yes" })}
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No (Line chart)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                  Use SMA
                </label>
                <select
                  value={config.use_sma ? "yes" : "no"}
                  onChange={(e) => setConfig({ ...config, use_sma: e.target.value === "yes" })}
                  className="w-full px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>

              {config.use_sma && (
                <div className="md:col-span-3">
                  <label className="block text-sm text-[rgba(255,255,255,0.65)] mb-2">
                    SMA Length
                  </label>
                  <input
                    type="number"
                    value={config.sma_length}
                    onChange={(e) => setConfig({ ...config, sma_length: parseInt(e.target.value) || 20 })}
                    min="2"
                    max="200"
                    className="w-full max-w-xs px-4 py-3 bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.15)] rounded-lg text-white focus:border-[rgba(255,255,255,0.06)] focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="p-4 bg-[rgba(236,72,153,0.08)] border border-[rgba(236,72,153,0.25)] rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#fca5a5] mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-[#fca5a5] mb-1">Warnings</h4>
                  <ul className="text-sm text-[rgba(255,255,255,0.8)] space-y-1">
                    {warnings.map((warning, i) => (
                      <li key={i}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-[rgba(236,72,153,0.1)] border border-[rgba(236,72,153,0.2)] rounded-lg">
              <p className="text-[rgba(236,72,153,0.8)]">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[rgba(255,255,255,0.15)]">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-[rgba(255,255,255,0.15)] text-white font-medium rounded-lg hover:border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 bg-white text-[#0a0a0a] font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              {isSubmitting ? 'Starting...' : 'Generate Test Data'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

