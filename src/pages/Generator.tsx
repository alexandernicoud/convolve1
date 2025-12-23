import { useState } from "react";
import { Download } from "lucide-react";
import ToolLayout from "@/components/ToolLayout";
import StatusPanel, { Status } from "@/components/StatusPanel";

interface GeneratorConfig {
  symbols: string;
  chartsCount: number;
  timeframe: string;
  timespan: string;
  horizon: number;
  takeProfit: number;
  stopLoss: number;
  imageSize: number;
}

const defaultConfig: GeneratorConfig = {
  symbols: "AAPL,MSFT,GOOGL,AMZN",
  chartsCount: 1000,
  timeframe: "1h",
  timespan: "2020-01-01:2024-01-01",
  horizon: 24,
  takeProfit: 2.0,
  stopLoss: 1.0,
  imageSize: 224,
};

export default function Generator() {
  const [config, setConfig] = useState<GeneratorConfig>(defaultConfig);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const handleGenerate = async () => {
    setStatus('running');
    setProgress(0);
    setLogs([]);

    // Simulate generation process
    const simulateLogs = [
      "Initializing dataset generator...",
      `Loaded ${config.symbols.split(',').length} symbols`,
      "Fetching historical data...",
      "Processing candlestick patterns...",
      "Generating training samples...",
      "Applying labels...",
      "Packaging dataset...",
      "Generation complete",
    ];

    for (let i = 0; i < simulateLogs.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 600));
      setLogs(prev => [...prev, simulateLogs[i]]);
      setProgress(((i + 1) / simulateLogs.length) * 100);
    }

    setStatus('done');
  };

  const handleDownload = () => {
    // Placeholder for actual download
    console.log("Downloading dataset...");
  };

  const InputPanel = (
    <div className="space-y-5">
      <div>
        <label className="block text-sm text-muted-foreground mb-2">Symbols</label>
        <input
          type="text"
          value={config.symbols}
          onChange={(e) => setConfig({ ...config, symbols: e.target.value })}
          className="input-field w-full"
          placeholder="AAPL,MSFT,GOOGL"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Charts Count</label>
          <input
            type="number"
            value={config.chartsCount}
            onChange={(e) => setConfig({ ...config, chartsCount: parseInt(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Timeframe</label>
          <select
            value={config.timeframe}
            onChange={(e) => setConfig({ ...config, timeframe: e.target.value })}
            className="input-field w-full"
          >
            <option value="1m">1 minute</option>
            <option value="5m">5 minutes</option>
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="4h">4 hours</option>
            <option value="1d">1 day</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm text-muted-foreground mb-2">Timespan</label>
        <input
          type="text"
          value={config.timespan}
          onChange={(e) => setConfig({ ...config, timespan: e.target.value })}
          className="input-field w-full"
          placeholder="2020-01-01:2024-01-01"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Horizon (bars)</label>
          <input
            type="number"
            value={config.horizon}
            onChange={(e) => setConfig({ ...config, horizon: parseInt(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-2">TP (%)</label>
          <input
            type="number"
            step="0.1"
            value={config.takeProfit}
            onChange={(e) => setConfig({ ...config, takeProfit: parseFloat(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-2">SL (%)</label>
          <input
            type="number"
            step="0.1"
            value={config.stopLoss}
            onChange={(e) => setConfig({ ...config, stopLoss: parseFloat(e.target.value) })}
            className="input-field w-full"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm text-muted-foreground mb-2">Image Size (px)</label>
        <select
          value={config.imageSize}
          onChange={(e) => setConfig({ ...config, imageSize: parseInt(e.target.value) })}
          className="input-field w-full"
        >
          <option value="128">128 x 128</option>
          <option value="224">224 x 224</option>
          <option value="256">256 x 256</option>
          <option value="512">512 x 512</option>
        </select>
      </div>

      <button
        onClick={handleGenerate}
        disabled={status === 'running'}
        className="btn-primary w-full mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'running' ? 'Generating...' : 'Generate dataset'}
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

      {status === 'done' && (
        <div className="space-y-6 animate-fade-in">
          <button
            onClick={handleDownload}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download ZIP
          </button>

          {/* Example training chart */}
          <div className="border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
              Example training sample
            </p>
            <div className="aspect-square bg-secondary rounded-md flex items-center justify-center">
              <span className="text-sm text-muted-foreground">training-chart.png</span>
            </div>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Example of a single generated training sample (CNN input image)
            </p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <ToolLayout
      title="Generator"
      description="Create labeled candlestick chart datasets at scale for training visual market models."
      inputPanel={InputPanel}
      outputPanel={OutputPanel}
    />
  );
}
