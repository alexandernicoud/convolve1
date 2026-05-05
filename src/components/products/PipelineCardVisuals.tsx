import trainingdataPng from "@/assets/trainingdata.png";
import trainingPng from "@/assets/training.png";
import backtesterPng from "@/assets/backtester.png";
import dashboardPng from "@/assets/dashboard.png";

function PipelineCardImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="flex h-full min-h-[220px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0A0C14] shadow-inner">
      <img
        src={src}
        alt={alt}
        className="h-full w-full min-h-[220px] object-cover object-top"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

export function ChartGeneratorVisual() {
  return <PipelineCardImage src={trainingdataPng} alt="Chart dataset samples in the chart generator" />;
}

export function LabelingOptimizerVisual() {
  return <PipelineCardImage src={trainingPng} alt="Labeling and analysis workspace" />;
}

export function ModelTrainerVisual() {
  return <PipelineCardImage src={trainingPng} alt="Model training and layer visualizations" />;
}

export function BacktesterVisual() {
  return <PipelineCardImage src={backtesterPng} alt="Backtester metrics and equity curve" />;
}

export function DeploymentVisual() {
  return <PipelineCardImage src={dashboardPng} alt="Live deployment and overview dashboard" />;
}
