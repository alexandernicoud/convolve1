/**
 * The guided tour. Step ids must match ONBOARDING_STEPS in backend/app/services/account.py.
 *
 * Each step first highlights its sidebar item (the user clicks through or uses the
 * button), then walks the controls on the destination page. Targets are CSS selectors
 * on stable ``data-tour`` / ``data-panel`` attributes; a missing target falls back to a
 * centred card with ``fallback`` text. The tour never presses a control itself.
 */

export type TourSpot = {
  target: string;
  title: string;
  body: string;
  /** Shown instead of the highlight when the target is not on the page. */
  fallback?: string;
};

export type TourStep = {
  id: "generate" | "train" | "analyze" | "backtest" | "deploy" | "monitor";
  label: string;
  /** Page name for the "Open …" button. */
  page: string;
  route: string;
  /** Sidebar item for this step. */
  nav: TourSpot;
  spots: TourSpot[];
  /** Real example shown on the navigation card (Analyze uses a real Grad-CAM map). */
  example?: "gradcam";
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "generate",
    label: "Generate",
    page: "Generator",
    route: "/tools/generator",
    nav: {
      target: '[data-tour="nav-generate"]',
      title: "1 · Generate a labelled dataset",
      body: "Convolve downloads price history, renders each window as a candlestick image and labels it by what happened next. Open the Generator to set one up.",
    },
    spots: [
      {
        target: '[data-tour="gen-assets"]',
        title: "Choose assets",
        body: "Search by company or ticker. Each asset contributes charts for both labels.",
      },
      {
        target: '[data-tour="gen-window"]',
        title: "Dataset size and period",
        body: "Set how many charts to create per label, or a calendar period to cover. Keep a later period aside for testing.",
      },
      {
        target: '[data-tour="gen-timeframe"]',
        title: "Timeframe",
        body: "Daily, weekly or monthly candles. A model only applies to charts made with the same timeframe.",
      },
      {
        target: '[data-tour="gen-labeling"]',
        title: "Labeling rule",
        body: "A chart is labelled 1 when price reaches the take-profit before the stop-loss within the horizon. This rule is what the model learns to predict.",
      },
      {
        target: '[data-tour="gen-run"]',
        title: "Generate",
        body: "The estimated computation is shown above the button. Nothing starts until you click it yourself.",
      },
    ],
  },
  {
    id: "train",
    label: "Train",
    page: "Trainer",
    route: "/tools/trainer",
    nav: {
      target: '[data-tour="nav-train"]',
      title: "2 · Train a CNN",
      body: "A convolutional network learns to predict the label from the chart image. Open the Trainer.",
    },
    spots: [
      {
        target: '[data-tour="train-dataset"]',
        title: "Training dataset",
        body: "Your latest generated dataset is used automatically. You can also upload a ZIP of labelled charts.",
      },
      {
        target: '[data-tour="train-config"]',
        title: "Configuration",
        body: "The standard setup works for most datasets: 224 px images, up to 30 epochs, 20% of images held out for validation.",
      },
      {
        target: '[data-tour="train-run"]',
        title: "Review and start",
        body: "The review shows how many images go to training and validation and the estimated cost. Training starts only when you press Start; it continues if you leave.",
      },
    ],
  },
  {
    id: "analyze",
    label: "Analyze",
    page: "Analysis lab",
    route: "/tools/analysis",
    example: "gradcam",
    nav: {
      target: '[data-tour="nav-analyze"]',
      title: "3 · Analyze what the model looks at",
      body: "Grad-CAM shows which parts of a chart drove a prediction. The example is a real map from an MSFT model trained in Convolve.",
    },
    spots: [
      {
        target: '[data-tour="lab-select"]',
        title: "Pick a model and images",
        body: "Trained models open on their own dataset, so held-out images can be told apart from training images.",
      },
      {
        target: '[data-tour="lab-modules"]',
        title: "Analysis modules",
        body: "Explorer shows Grad-CAM for one image; the other modules test whether that evidence actually drives the output.",
        fallback: "The analysis modules appear once you have picked a trained model and its images.",
      },
    ],
  },
  {
    id: "backtest",
    label: "Backtest",
    page: "Backtester",
    route: "/tools/backtester",
    nav: {
      target: '[data-tour="nav-backtest"]',
      title: "4 · Backtest on unseen data",
      body: "Simulate trades from the model's predictions on a later test period, with costs and risk limits. Open the Backtester.",
    },
    spots: [
      {
        target: '[data-tour="bt-source"]',
        title: "Model and test data",
        body: "Pick a model and generate a test set from a period after its training data.",
      },
      {
        target: '[data-tour="bt-threshold"]',
        title: "Prediction threshold",
        body: "The minimum probability needed for a BUY signal. Higher means fewer signals, not necessarily better results.",
        fallback: "With a validation-ready dataset the threshold is selected on validation data before the test set is scored.",
      },
      {
        target: '[data-tour="bt-run"]',
        title: "Run backtest",
        body: "Results include costs and a benchmark. Past performance does not predict future returns.",
      },
    ],
  },
  {
    id: "deploy",
    label: "Deploy",
    page: "Deploy",
    route: "/tools/deploy",
    nav: {
      target: '[data-tour="nav-deploy"]',
      title: "5 · Deploy a paper bot",
      body: "Run a trained model on a schedule against new market data. Paper trading only: no brokerage account, no real orders.",
    },
    spots: [
      {
        target: '[data-tour="deploy-market"]',
        title: "Symbol and bar size",
        body: "Use the asset and timeframe the model was trained on. The bot is evaluated once per completed bar.",
      },
      {
        target: '[data-tour="deploy-model"]',
        title: "Model",
        body: "Pick a trained model from your library or upload a .keras file.",
      },
      {
        target: '[data-tour="deploy-run"]',
        title: "Review before starting",
        body: "You see the full configuration and confirm before the bot is created. Simulated results do not predict real returns.",
      },
    ],
  },
  {
    id: "monitor",
    label: "Monitor",
    page: "Dashboard",
    route: "/dashboard",
    nav: {
      target: '[data-tour="nav-monitor"]',
      title: "6 · Monitor",
      body: "The dashboard shows every paper bot: evaluations, simulated trades, equity and health.",
    },
    spots: [
      {
        target: '[data-panel="fleet-table"]',
        title: "Your fleet",
        body: "Each bot with its status and latest evaluation. Open one for its full history.",
        fallback: "Your bots appear here once you deploy one.",
      },
      {
        target: '[data-panel="health"]',
        title: "Health and events",
        body: "Errors and skipped evaluations show up here so nothing fails silently.",
        fallback: "Health events appear here once a bot is running.",
      },
    ],
  },
];

export function stepIndexForPath(pathname: string): number {
  return TOUR_STEPS.findIndex((s) => pathname === s.route || pathname.startsWith(`${s.route}/`));
}
