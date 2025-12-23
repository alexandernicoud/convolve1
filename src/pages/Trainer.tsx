import { useState } from "react";
import { Eye } from "lucide-react";
import ToolLayout from "@/components/ToolLayout";
import StatusPanel, { Status } from "@/components/StatusPanel";
import DropzoneUpload from "@/components/DropzoneUpload";
import SvgChart from "@/components/SvgChart";
import MetricCard from "@/components/MetricCard";

interface TrainerConfig {
  imageSize: number;
  batchSize: number;
  epochs: number;
  validationSplit: number;
}

const defaultConfig: TrainerConfig = {
  imageSize: 224,
  batchSize: 32,
  epochs: 50,
  validationSplit: 0.2,
};

// Mock training history
const generateTrainingHistory = () => {
  const history = [];
  for (let i = 1; i <= 50; i++) {
    history.push({
      epoch: i,
      accuracy: Math.min(0.95, 0.5 + (i / 50) * 0.4 + Math.random() * 0.05),
      loss: Math.max(0.1, 0.8 - (i / 50) * 0.6 + Math.random() * 0.05),
      val_accuracy: Math.min(0.92, 0.48 + (i / 50) * 0.38 + Math.random() * 0.06),
      val_loss: Math.max(0.15, 0.85 - (i / 50) * 0.55 + Math.random() * 0.08),
    });
  }
  return history;
};

export default function Trainer() {
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [config, setConfig] = useState<TrainerConfig>(defaultConfig);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [trainingHistory, setTrainingHistory] = useState<any[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleTrain = async () => {
    if (!datasetFile) return;

    setStatus('running');
    setProgress(0);
    setLogs([]);

    const simulateLogs = [
      "Loading dataset...",
      "Initializing CNN architecture...",
      "Starting training...",
      ...Array.from({ length: 10 }, (_, i) => `Epoch ${(i + 1) * 5}/${config.epochs} - loss: ${(0.8 - i * 0.06).toFixed(4)} - val_loss: ${(0.85 - i * 0.055).toFixed(4)}`),
      "Training complete",
      "Saving model weights...",
    ];

    for (let i = 0; i < simulateLogs.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      setLogs(prev => [...prev, simulateLogs[i]]);
      setProgress(((i + 1) / simulateLogs.length) * 100);
    }

    setTrainingHistory(generateTrainingHistory());
    setStatus('done');
  };

  const InputPanel = (
    <div className="space-y-6">
      <DropzoneUpload
        accept=".zip"
        label="Upload dataset ZIP"
        hint="Drag and drop or click to select"
        onFileSelect={setDatasetFile}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Image Size</label>
          <select
            value={config.imageSize}
            onChange={(e) => setConfig({ ...config, imageSize: parseInt(e.target.value) })}
            className="input-field w-full"
          >
            <option value="128">128 x 128</option>
            <option value="224">224 x 224</option>
            <option value="256">256 x 256</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Batch Size</label>
          <select
            value={config.batchSize}
            onChange={(e) => setConfig({ ...config, batchSize: parseInt(e.target.value) })}
            className="input-field w-full"
          >
            <option value="16">16</option>
            <option value="32">32</option>
            <option value="64">64</option>
            <option value="128">128</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Epochs</label>
          <input
            type="number"
            value={config.epochs}
            onChange={(e) => setConfig({ ...config, epochs: parseInt(e.target.value) })}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Validation Split</label>
          <input
            type="number"
            step="0.05"
            min="0.1"
            max="0.4"
            value={config.validationSplit}
            onChange={(e) => setConfig({ ...config, validationSplit: parseFloat(e.target.value) })}
            className="input-field w-full"
          />
        </div>
      </div>

      <button
        onClick={handleTrain}
        disabled={!datasetFile || status === 'running'}
        className="btn-primary w-full mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'running' ? 'Training...' : 'Start training'}
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

      {status === 'done' && trainingHistory.length > 0 && (
        <div className="space-y-6 animate-fade-in">
          {/* Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <MetricCard
              label="Val Accuracy"
              value={`${(trainingHistory[trainingHistory.length - 1].val_accuracy * 100).toFixed(1)}%`}
              trend="up"
            />
            <MetricCard
              label="Val Loss"
              value={trainingHistory[trainingHistory.length - 1].val_loss.toFixed(4)}
              trend="down"
            />
          </div>

          {/* Charts */}
          <SvgChart
            data={trainingHistory}
            xKey="epoch"
            yKey="accuracy"
            title="Accuracy vs Epoch"
            type="line"
          />

          <SvgChart
            data={trainingHistory}
            xKey="epoch"
            yKey="loss"
            title="Loss vs Epoch"
            type="area"
            color="hsl(0, 72%, 51%)"
          />

          <button
            onClick={() => setShowAnalysis(true)}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <Eye className="w-4 h-4" />
            View in-depth analysis
          </button>
        </div>
      )}
    </div>
  );

  const AdvancedPanel = showAnalysis ? (
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 pt-6">
      {['Filters', 'Activations', 'Grad-CAM', 'Saliency'].map((name) => (
        <div key={name} className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">{name}</h4>
          <div className="aspect-square bg-secondary rounded-md flex items-center justify-center border border-border">
            <span className="text-xs text-muted-foreground">{name.toLowerCase()}.png</span>
          </div>
        </div>
      ))}
    </div>
  ) : undefined;

  return (
    <ToolLayout
      title="Trainer"
      description="Train convolutional neural networks on your generated datasets."
      inputPanel={InputPanel}
      outputPanel={OutputPanel}
      advancedPanel={AdvancedPanel}
    />
  );
}
