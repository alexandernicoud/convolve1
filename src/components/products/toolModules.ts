import { PRODUCT_PIPELINE_ITEMS } from "./productPipelineLinks";

/**
 * Content-driven model for the “How each tool fits” system-module layout.
 * `paragraph`, `title`, `ctaHref` stay sourced from PRODUCT_PIPELINE_ITEMS so
 * we don't duplicate the canonical product copy — `thesis` and `bullets` are
 * the new presentation-layer additions.
 */
export type ToolModule = {
  id: string;
  number: string;
  title: string;
  thesis: string;
  bullets: string[];
  paragraph: string;
  ctaLabel: string;
  ctaHref: string;
};

type ModuleExtras = {
  thesis: string;
  bullets: [string, string, string];
};

const MODULE_EXTRAS: Record<string, ModuleExtras> = {
  generate: {
    thesis: "Mass-produce labeled chart datasets that match how you actually trade.",
    bullets: [
      "Volume and balance tuned to your markets and timeframes.",
      "Labeling stays tied to your visual rules, not generic stock charts.",
      "Exports batches ready for the trainer or the labeling optimizer.",
    ],
  },
  train: {
    thesis: "Turn raw charts into a model through reproducible runs, not one-off notebooks.",
    bullets: [
      "Every set of weights traces back to its exact dataset version.",
      "Dataset → hyperparameters → checkpoints → diagnostics, one loop.",
      "Compare experiments side-by-side inside a single workspace.",
    ],
  },
  analyze: {
    thesis: "Inspect why a model behaves the way it does — past the headline metric.",
    bullets: [
      "Technical diagnostics wired directly to each run's artifacts.",
      "Surfaces regime-specific failure modes that aggregate scores hide.",
      "Companion to Test: asks why, not just how well.",
    ],
  },
  test: {
    thesis: "Stress-test trained artifacts against real market history before live risk.",
    bullets: [
      "Evaluates the actual model you trained, not a simplified simulator.",
      "Drawdown, trade-style summaries, and per-window performance views.",
      "Gate between “model exists” and “model is worth operating.”",
    ],
  },
  optimize: {
    thesis: "Systematically improve labeling strategy — labels set the ceiling of the stack.",
    bullets: [
      "Structured search with runs you can compare, not eyeballed charts.",
      "Metrics tied to label quality, not generic headline accuracy.",
      "Outputs feed cleanly back into Generate and Train.",
    ],
  },
  deploy: {
    thesis: "Ship models as versioned bots your runtime can actually audit.",
    bullets: [
      "Packages runs with clear version IDs and rollback semantics.",
      "Built around environments, handoff, and operational control.",
      "Closes the loop from research to scheduled execution.",
    ],
  },
  dashboard: {
    thesis: "The seventh layer — where the pipeline becomes an operational system.",
    bullets: [
      "Unifies bots, runs, datasets and deployments on one surface.",
      "Chart-native workflows using the same IDs as Train and Deploy.",
      "The map of models in production, not a generic admin panel.",
    ],
  },
};

const pad = (n: number) => n.toString().padStart(2, "0");

export const TOOL_MODULES: ToolModule[] = PRODUCT_PIPELINE_ITEMS.map((item, index) => {
  const extras = MODULE_EXTRAS[item.id];
  if (!extras) {
    throw new Error(`Missing tool-module extras for "${item.id}". Update toolModules.ts.`);
  }
  return {
    id: item.id,
    number: pad(index + 1),
    title: item.label,
    thesis: extras.thesis,
    bullets: extras.bullets,
    paragraph: item.detail,
    ctaLabel: `Open ${item.label.toLowerCase()}`,
    ctaHref: item.href,
  };
});
