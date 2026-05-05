/**
 * Single source for Product hub + header “Pipeline” dropdown — same order, labels, routes, and short blurbs.
 * Long-form `detail` powers the deep-dive section on `/products` only.
 * Order: Generate → Train → Analyze → Test → Optimize → Deploy → Dashboard (unifies the stack).
 */
export type ProductPipelineItem = {
  id: string;
  label: string;
  href: string;
  /** One line for cards + dropdown */
  description: string;
  /** Brief deep-dive: why it exists, what’s unique, what it does, how to use (5+ sentences). */
  detail: string;
};

export const PRODUCT_PIPELINE_ITEMS: ProductPipelineItem[] = [
  {
    id: "generate",
    label: "Generate",
    href: "/tools/generator",
    description:
      "Create large sets of custom-labeled charts for training — fast, repeatable, and tuned to your markets.",
    detail: `Real models need more than a handful of screenshots: they need volume, balance, and labels that match how you actually trade. The generator exists so you can mass-produce chart datasets without hand-drawing every bar, which is what makes Convolve scalable when you iterate on markets or timeframes. What sets it apart is that generation stays tied to your labeling rules and visual style, not generic stock photos or random charts. In practice you configure sources, labels, and batch sizes, then export datasets ready for training or optimizer experiments. You use it by opening the generator, choosing parameters, running batches, and reviewing outputs before they feed the trainer or the labeling optimizer. Expect to revisit settings as you refine what “good” examples look like for your edge case.`,
  },
  {
    id: "train",
    label: "Train",
    href: "/tools/trainer",
    description:
      "Train convolutional models on your data with clear runs, metrics, and experiment history.",
    detail: `Training is where raw charts become a model that generalizes beyond memorization, so the trainer is built around reproducible runs rather than one-off notebooks. Its uniqueness is the tight loop between datasets, hyperparameters, and logged curves—you always know which data version produced which weights. The tool walks you from dataset selection through training jobs, checkpoints, and basic diagnostics so you are not guessing whether a run succeeded. You operate it by attaching a dataset, setting run options, starting training, and comparing outcomes across experiments in the same workspace. Over time you rely on that history to decide when to add data, change architecture, or move on to backtesting. It is the hub most people mean when they say they are “building” inside Convolve.`,
  },
  {
    id: "analyze",
    label: "Analyze",
    href: "/tools/analysis",
    description:
      "Inspect trained runs with technical views—metrics, layers, and diagnostics beyond headline accuracy.",
    detail: `Sometimes aggregate scores hide failure modes that only show up in specific patterns or regimes, which is why Analyze exists as a dedicated inspection surface after training. It is unique in how it connects run artifacts to interpretable breakdowns—helping you see where the model is brittle or biased on chart inputs rather than a single loss number. The tool surfaces technical analysis views tied to your runs so you can validate behavior before you trust a model in Test or Deploy. You use it by opening analysis from a completed run, walking through the provided diagnostics, and noting what to fix in data or architecture. It complements the backtester: backtest asks how strategy-like performance looks; Analyze asks why the model behaves that way on inputs. Together they reduce the chance of shipping a model that only looked good on averages.`,
  },
  {
    id: "test",
    label: "Test",
    href: "/tools/backtester",
    description: "Backtest models on historical data and review performance before you commit capital.",
    detail: `Backtesting answers whether a model’s behavior on past data justifies confidence before live risk, which is why Test sits after Train in the pipeline rather than as an afterthought. The backtester is distinctive because it evaluates your actual trained artifacts against market history with the same chart-native framing you used in training, not a separate simplified simulator. It produces performance views, drawdowns, and trade-style summaries you can scan quickly or dig into when something looks off. You use it by selecting a model and a historical window, launching a run, and reading results before promoting anything toward deployment. The goal is not to promise future returns but to stress assumptions under realistic sequences. Treat it as the gate between “model exists” and “model is worth operating.”`,
  },
  {
    id: "optimize",
    label: "Optimize",
    href: "/products/labeling-optimizer/technical",
    description:
      "Improve labeling strategy and dataset quality with optimizer runs and reproducible outputs.",
    detail: `Labels quietly determine the ceiling of any supervised pipeline, so optimization is about systematically improving how examples are tagged—not eyeballing a few charts. The labeling optimizer is unique in how it searches labeling strategies while keeping runs comparable, so you can see whether a change actually helped rather than chasing noise. It runs structured experiments, surfaces metrics tied to label quality, and outputs artifacts you can feed back into Generate or Train. You work with it by defining a search space or presets, launching runs, comparing results, and promoting the best configuration into your dataset workflow. Teams use it when accuracy plateaus or when market regimes shift and old labels stop matching reality. Think of it as R&D for the human-in-the-loop part of the stack.`,
  },
  {
    id: "deploy",
    label: "Deploy",
    href: "/tools/deploy",
    description: "Ship bots to your environment with deployment flows built for iteration and control.",
    detail: `A model in a notebook is not production; deployment is how predictions reach your execution or monitoring stack with guardrails you can audit. Deploy focuses on packaging runs into deployable bots with clear versioning so you always know what logic is live. Unlike a generic “export weights” button, it is oriented around operational concerns: environments, rollbacks, and handoff to dashboards. You use the deploy flow after a model has passed testing and you are ready to connect it to your runtime or paper-trading setup. Iteration means promoting new builds, retiring old ones, and tracing issues back to a specific run. It closes the loop from research to something that can actually run on a schedule or stream.`,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    description:
      "The seventh layer: one surface that unifies bots, runs, portfolio, and history—where the pipeline becomes operational reality.",
    detail: `Every earlier tool produces artifacts—datasets, weights, backtests, deployments—but without a single place to see them together, teams lose track of what is live versus experimental. The dashboard exists to unify Generate through Deploy into one operational picture: which bots run, how they perform, and how that ties back to the runs that created them. What makes it central to Convolve is that it is not a generic admin panel; it is built around chart-native trading workflows, versioning, and the same IDs you see in Train and Deploy. You use it to monitor health, jump into a bot or run, compare outcomes, and decide what to promote or retire. Over time it becomes the map of your organization’s models in production. That is why we treat it as the seventh and most important product: it is where the pipeline stops being a sequence of tools and becomes a coherent system you can trust.`,
  },
];

/** Minimal { label, href } list for legacy components that only need navigation. */
export const PRODUCT_PIPELINE_LINKS = PRODUCT_PIPELINE_ITEMS.map(({ label, href }) => ({ label, href }));

/** Pipeline steps shown beside the dashboard hero (excludes the dashboard hub itself). */
export const PRODUCT_PIPELINE_STAGE_CARDS = PRODUCT_PIPELINE_ITEMS.filter((p) => p.id !== "dashboard");
