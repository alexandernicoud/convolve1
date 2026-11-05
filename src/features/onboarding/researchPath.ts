export type ResearchStepId = "generate" | "train" | "analyze" | "backtest" | "improve";

export interface ResearchStep {
  id: ResearchStepId;
  title: string;
  what: string;
  to: string;
  cta: string;
  done: boolean;
  count: number;
}

export interface ResearchCounts {
  datasets: number;
  models: number;
  analyses: number;
  backtests: number;
  improveExperiments: number;
}

export function researchSteps(c: ResearchCounts): ResearchStep[] {
  return [
    { id: "generate", title: "Generate a dataset", what: "Turn a stock's price history into labelled chart images.", to: "/tools/generator", cta: "Open the Generator", done: c.datasets > 0, count: c.datasets },
    { id: "train", title: "Train a model", what: "Fit a CNN to the charts and check Model Health for real skill.", to: "/tools/trainer", cta: "Open the Trainer", done: c.models > 0, count: c.models },
    { id: "analyze", title: "Analyze it", what: "See which parts of the chart drive its predictions.", to: "/tools/analysis", cta: "Open the Analysis Lab", done: c.analyses > 0, count: c.analyses },
    { id: "backtest", title: "Backtest it", what: "Simulate its signals on a later period, net of costs, against baselines.", to: "/tools/backtester", cta: "Open the Backtester", done: c.backtests > 0, count: c.backtests },
    { id: "improve", title: "Improve it", what: "Run controlled experiments against the original and keep only real gains.", to: "/tools/improve", cta: "Open Improve", done: c.improveExperiments > 0, count: c.improveExperiments },
  ];
}

/** The first step not yet done; analysis is optional, so it is skipped once a later step is done. */
export function nextStep(steps: ResearchStep[]): ResearchStep | null {
  for (const s of steps) {
    if (s.done) continue;
    if (s.id === "analyze" && steps.some((x) => (x.id === "backtest" || x.id === "improve") && x.done)) continue;
    return s;
  }
  return null;
}
