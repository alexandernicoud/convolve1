/**
 * Explanations for "Explain this page" mode and the help center.
 *
 * Elements opt in with ``data-help="<id>"`` (dashboard panels via their ``data-panel`` id,
 * read as ``panel-<id>``). Text describes what the code does today; when behaviour
 * changes, change the entry. Keep ``body`` to one or two plain sentences.
 */

export type AnnotationVisual = "threshold" | "accuracy" | "takeProfit" | "drawdown" | "labeling";

export type Annotation = {
  id: string;
  title: string;
  body: string;
  more?: string;
  /** What to do with the result. Shown with ``more`` behind "More detail". */
  use?: string;
  /** The most common wrong reading. Shown with ``more`` behind "More detail". */
  misconception?: string;
  visual?: AnnotationVisual;
  /** Help center anchor or page with more detail. */
  href?: string;
};

const entries = [
  // ---------------------------------------------------------------- generator
  {
    id: "gen-assets",
    title: "Assets",
    body: "The stocks to build charts from, by Yahoo Finance ticker. Each asset contributes chart images for both labels.",
    more: "More assets give the model more varied examples, and cost proportionally more to generate.",
    href: "/help#generate",
  },
  {
    id: "gen-size",
    title: "Dataset size",
    body: "Fixed dataset size sets how many charts per label to create; fixed training period sets the calendar span and estimates the count from it.",
    more: "Charts per label is a target for each class, so 1,000 means up to 2,000 images per asset.",
    href: "/help#generate",
  },
  {
    id: "gen-balance",
    title: "Label balance",
    body: "Take-profit hits are usually rarer than stop-loss hits. Balanced trims the common label to match the rare one; Keep all keeps every chart.",
    more: "An imbalanced dataset can reach high accuracy by always predicting the common label. Balanced data makes accuracy easier to interpret.",
    href: "/help#results",
  },
  {
    id: "gen-timeframe",
    title: "Timeframe",
    body: "The bar size of each candle: daily, weekly or monthly. A model only applies to charts made with the same timeframe.",
    href: "/help#terms",
  },
  {
    id: "gen-horizon",
    title: "Future horizon",
    body: "How many bars after the chart's last candle are checked to decide its label.",
    more: "If neither take-profit nor stop-loss is reached within the horizon, the chart does not get a take-profit label.",
    visual: "labeling",
    href: "/help#labeling",
  },
  {
    id: "take-profit",
    title: "Take profit",
    body: "The price rise, as a percentage of the entry price, that counts as a success. In the generator it defines label 1; in a backtest it closes a winning trade.",
    more: "A larger take-profit is reached less often, so it produces fewer positive labels or fewer winning exits.",
    visual: "takeProfit",
    href: "/help#labeling",
  },
  {
    id: "stop-loss",
    title: "Stop loss",
    body: "The price fall, as a percentage of the entry price, that counts as a failure and closes the position.",
    visual: "takeProfit",
    href: "/help#labeling",
  },
  {
    id: "gen-run",
    title: "Generate dataset",
    body: "Starts rendering and labelling charts on the server. Nothing runs until you click; the button shows the price first.",
    href: "/help#generate",
  },
  {
    id: "credits-estimate",
    title: "Run price",
    body: "The credit price on the run button is calculated on the server from these settings. It updates as you change them.",
    more: "Fixed prices do not change after you start. Credits are not charged while the beta runs with charging off.",
    href: "/help#credits",
  },

  // ---------------------------------------------------------------- trainer
  {
    id: "train-dataset",
    title: "Training dataset",
    body: "The labelled chart images the network learns from. Your latest generator dataset is used unless you pick another or upload a ZIP.",
    href: "/help#train",
  },
  {
    id: "train-standard",
    title: "Standard configuration",
    body: "224 × 224 px images, batch size 16, up to 30 epochs, a 20% validation split and seed 7.",
    more: "Training stops early after 5 epochs without improvement of the selection metric (validation loss unless you change it) and keeps the best weights.",
    href: "/help#train",
  },
  { id: "train-image_height", title: "Image height", body: "Height the charts are resized to before training. Must match the images you later backtest or deploy with." },
  { id: "train-image_width", title: "Image width", body: "Width the charts are resized to before training. Larger images cost more compute per epoch." },
  {
    id: "train-batch_size",
    title: "Batch size",
    body: "How many images the network sees before each weight update. It changes training dynamics, not the amount of data.",
  },
  {
    id: "train-epochs",
    title: "Maximum epochs",
    body: "How many full passes over the training images are allowed. Early stopping may end training sooner.",
    more: "The price uses the maximum, so stopping early does not change it.",
  },
  {
    id: "train-val_split",
    title: "Validation split",
    body: "The share of images held out from training and used only to measure the model after each epoch.",
    visual: "accuracy",
    href: "/help#results",
  },
  {
    id: "train-random_seed",
    title: "Random seed",
    body: "Fixes the starting weights, dropout, the order training images are shown in, augmentation and, for a random split, which images are held out.",
    more: "Runs before Trainer 2.0 did not fix the starting weights. Now the same data, settings, seed, software and hardware reproduce the same weights; another CPU type or a GPU can differ in the last decimals.",
  },
  {
    id: "train-advanced",
    title: "Advanced training",
    body: "Optimizer, learning-rate schedule, regularization, class weighting, validation and purging, augmentation, seed and model selection. Each section explains its effect and cost.",
    more: "Untouched sections use the defaults: Adam at 0.001, constant learning rate, early stopping on validation loss with patience 5, natural label mix, no augmentation.",
  },
  {
    id: "train-architecture",
    title: "Network",
    body: "The original network, Compact, or an experimental variant. Each is saved under its own identifier, so models trained earlier and bots running on them are unaffected.",
    more: "Compact does about a third of the computation of the original. The GAP CNN, ResNet18-style and EfficientNet-B0 variants are experimental. In our comparison on one dataset, the original, Compact, GAP CNN and EfficientNet-B0 networks all ranked later-period charts at chance level (ROC-AUC 0.49 to 0.51); higher accuracy than the majority baseline came from the label mix shifting between periods.",
  },
  {
    id: "train-validation-method",
    title: "Validation images",
    body: "Most recent period (default): the latest charts are held out and overlapping training charts are left out. Random sample: a random share of charts, which reads optimistic.",
    more: "Consecutive charts cover almost the same prices, so randomly chosen validation charts have near-identical neighbours in training. The most-recent-period method measures how the model does on a period it has not seen, which is what a backtest or a bot faces.",
    href: "/help#train",
  },
  {
    id: "train-adv-validation",
    title: "Validation and purging",
    body: "Optional test period, and which training charts are left out because their chart or outcome window overlaps a later period. The preview shows the resulting counts.",
    href: "/help#train",
  },
  {
    id: "train-test-fraction",
    title: "Test period",
    body: "The latest charts, kept apart from training and from every choice the run makes. Off by default so you decide when to use them.",
    more: "A test set is only independent until you start choosing settings by its result.",
  },
  {
    id: "train-evaluate-test",
    title: "Evaluate the test period",
    body: "Scores the reserved test charts once, after training, with the saved weights. Leave it off to keep them untouched for a final check later.",
  },
  {
    id: "train-purge-chart-windows",
    title: "Purge overlapping chart windows",
    body: "Leaves out training charts that show candles also shown in validation or test charts. Charts whose outcome window reaches a later period are always left out.",
  },
  {
    id: "train-embargo",
    title: "Embargo",
    body: "Extra bars after each training chart's outcome window that must pass before the next period starts. 0 removes only true overlaps.",
  },
  {
    id: "train-label-horizon",
    title: "Label horizon",
    body: "How many bars after the chart decide its label. Taken from the generator settings when known; without it outcome overlaps cannot be checked.",
  },
  {
    id: "train-split-preview",
    title: "Split preview",
    body: "Charts per partition, label mix, date ranges and purged charts, computed on the server with the same code the run will use.",
  },
  {
    id: "train-adv-selection",
    title: "Evaluation and model selection",
    body: "The validation metric that chooses the kept epoch and drives early stopping. Never the test period and never backtest profit.",
  },
  {
    id: "train-selection-metric",
    title: "Selection metric",
    body: "Loss favours calibrated probabilities, ROC-AUC favours ranking, balanced accuracy favours getting both labels right at 0.5. They can pick different epochs.",
  },
  {
    id: "train-adv-early-stopping",
    title: "Early stopping",
    body: "Stops when the selection metric has not improved for the patience in epochs, and keeps the best epoch's weights.",
  },
  { id: "train-adv-optimizer", title: "Optimizer", body: "How weights move along the gradient. Adam at 0.001 is the original setting; AdamW adds weight decay; SGD with momentum usually needs a higher rate." },
  {
    id: "train-adv-schedule",
    title: "Learning-rate schedule",
    body: "Constant, halved on plateaus (per epoch), or cosine decay with optional warmup (per batch). A resumed run continues the schedule where it stopped.",
  },
  {
    id: "train-adv-architecture",
    title: "Architecture configuration",
    body: "Dropout before the output and an L2 penalty on the weights. For EfficientNet-B0, whether to start from ImageNet weights.",
  },
  {
    id: "train-transfer",
    title: "Starting weights",
    body: "ImageNet weights come from photographs, which look nothing like charts, so they may help little. Frozen trains only the output layer; fine-tuning adapts the top layers.",
  },
  {
    id: "train-adv-imbalance",
    title: "Class imbalance",
    body: "Balanced weights make both labels count equally in the training loss. Validation and test always keep their natural label mix.",
  },
  {
    id: "train-adv-augmentation",
    title: "Augmentation",
    body: "Small random changes to training images only. Flips, rotations and crops are not offered because they change what the label means.",
  },
  {
    id: "train-adv-reproducibility",
    title: "Reproducibility",
    body: "The seed and deterministic operations make a run repeatable on the same hardware. Train with several seeds to see how much results move by chance.",
  },
  {
    id: "train-review-open",
    title: "Review run",
    body: "Shows the dataset, network, image counts per partition, settings and estimated credits before anything starts.",
  },
  {
    id: "train-review",
    title: "Review before training",
    body: "Everything the run will use, the split computed on the server, and the credit estimate. Training starts only when you press Start training.",
  },
  {
    id: "train-evaluation",
    title: "Evaluation of the saved model",
    body: "Metrics of the kept weights on validation (and the test period when scored), each next to a model that always predicts the training majority label.",
    more: "Accuracy above 50% is not evidence of skill when one label is more frequent. These are classification metrics; profitability is measured in the Backtester.",
    href: "/help#results",
  },
  {
    id: "train-test-status",
    title: "Test period status",
    body: "Whether the reserved test charts were scored. Unscored charts stay independent; once you choose settings by a test result, it is no longer an independent test.",
  },
  {
    id: "train-split-recorded",
    title: "Data split",
    body: "The partitions this run actually used, with label mix, dates and purged charts. The full chart lists are stored with the run.",
  },
  {
    id: "train-selection-curves",
    title: "Validation metrics and learning rate",
    body: "Balanced accuracy, ROC-AUC and PR-AUC on validation per epoch, and the learning rate. 0.5 is the level of a model that ignores the chart.",
  },
  {
    id: "train-diagnostics",
    title: "Run diagnostics",
    body: "Why training stopped, the kept epoch, model size, and the seed, software, device and fingerprints needed to reproduce the run.",
  },
  {
    id: "train-accelerator",
    title: "Hardware",
    body: "Train on the standard CPU machines or on a GPU machine. The network and settings are the same; results can differ in the last decimal places.",
  },
  {
    id: "train-queue",
    title: "Training queue",
    body: "Runs start in the order they were submitted when a training machine is free. Each account trains one run at a time; further runs wait and start automatically.",
  },
  {
    id: "train-resume",
    title: "Resume",
    body: "A checkpoint is saved after every epoch. Resuming continues the same run from there with the same data and settings; a new run starts from epoch 1.",
  },
  {
    id: "train-network",
    title: "Network",
    body: "The convolutional network that will be trained: its layers and the number of parameters at this image size.",
  },
  {
    id: "train-process",
    title: "What happens during training",
    body: "The dataset is split, the network trains epoch by epoch, and validation metrics are recorded after each epoch. The kept model is then compared with a label-majority baseline.",
  },
  {
    id: "train-run",
    title: "Start training",
    body: "Queues the training job on the server. It keeps running if you leave the page; the session page shows progress.",
  },
  {
    id: "train-progress",
    title: "Training progress",
    body: "Completed epochs out of the configured maximum. While an epoch runs, the batch it has reached and the measured images per second update every few seconds.",
    more: "Early stopping ends training once the selection metric has not improved for the patience (5 epochs by default), so most runs finish before the maximum. The time-left figure is an upper bound for that reason.",
    href: "/help#train",
  },
  {
    id: "learning-curves",
    title: "Learning curves",
    body: "Training and validation loss and accuracy after every epoch. Validation values come from images the network never trains on.",
    more: "When training loss keeps falling while validation loss rises, the network is memorising its training images (overfitting). The saved weights are from the best epoch by the run's selection metric (validation loss unless changed).",
    visual: "accuracy",
    href: "/help#results",
  },
  {
    id: "train-timings",
    title: "Where the time went",
    body: "Measured wall time of each phase of this run: waiting for a machine, loading data, building the network, training, validation and saving.",
    more: "On the standard configuration nearly all of the time is training itself; loading and saving take seconds. The price is fixed by the configuration, not by how long the run takes.",
    href: "/help#train",
  },
  {
    id: "train-computation",
    title: "The computation so far",
    body: "Counts derived from this run: training images processed (once per image per epoch), optimizer steps (one per batch) and parameter updates (steps × trainable weights).",
    more: "Training FLOPs are an estimate: forward operations per image, counted from the layer shapes or the saved model, times three for the backward pass, times the images processed. Validation passes are not included. In-epoch counts follow the batch report, which arrives every few seconds.",
    href: "/help#train",
  },
  {
    id: "validation-accuracy",
    title: "Validation accuracy",
    body: "The share of held-out images the model labels correctly. It is measured on images the model never trained on.",
    more: "Compare it with the share of the most common label: on a 70/30 dataset, 70% accuracy can mean the model learned nothing.",
    visual: "accuracy",
    href: "/help#results",
  },

  // ---------------------------------------------------------------- analysis lab
  {
    id: "lab-model",
    title: "Model",
    body: "The trained or uploaded network to inspect. Trained models open on their own dataset so held-out images can be identified.",
  },
  { id: "lab-images", title: "Images", body: "The chart images the analyses run on. They must be in the same format the model was trained on." },
  {
    id: "lab-modules",
    title: "Analysis modules",
    body: "Explorer shows one image with its Grad-CAM heatmap; the other modules test whether that evidence drives the output and how features are organised.",
    more: "A heatmap shows where the model's evidence sits, not why the market moved.",
    href: "/help#analyze",
  },
  {
    id: "lab-context",
    title: "Context",
    body: "The model's input format, output, layers and the dataset in use. Every result below is tied to this context so it can be reproduced.",
  },

  // ---------------------------------------------------------------- backtester
  {
    id: "bt-source",
    title: "Model and test data",
    body: "Pick a model from your library and a test dataset, or upload both. Test data should cover a period after the training data.",
    href: "/help#backtest",
  },
  {
    id: "bt-threshold",
    title: "Prediction threshold",
    body: "The minimum model probability required to generate a BUY signal. A higher threshold produces fewer signals, but does not necessarily improve profitability.",
    visual: "threshold",
    href: "/help#results",
  },
  { id: "bt-capital", title: "Starting capital", body: "Simulated account equity at the start. No real money is involved." },
  { id: "bt-position", title: "Position size", body: "The share of current simulated equity allocated to each trade." },
  {
    id: "bt-costs",
    title: "Trading costs",
    body: "Commission and slippage are deducted from every simulated trade. Leaving them at zero overstates results.",
  },
  {
    id: "max-drawdown",
    title: "Drawdown",
    body: "The fall from the highest equity reached to a later low, as a percentage. The limit stops new trades once the drawdown exceeds it.",
    visual: "drawdown",
    href: "/help#results",
  },
  {
    id: "bt-run",
    title: "Run backtest",
    body: "Scores every test image with the model and simulates the resulting trades. Past results do not predict future returns.",
  },

  // ---------------------------------------------------------------- labeling optimizer
  { id: "opt-window", title: "History window", body: "The price history the optimizer evaluates label rules on. Longer windows cost more and are more robust." },
  {
    id: "opt-grid",
    title: "Search grid",
    body: "The engine tests 125,000 label rules on daily bars: 25 take-profit levels × 25 stop-loss levels × horizons of 1 to 200 bars.",
    more: "The fields in this section are stored with the run but do not change the search yet.",
  },
  { id: "opt-run", title: "Run optimizer", body: "Ranks label rules by how they would have performed on this history. It does not train a model." },

  // ---------------------------------------------------------------- deploy
  { id: "deploy-symbol", title: "Symbol", body: "The stock the paper bot evaluates. It should match what the model was trained on." },
  {
    id: "deploy-timeframe",
    title: "Bar size",
    body: "The bot is evaluated once per completed bar of this size. Use the timeframe the model was trained on.",
  },
  { id: "deploy-model", title: "Model", body: "The trained network the bot runs on each new chart." },
  {
    id: "deploy-capital",
    title: "Paper capital",
    body: "Simulated capital allocated from your paper wallet. No brokerage account is connected and no orders are sent.",
  },
  { id: "deploy-horizon", title: "Horizon", body: "How many bars a simulated position may stay open before it is closed." },
  {
    id: "deploy-run",
    title: "Review deployment",
    body: "Shows the full configuration for confirmation. The bot only starts after you confirm, and it trades on paper only.",
    href: "/help#bots",
  },

  // ---------------------------------------------------------------- dashboard
  {
    id: "panel-kpis",
    title: "Key figures",
    body: "Totals across your paper bots: simulated equity, net profit and loss, time-weighted return, the last 24 hours and drawdown.",
    more: "Hover a figure for its exact definition. Deposits into the paper wallet are excluded from returns.",
  },
  { id: "panel-fleet-table", title: "Fleet", body: "Every paper bot with its status, latest evaluation and simulated performance." },
  { id: "panel-activity", title: "Activity", body: "When each bot was evaluated and what it did: signals, trades and skipped bars." },
  { id: "panel-exposure", title: "Capital and exposure", body: "How much simulated capital is allocated and how much is in open positions." },
  { id: "panel-contribution", title: "P&L breakdown", body: "Which bots and trades contributed to simulated profit and loss." },
  { id: "panel-equity", title: "Equity", body: "Simulated account value over time across your paper bots." },
  { id: "panel-health", title: "Health and events", body: "Errors, skipped evaluations and other events that need attention." },
  { id: "panel-daily", title: "Daily P&L", body: "Simulated net profit or loss per UTC day." },

  // ---------------------------------------------------------------- research features
  {
    id: "dataset-health",
    title: "Dataset health",
    body: "Checks your settings before you spend credits: whether the requested size is reachable, missing prices, overlapping charts and overlap with your test sets.",
    more: "It runs on the market data for your stocks and window. Problems are things that make the dataset unusable or misleading; warnings are worth reading but do not block generation.",
    use: "Fix every problem before generating. For warnings, read the suggested change; if you accept the risk, you can continue.",
    misconception: "A clean report does not mean the labels are predictable. It only means the data is technically sound.",
    href: "/help#generate",
  },
  {
    id: "model-health",
    title: "Model health",
    body: "Reads a finished training run and flags overfitting, underfitting, training that stopped too early and validation results no better than chance.",
    more: "Each finding is computed from the recorded learning curves and validation metrics (ROC-AUC, balanced accuracy, train/validation gap). Where a fix exists, the finding links to a matching Improve experiment.",
    use: "Start with the most severe finding. Its button opens Improve with the suggested experiment preselected; nothing runs until you confirm.",
    misconception: "\"No problems\" is not proof of a trading edge. Health describes the training run, not future profitability.",
    href: "/help#results",
  },
  {
    id: "improve-callout",
    title: "Improve this model",
    body: "Tests controlled changes against this model as a fixed reference: one setting changed at a time, on the same data split, so differences can be attributed.",
    more: "Each experiment is a new, separate training run that costs credits. Your original model is never modified.",
    use: "Open Improve, run the recommended experiment, and add seed replicates so Convolve can tell a real improvement from luck.",
    misconception: "A new model with a higher number is not automatically better. Small differences are often just the random seed.",
  },
  {
    id: "improve-anchor",
    title: "Original model",
    body: "Every experiment in this session is compared with this model. It stays fixed, even when you open the session from one of its variants.",
    more: "Starting a new session from a kept experiment is a deliberate choice; Convolve never silently swaps the reference.",
    use: "Check that this is the model you meant to improve before running experiments.",
    misconception: "Experiments are not compared with each other or with the latest one, only with this original.",
  },
  {
    id: "improve-noise",
    title: "Run-to-run noise",
    body: "Training the same settings with a different random seed gives slightly different results. Convolve needs at least three runs of the original settings to measure that spread.",
    more: "The spread (standard deviation across seeds) and the sampling error of ROC-AUC on your validation charts together set the margin a variant must beat.",
    use: "Add seed replicates before deciding. Each replicate is a paid training run and only starts after you confirm.",
    misconception: "One extra seed is not enough. With fewer than three runs, every verdict stays \"insufficient evidence\".",
  },
  {
    id: "improve-variants",
    title: "Available experiments",
    body: "Controlled variants of the original: each changes one thing (for example size, regularization or learning rate) and keeps the data split identical.",
    more: "Recommended experiments come from Model Health findings. The cost is shown before you start, and nothing starts automatically.",
    use: "Run the recommended one first. Repeat it with another seed if the result is close.",
    misconception: "Running many variants and picking the best number overfits to the validation data. Prefer few, motivated experiments.",
  },
  {
    id: "improve-results",
    title: "Comparison with the original",
    body: "Validation metrics of each experiment next to the original: ROC-AUC, PR-AUC, balanced accuracy, log loss, validation loss, train/validation gap and size.",
    more: "The verdict uses validation ROC-AUC. \"Clearly improved\" or \"worse\" requires the difference to exceed the 95% margin from seed noise and validation sampling.",
    use: "Read the verdict first, then the metric that drove it. Treat \"no clear difference\" as \"not better\".",
    misconception: "These are validation results, not trading results. Confirm a kept model with a backtest on later, unseen data.",
  },
  {
    id: "improve-decision",
    title: "Keep or archive",
    body: "Undecided experiments wait here. Keep adds the model to your library as a confirmed model; Archive hides it but never deletes it.",
    more: "Every decision asks for confirmation and is recorded. Archived experiments can be restored. You may mark one kept model per session as preferred.",
    use: "Keep only clear improvements. Archive the rest so your library stays readable.",
    misconception: "Keeping a model does not replace the original; both stay in your library.",
  },
  {
    id: "hub-lineage",
    title: "Lineage graph",
    body: "How your research connects: which stocks made which dataset, which model was trained on it, and every analysis, backtest and bot built from that model.",
    more: "Only recorded links are drawn; nothing is inferred. Click a node to highlight its upstream and downstream path and open its actions.",
    use: "Use it to find what a result was built from, and to continue from any step without remembering run IDs.",
  },
  {
    id: "hub-models",
    title: "Model library",
    body: "Every completed model you trained or uploaded, with its market, labels, validation accuracy and where it was used.",
    more: "Failed or unfinished training runs are not listed. Undecided Improve experiments are hidden behind their own filter; archived models behind the archive filter.",
    use: "Use the row actions to analyze, backtest, deploy or improve a model directly.",
    misconception: "Validation accuracy here is classification agreement on held-out charts, not profitability.",
  },
  {
    id: "hub-compare",
    title: "Compare",
    body: "Side-by-side view of the models or runs you selected, with their settings and results aligned.",
    misconception: "Comparisons across different datasets or splits are not controlled. Use Improve for like-for-like model comparisons.",
  },
  {
    id: "bt-baselines",
    title: "Baselines",
    body: "Does the CNN add value? The same trades are compared with taking every eligible chart, random entries of the same size, and an exposure-matched passive position.",
    more: "The paired rows show the CNN's difference from each baseline with an uncertainty interval. Random entry shows the 5th–95th percentile of seeded draws.",
    use: "Only a CNN that beats every baseline on an independent test suggests an edge. Otherwise, analyze or improve the model.",
    misconception: "A positive return is not an edge if simply taking every setup or holding the stock did as well.",
  },
  {
    id: "bt-integrity",
    title: "Leakage and evaluation checks",
    body: "Whether this backtest is an independent test: the test period must not overlap training data, and the threshold must not be tuned on the test itself.",
    more: "If any check fails or cannot be verified, the run is classified as exploratory and verdicts are capped at inconclusive.",
    use: "For a real confirmation, test on a later period the model and its selection history have never seen.",
    misconception: "An exploratory result can look great and still be meaningless; it cannot confirm an edge.",
  },
  {
    id: "bt-findings",
    title: "Findings",
    body: "Plain-language conclusions produced by fixed rules from this backtest's numbers, sorted by severity, each with a suggested next step.",
    more: "Findings are deterministic: the same results always give the same findings. They are not written by a language model.",
  },
  {
    id: "bt-robustness",
    title: "Robustness",
    body: "Whether the result holds up: by quarter, year and symbol, under higher costs, by model confidence, and with bootstrap uncertainty ranges.",
    use: "Look for results that depend on one period, one stock or near-zero costs; those are fragile.",
    misconception: "A single total return hides how uncertain it is. Check the bootstrap range before trusting it.",
  },
  {
    id: "lab-diagnostics",
    title: "Guided diagnostics",
    body: "Suggests which Lab experiments to run for this model and summarises each result as no concern, worth a look or inconclusive.",
    use: "Run the suggested experiments in order; follow the link on any \"worth a look\" result.",
    misconception: "Diagnostics explain what the model attends to. They do not measure whether it predicts well.",
  },
  {
    id: "lab-atlas",
    title: "Attention atlas",
    body: "Grad-CAM heat maps of many charts averaged: which part of a chart the model tends to look at, for up and down predictions.",
    more: "An all-zero map is a measurement (no positive evidence at that layer) and is counted and excluded from averages.",
    misconception: "A heat map is an explanation method, not proof that the model has skill or that it is right.",
  },
  {
    id: "lab-sensitivity",
    title: "Region masking",
    body: "Hides parts of the chart (oldest, middle, most recent; top, bottom) and measures how much the prediction changes.",
    use: "If masking the most recent candles changes nothing, the model may be using something other than the price action you expect.",
    misconception: "A large change shows the region matters to the model, not that the region is truly predictive.",
  },
  {
    id: "lab-faithfulness",
    title: "Faithfulness test",
    body: "Checks whether Grad-CAM is trustworthy for this model: masking the highlighted cells should hurt the prediction more than masking random cells.",
    use: "If highlighted cells do no better than random ones, do not rely on the heat maps for this model.",
    misconception: "A faithful heat map still says nothing about profitability.",
  },
  {
    id: "lab-features",
    title: "Feature laboratory",
    body: "Shows what individual channels in the network respond to, with the charts that activate them most. Inactive channels are measured too.",
    misconception: "Many inactive channels usually mean the network is larger than the data supports, not that it is broken.",
  },
  {
    id: "lab-embedding",
    title: "Representation explorer",
    body: "Places charts on a map by how similar the network finds them. Well-separated labels suggest the model distinguishes them.",
    misconception: "Separation on training charts can be memorisation; check validation or test charts.",
  },
  {
    id: "lab-findings",
    title: "Research findings",
    body: "Conclusions generated by fixed rules from the latest result of each experiment in this session.",
  },

  // ---------------------------------------------------------------- account
  { id: "account-plan", title: "Plan", body: "Your plan, its monthly credits and quotas, and, where paid plans are offered, upgrades, credit packs and cancellation." },
  {
    id: "account-usage",
    title: "Usage and credits",
    body: "Your runs, their status and, when charging is on, every credit movement with its reason.",
    href: "/help#credits",
  },
] as const satisfies readonly Annotation[];

export type AnnotationId = (typeof entries)[number]["id"];

export const ANNOTATIONS: Record<AnnotationId, Annotation> = Object.fromEntries(entries.map((e) => [e.id, e])) as Record<
  AnnotationId,
  Annotation
>;

export function getAnnotation(id: string | null | undefined): Annotation | null {
  if (!id) return null;
  return (ANNOTATIONS as Record<string, Annotation>)[id] ?? null;
}

/** The annotation id an element carries: ``data-help``, or ``panel-<data-panel>`` for dashboard panels. */
export function annotationIdOf(el: { getAttribute(name: string): string | null }): string | null {
  const help = el.getAttribute("data-help");
  if (help) return help;
  const panel = el.getAttribute("data-panel");
  return panel ? `panel-${panel}` : null;
}

export const HELP_SELECTOR = "[data-help], [data-panel]";

export type PageHelp = { path: string; title: string; summary: string };

/** One-line summary per workspace page, shown at the top of explain mode. */
export const PAGE_HELP: PageHelp[] = [
  { path: "/tools/generator", title: "Generator", summary: "Build a labelled chart dataset: choose assets, a period, and the rule that labels each chart." },
  { path: "/tools/trainer", title: "Trainer", summary: "Train a convolutional network on a labelled dataset and measure it on held-out images." },
  { path: "/products/trainer/analysis", title: "Analysis lab", summary: "Inspect where a trained model's evidence sits and whether it drives the prediction." },
  { path: "/products/trainer", title: "Training session", summary: "Follow a training run epoch by epoch and see which weights were saved." },
  { path: "/tools/analysis", title: "Analysis lab", summary: "Inspect where a trained model's evidence sits and whether it drives the prediction." },
  { path: "/tools/backtester", title: "Backtester", summary: "Simulate trades from a model's predictions on test data, with costs and risk limits." },
  { path: "/products/labeling-optimizer", title: "Labeling optimizer", summary: "Rank take-profit, stop-loss and horizon rules on a stock's history before generating data." },
  { path: "/tools/deploy", title: "Deploy", summary: "Run a trained model as a scheduled paper-trading bot. No real orders are placed." },
  { path: "/tools/improve", title: "Improve", summary: "Test controlled changes against one fixed original model, then keep or archive each experiment." },
  { path: "/tools/run-log", title: "Search Hub", summary: "All your datasets, models and runs, and how they connect. Continue from any step." },
  { path: "/dashboard", title: "Dashboard", summary: "Monitor your paper bots: activity, simulated equity, exposure and health." },
  { path: "/account", title: "Account", summary: "Profile, plan, usage and credits, data export and account deletion." },
];

export function pageHelpFor(pathname: string): PageHelp | null {
  return PAGE_HELP.find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`)) ?? null;
}
