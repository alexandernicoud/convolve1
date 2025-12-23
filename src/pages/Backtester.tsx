import { useState } from "react";
import { TrendingUp } from "lucide-react";
import ToolLayout from "@/components/ToolLayout";
import StatusPanel, { Status } from "@/components/StatusPanel";
import DropzoneUpload from "@/components/DropzoneUpload";
import SvgChart from "@/components/SvgChart";
import MetricCard from "@/components/MetricCard";

interface BacktestConfig {
  initialCapital: number;
  positionSize: number;
  slippage: number;
}

const defaultConfig: BacktestConfig = {
  initialCapital: 100000,
  positionSize: 0.1,
  slippage: 0.001,
};

// Generate mock backtest results
const generateBacktestResults = () => {
  const equity = [];
  let value = 100000;
  for (let i = 0; i < 252; i++) {
    value *= (1 + (Math.random() - 0.48) * 0.02);
    equity.push({
      day: i,
      equity: value,
      drawdown: Math.random() * -0.1,
    });
  }

  const returns = [];
  for (let i = 0; i < 12; i++) {
    returns.push({
      month: `M${i + 1}`,
      return: (Math.random() - 0.4) * 0.08,
    });
  }

  return { equity, returns };
};

export default function Backtester() {
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [config, setConfig] = useState<BacktestConfig>(defaultConfig);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<any>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleBacktest = async () => {
    if (!modelFile) return;

    setStatus('running');
    setProgress(0);
    setLogs([]);

    const simulateLogs = [
      "Loading model...",
      "Fetching test data...",
      "Generating signals...",
      "Simulating trades...",
      "Computing metrics...",
      "Backtest complete",
    ];

    for (let i = 0; i < simulateLogs.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      setLogs(prev => [...prev, simulateLogs[i]]);
      setProgress(((i + 1) / simulateLogs.length) * 100);
    }

    setResults({
      cagr: 0.187,
      totalReturn: 0.423,
      maxDrawdown: -0.156,
      sharpe: 1.42,
      winRate: 0.584,
      trades: 847,
      ...generateBacktestResults(),
    });
    setStatus('done');
  };

  const InputPanel = (
    <div className="space-y-6">
      <DropzoneUpload
        accept=".keras,.h5"
        label="Upload trained model"
        hint=".keras or .h5 file"
        onFileSelect={setModelFile}
      />

      <div>
        <label className="block text-sm text-muted-foreground mb-2">Initial Capital ($)</label>
        <input
          type="number"
          value={config.initialCapital}
          onChange={(e) => setConfig({ ...config, initialCapital: parseInt(e.target.value) })}
          className="input-field w-full"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Position Size</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="1"
            value={config.positionSize}
            onChange={(e) => setConfig({ ...config, positionSize: parseFloat(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Slippage</label>
          <input
            type="number"
            step="0.0001"
            min="0"
            max="0.01"
            value={config.slippage}
            onChange={(e) => setConfig({ ...config, slippage: parseFloat(e.target.value) })}
            className="input-field w-full"
          />
        </div>
      </div>

      <button
        onClick={handleBacktest}
        disabled={!modelFile || status === 'running'}
        className="btn-primary w-full mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'running' ? 'Running...' : 'Run backtest'}
      </button>
    </div>
  );

  const OutputPanel = (
    <div className="space-y-6">
      <StatusPanel
        status={status}
        progress={progress}
        logs={logs}
      />

      {status === 'done' && results && (
        <div className="space-y-6 animate-fade-in">
          {/* Key Metrics */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="CAGR" value={`${(results.cagr * 100).toFixed(1)}%`} trend="up" />
            <MetricCard label="Total Return" value={`${(results.totalReturn * 100).toFixed(1)}%`} trend="up" />
            <MetricCard label="Max DD" value={`${(results.maxDrawdown * 100).toFixed(1)}%`} trend="down" />
            <MetricCard label="Sharpe" value={results.sharpe.toFixed(2)} />
            <MetricCard label="Win Rate" value={`${(results.winRate * 100).toFixed(1)}%`} />
            <MetricCard label="Trades" value={results.trades} />
          </div>

          {/* Equity Curve */}
          <SvgChart
            data={results.equity}
            xKey="day"
            yKey="equity"
            title="Equity Curve"
            type="area"
          />

          {/* Monthly Returns */}
          <SvgChart
            data={results.returns}
            xKey="month"
            yKey="return"
            title="Monthly Returns"
            type="bar"
          />

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <TrendingUp className="w-4 h-4" />
            {showAdvanced ? 'Hide' : 'Show'} advanced insights
          </button>
        </div>
      )}
    </div>
  );

  const AdvancedPanel = showAdvanced && results ? (
    <div className="space-y-8 pt-6">
      {/* Drawdown Chart */}
      <SvgChart
        data={results.equity}
        xKey="day"
        yKey="drawdown"
        title="Drawdown Over Time"
        type="area"
        color="hsl(0, 72%, 51%)"
      />

      {/* Additional analysis placeholders */}
      <div className="grid md:grid-cols-3 gap-6">
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">Rolling Metrics</h4>
          <div className="h-40 bg-secondary rounded-md flex items-center justify-center border border-border">
            <span className="text-xs text-muted-foreground">rolling-metrics.svg</span>
          </div>
        </div>
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">Sensitivity Analysis</h4>
          <div className="h-40 bg-secondary rounded-md flex items-center justify-center border border-border">
            <span className="text-xs text-muted-foreground">sensitivity.svg</span>
          </div>
        </div>
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">Trade Distribution</h4>
          <div className="h-40 bg-secondary rounded-md flex items-center justify-center border border-border">
            <span className="text-xs text-muted-foreground">trades-dist.svg</span>
          </div>
        </div>
      </div>
    </div>
  ) : undefined;

  return (
    <ToolLayout
      title="Backtester"
      description="Validate model performance with comprehensive historical backtesting."
      inputPanel={InputPanel}
      outputPanel={OutputPanel}
      advancedPanel={AdvancedPanel}
    />
  );
}
