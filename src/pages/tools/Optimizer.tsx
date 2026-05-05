import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import ToolLayout from "@/components/ToolLayout";
import StatusPanel, { Status } from "@/components/StatusPanel";

export default function Optimizer() {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  // Form state
  const [symbols, setSymbols] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [tpRange, setTpRange] = useState("0.5,1.0,1.5,2.0");
  const [slRange, setSlRange] = useState("0.5,1.0,1.5,2.0");
  const [horizonRange, setHorizonRange] = useState("12,24,48");
  const [objective, setObjective] = useState("accuracy");

  const handleRunOptimization = () => {
    setStatus('running');
    setProgress(0);
    setLogs([]);

    // Mock optimization process
    const mockLogs = [
      "Initializing optimization routine...",
      "Loading historical data for BTCUSDT...",
      "Testing TP=0.5%, SL=0.5%, H=12...",
      "Testing TP=0.5%, SL=1.0%, H=12...",
      "Testing TP=1.0%, SL=0.5%, H=24...",
      "Evaluating objective function...",
      "Best configuration found: TP=1.5%, SL=1.0%, H=24",
      "Optimization complete.",
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < mockLogs.length) {
        setLogs(prev => [...prev, mockLogs[i]]);
        setProgress(((i + 1) / mockLogs.length) * 100);
        i++;
      } else {
        clearInterval(interval);
        setStatus('done');
      }
    }, 600);
  };

  const inputPanel = (
    <div className="space-y-6">
      <div>
        <Link 
          to="/products/labeling-optimizer/technical" 
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to product
        </Link>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Symbols
          </label>
          <input
            type="text"
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="BTCUSDT, ETHUSDT"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Timeframe
          </label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="1m">1 minute</option>
            <option value="5m">5 minutes</option>
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="4h">4 hours</option>
            <option value="1d">1 day</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Take-Profit Range (%)
          </label>
          <input
            type="text"
            value={tpRange}
            onChange={(e) => setTpRange(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="0.5,1.0,1.5,2.0"
          />
          <p className="text-xs text-muted-foreground mt-1">Comma-separated values</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Stop-Loss Range (%)
          </label>
          <input
            type="text"
            value={slRange}
            onChange={(e) => setSlRange(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="0.5,1.0,1.5,2.0"
          />
          <p className="text-xs text-muted-foreground mt-1">Comma-separated values</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Horizon Range (candles)
          </label>
          <input
            type="text"
            value={horizonRange}
            onChange={(e) => setHorizonRange(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="12,24,48"
          />
          <p className="text-xs text-muted-foreground mt-1">Comma-separated values</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Objective Function
          </label>
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="accuracy">Maximize Accuracy</option>
            <option value="balance">Class Balance</option>
            <option value="f1">F1 Score</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleRunOptimization}
        disabled={status === 'running'}
        className="w-full px-6 py-2.5 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'running' ? 'Optimizing...' : 'Run optimization'}
      </button>
    </div>
  );

  const outputPanel = (
    <StatusPanel
      status={status}
      progress={progress}
      logs={logs}
    />
  );

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ToolLayout
        title="Labeling Optimizer"
        description="Search for optimal labeling parameters"
        inputPanel={inputPanel}
        outputPanel={outputPanel}
      />
    </div>
  );
}
