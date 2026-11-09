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
  id: "generate" | "train" | "analyze" | "backtest" | "improve" | "deploy" | "monitor";
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
        title: "Choose stocks",
        body: "Search by company or ticker. Each asset contributes charts for both labels. More stocks mean more variety and a higher generation cost.",
      },
      {
        target: '[data-tour="gen-window"]',
        title: "Historical training period",
        body: "This is the calendar span of price history you sample charts from — fixed size (how many charts per label) or a fixed start/end. Keep a later period aside for backtesting; do not use the same dates for training and for the final test.",
        fallback: "Set how many charts to create, or a calendar training period. Leave later dates for an independent backtest.",
      },
      {
        target: '[data-tour="gen-lookback"]',
        title: "Chart lookback window",
        body: "How much past history each image shows (for example six months of daily bars). This is the model's input — not the training calendar above, and not the future horizon that decides the label.",
        fallback: "Under Chart settings, Chart history window sets how much past price action each image covers. Separate from the training dates and from the label horizon.",
      },
      {
        target: '[data-tour="gen-timeframe"]',
        title: "Timeframe",
        body: "Daily, weekly or monthly candles. A model only applies to charts made with the same timeframe — keep it fixed through train, backtest and deploy.",
      },
      {
        target: '[data-tour="gen-labeling"]',
        title: "Label definition and prediction horizon",
        body: "A chart is labelled 1 when price reaches take-profit before stop-loss within this many future bars (the horizon). The horizon is how far ahead the label looks — not how far back the chart shows, and not the training calendar.",
      },
      {
        target: '[data-help="take-profit"]',
        title: "Take-profit %",
        body: "The rise from the entry price that counts as success (label 1). Larger targets are hit less often, so you get fewer positive labels.",
      },
      {
        target: '[data-help="stop-loss"]',
        title: "Stop-loss %",
        body: "The fall from entry that counts as failure. Together with take-profit and horizon, this is the supervised question the network learns to answer.",
      },
      {
        target: '[data-help="gen-balance"]',
        title: "Class balance",
        body: "Take-profit hits are usually rarer than stop-loss hits. Balanced trims the common class to match the rare one so accuracy is harder to fake; Keep all retains every chart.",
        fallback: "After you set stocks and a window, a balance control appears. Imbalanced data can look accurate by always predicting the common label.",
      },
      {
        target: '[data-help="dataset-health"]',
        title: "Dataset size and validation checks",
        body: "Dataset Health checks whether your requested size is reachable, prices are available, and charts do not overlap your held-out test sets. Fix problems before spending credits.",
        fallback: "Dataset Health runs once stocks and a valid window are set. It flags unreachable sizes, missing prices and overlap with test periods — before you generate.",
      },
      {
        target: '[data-tour="gen-run"]',
        title: "Estimated credits",
        body: "The button shows the server-calculated credit price for these settings. Nothing starts until you click it yourself — the tour never launches a run.",
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
        title: "Dataset selection",
        body: "Your latest generated dataset is used automatically. Change it from your library, or upload a ZIP of labelled chart images.",
      },
      {
        target: '[data-help="train-architecture"]',
        title: "Architecture",
        body: "The original network, Compact, or an experimental variant. Each is saved under its own identifier, so earlier models and bots are unaffected.",
        fallback: "Under configuration, pick the network architecture. Compact uses less compute; experimental variants are for controlled comparisons.",
      },
      {
        target: '[data-tour="train-config"]',
        title: "Epochs, batch size and validation split",
        body: "The standard setup works for most datasets: 224 px images, batch size 16, up to 30 epochs, and 20% held out for validation. Early stopping may end sooner; the credit price uses the maximum epochs.",
      },
      {
        target: '[data-help="train-advanced"]',
        title: "Advanced hyperparameters",
        body: "Optimizer, learning-rate schedule, regularization, class weighting, chronological validation, purging and augmentation. Leave untouched for defaults; change one thing at a time when you experiment.",
        fallback: "Advanced training opens below the standard settings. Untouched sections keep the defaults.",
      },
      {
        target: '[data-tour="train-run"]',
        title: "Credit confirmation",
        body: "Review shows how many images go to training and validation and the estimated cost. Training starts only when you press Start; runs above the confirmation threshold ask again. Nothing runs until you confirm.",
      },
      {
        target: '[data-help="train-progress"]',
        title: "Training progress",
        body: "While a run is active, this page shows epochs, loss and validation metrics. You can leave; training continues on the server.",
        fallback: "After you start a run, open the training session to follow progress. The run continues if you leave the page.",
      },
      {
        target: '[data-help="model-health"]',
        title: "Saved model and Model Health",
        body: "When training finishes, weights are saved and Model Health says whether the model ranks charts better than chance. A finished run with high accuracy can still show no skill.",
        fallback: "After training, the results page shows the saved model and Model Health: whether it ranks charts better than chance. Finishing is not the same as having skill.",
      },
      {
        target: '[data-help="improve-callout"]',
        title: "What next",
        body: "From results you can analyze attention, backtest on a later period, or open Improve for controlled experiments. Prefer an independent backtest before deploying.",
        fallback: "After a finished run: analyze what the model looks at, backtest on later data, or improve with one change at a time. Do not deploy from validation accuracy alone.",
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
        body: "Trained models open on their own dataset, so held-out images can be told apart from training images. Prefer validation or later charts when judging attention.",
      },
      {
        target: '[data-tour="lab-modules"]',
        title: "What visual explanations can show",
        body: "Explorer and related modules show where evidence sits on the chart, whether masking those regions changes the output, and how features are organised. That is about the model's behaviour on these images.",
        fallback: "The analysis modules appear once you have picked a trained model and its images.",
      },
      {
        target: '[data-help="lab-modules"]',
        title: "What they cannot establish",
        body: "A heatmap is not proof of skill, not a reason the market moved, and not a forecast of returns. Faithful attention still says nothing about profitability — confirm with an independent backtest.",
        fallback: "Grad-CAM and masking explain attention, not edge. Use them to sanity-check the model; use a later-period backtest to test trading usefulness.",
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
        title: "Independent test period",
        body: "Pick a model and generate or select a test set from dates after its training data. Overlap with training or with threshold tuning makes the run exploratory, not confirmatory.",
      },
      {
        target: '[data-tour="bt-threshold"]',
        title: "Prediction threshold",
        body: "The minimum probability for a BUY signal. Higher means fewer trades, not necessarily better results. Prefer choosing the threshold on validation data, not on this test set.",
        fallback: "With a validation-ready dataset the threshold is selected on validation data before the test set is scored.",
      },
      {
        target: '[data-help="bt-costs"]',
        title: "Trading costs",
        body: "Commission and slippage are deducted from every simulated trade. Leaving them at zero overstates results — set realistic costs before trusting a return figure.",
        fallback: "In the backtest settings, set commission and slippage. Zero costs make almost any strategy look better than it is.",
      },
      {
        target: '[data-tour="bt-run"]',
        title: "Run and interpret results",
        body: "Results include costs, leakage checks and comparisons. Past performance does not predict future returns. Nothing starts until you press the run button yourself.",
      },
      {
        target: '[data-help="bt-baselines"]',
        title: "Baselines",
        body: "Compare the CNN with taking every eligible setup, random entries of the same size, and passive exposure. A positive return is not an edge if simpler baselines did as well after costs.",
        fallback: "After a run, open Baselines. Only beating honest alternatives on an independent period suggests the model added value.",
      },
    ],
  },
  {
    id: "improve",
    label: "Improve",
    page: "Improve",
    route: "/tools/improve",
    nav: {
      target: '[data-tour="nav-improve"]',
      title: "5 · Improve with controlled experiments",
      body: "Change one thing at a time against the original model, with seed replicates to separate real gains from run-to-run noise. Open Improve.",
    },
    spots: [
      {
        target: '[data-help="improve-anchor"]',
        title: "Controlled experiments",
        body: "Every experiment uses the same data and split as the original and is judged against it, never against another experiment. The original stays fixed.",
        fallback: "Pick a trained model to open its Improve workspace. The original stays fixed and every experiment is judged against it.",
      },
      {
        target: '[data-help="improve-noise"]',
        title: "Run-to-run noise",
        body: "Until the original settings have run with at least three seeds, every verdict stays “insufficient evidence”. Small metric bumps are often just the random seed.",
        fallback: "Seed replicates of the original measure run-to-run noise; without them no experiment can be called better.",
      },
      {
        target: '[data-help="improve-variants"]',
        title: "Validation, not cherry-picking",
        body: "Each variant changes one setting and keeps the split identical. Verdicts use validation metrics with a noise margin — not backtest profit. Prefer few motivated experiments over many trials.",
        fallback: "Experiments appear once a workspace is open. Nothing trains until you configure an experiment and confirm its credits.",
      },
      {
        target: '[data-help="improve-decision"]',
        title: "Keep or archive",
        body: "Keep adds a clear improvement to your library; Archive hides the rest without deleting them. Keeping a variant does not replace the original — both remain available.",
        fallback: "When an experiment finishes, Keep or Archive it here. Keep only clear improvements so the library stays readable.",
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
      title: "6 · Deploy a paper bot",
      body: "Run a trained model on a schedule against new market data. Paper trading only: no brokerage account, no real orders.",
    },
    spots: [
      {
        target: '[data-tour="deploy-model"]',
        title: "Prerequisites",
        body: "Deploy a model you have already trained and preferably backtested on a later period. Pick it from your library or upload a .keras file — paper bots do not invent an edge.",
      },
      {
        target: '[data-tour="deploy-market"]',
        title: "Symbol and bar size",
        body: "Use the asset and timeframe the model was trained on. The bot evaluates once per completed bar. Mismatched markets or bars make the paper run meaningless.",
      },
      {
        target: '[data-help="deploy-horizon"]',
        title: "Tested vs deployed settings",
        body: "Horizon, threshold, costs and position size should match what you backtested. Changing them here creates a new, untested setup — treat it as research, not confirmation.",
        fallback: "Align deploy settings with the backtest you trust: same symbol, timeframe, horizon and costs. Diverging settings are a new experiment.",
      },
      {
        target: '[data-tour="deploy-run"]',
        title: "Review before starting",
        body: "You see the full configuration and confirm before the bot is created. Simulated results do not predict real returns; Convolve never places real orders.",
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
      title: "7 · Monitor and revisit research",
      body: "Until you run paper bots, the Overview shows your research path. With bots it shows evaluations, simulated trades, equity and health. Search Hub holds every research asset.",
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
      {
        target: '[data-tour="nav-review"]',
        title: "Search Hub",
        body: "Open Search Hub from the sidebar to browse every dataset, model, analysis, backtest and bot, and the links between them. Return here whenever you pick up previous research.",
      },
      {
        target: '[data-help="hub-lineage"]',
        title: "Linked results",
        body: "The lineage graph shows which stocks made which dataset, which model was trained on it, and every analysis, backtest and bot built from that model. Click a node to continue from that step.",
        fallback: "In Search Hub (/tools/run-log), the Lineage tab draws recorded links between your research assets. Use it to retrace how a result was built.",
      },
      {
        target: '[data-help="hub-models"]',
        title: "Returning to previous research",
        body: "The model library lists completed models with actions to analyze, backtest, deploy or improve — so you can resume without hunting run IDs.",
        fallback: "In Search Hub, open Models to continue from any completed model. Per-tool run history under /tools/run-log also keeps past runs.",
      },
    ],
  },
];

export function stepIndexForPath(pathname: string): number {
  return TOUR_STEPS.findIndex((s) => pathname === s.route || pathname.startsWith(`${s.route}/`));
}
