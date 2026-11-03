/**
 * Fixed text for the "Copy AI prompt" export: what Convolve is, how each tool works, what every
 * result field means, and which settings a user can change for the next run. Field names match
 * the JSON the prompt carries and the request fields of each tool.
 */

export type AiTool = "backtester" | "analysis" | "optimizer";

export const CONVOLVE_CONTEXT = `## What Convolve is

Convolve (we-convolve.com) is a research platform, currently in a free beta, where users train convolutional neural networks (CNNs) on images of price charts and then test, with strict out-of-sample methodology, whether the model's signals would have made money. It is a research tool, not a broker and not investment advice. Prices come from Yahoo Finance via yfinance (split- and dividend-adjusted daily, weekly or monthly OHLC bars).

The workflow has six tools, run in this order:

1. **Labeling Optimizer.** Searches a grid of take-profit (TP %), stop-loss (SL %) and horizon (bars) on one symbol's history to find a label definition worth teaching a CNN. The date range is split into a *research period* (used for ranking) and an optional later *evaluation period* that never influences the ranking. Candidates are ranked three ways: *profitability* (CAGR of the label payoff or the market-valued payoff), *CNN suitability* (balanced, stable, learnable labels) and *robustness* (how much neighbouring TP/SL/horizon cells agree). The best cell can be transferred to the Generator.
2. **Training Chart Generator.** Renders one square chart image per decision bar: candlesticks or a line, a look-back window (for example 6 months of daily bars), and an image size in pixels. Time runs left (oldest) to right (most recent); price runs bottom to top. **Label rule:** entry at the next bar's open; label 1 if the price reaches +TP before −SL within the horizon; label 0 if the stop is hit first or neither is hit before the horizon ends. If one bar touches both, the stop counts first. Windows whose horizon runs past the end of the data are left out. Classes are balanced 50/50 by default ("match_minority") or kept at their natural mix ("keep_all").
3. **Trainer.** Trains a binary CNN. Its output is the probability that a chart is label 1. The default network is convolve-cnn-v1; experimental profiles include ImageNet-pretrained backbones (frozen or fine-tuned). By default validation is chronological (the most recent charts are held out). Training charts whose chart window or outcome window overlaps the validation or test period are purged, and an optional embargo adds a gap. The saved epoch is picked by a validation metric (val_loss by default), never by test results or backtest profit.
4. **Analysis (CNN interpretability lab).** Shows where in the chart the model's evidence sits (Grad-CAM attention atlas), whether that evidence really drives the output (region masking, occlusion, a Grad-CAM faithfulness test against random masks), how convolutional channels behave (feature laboratory), and how the penultimate-layer representation separates the labels (PCA projection). Findings are produced by fixed rules, not by a language model.
5. **Test Data Generator.** Builds a separate test dataset with the same chart settings as the training data but for a later period. It stores the raw OHLC bars so trades can be simulated on real prices.
6. **Backtester (methodology price_sim_v2).** Runs the model on the test charts. A signal is probability ≥ threshold. The threshold is either *validation_locked* (chosen on the model's recorded validation images by maximising F1 for label 1, then locked before the test set is touched) or *user_fixed*. It then simulates a long-only portfolio on the stored bars: decision at the chart's last close, entry at the next open plus slippage, exits by TP, SL or timeout taken from the dataset's own label definition, marked to market at each close, with commission and slippage per side, position sizing, an exposure cap, a concurrent-position cap and an optional drawdown halt. A leakage audit classifies the evaluation as *independent_test* (clean), *exploratory* (something could not be verified or was selected on test outcomes) or *blocked*.

What each tool answers: the Optimizer asks whether there is a label worth learning; the Trainer, whether a CNN can learn it on held-out charts; Analysis, what the model actually uses and whether that is plausible or a shortcut; the Backtester, whether the signals make money out of sample after costs.`;

export const RESEARCH_RULES = `## Research rules you must respect

- Distinguish **in-sample** numbers (the optimizer's search score, threshold sweeps on the test set, training metrics) from **out-of-sample** numbers (the optimizer's evaluation period or holdout, the validation set, an independent_test backtest). Only out-of-sample numbers are evidence.
- Every change made *because of* a backtest or an evaluation period uses up that period: the next backtest on the same test dates is no longer independent. When you recommend changes based on these results, say so, and recommend confirming on a fresh, later test period (or a different symbol).
- Weigh sample sizes and the 95 % confidence intervals that are given. Fewer than about 30 trades, or a confidence interval that spans the baseline, means "inconclusive", not "good" or "bad".
- Always compare with the baselines that are provided: buy & hold, the label base rate, the majority-class accuracy and the constant-probability Brier score.
- Costs matter: a take-profit close to the round-trip costs cannot work. Check the commission and slippage sensitivity.
- Do not invent numbers that are not in the data. If something you need is missing, say exactly which field or experiment would answer it.
- Nothing here is investment advice; the goal is a better-designed next experiment.`;

const LEVERS = `## Settings the user can change for the next run

**Labeling Optimizer** (request fields): symbol, start, end, selection_end (last day of the research period; later bars form the evaluation period), tp_min_pct / tp_max_pct, sl_min_pct / sl_max_pct, horizon_min / horizon_max (bars), grid_tp_steps / grid_sl_steps (grid resolution), min_trades, fee_rate_pct (round-trip costs), objective.

**Training Chart Generator:** symbols (one or several tickers), chartsPerLabel (charts per symbol per label), useCandles (candlesticks or line), timeframe (1d / 1wk / 1mo), look-back window (timespanCount × timespanUnit, for example 6 months), horizonBars, takeProfitFraction (0.02 = 2 %), stopLossFraction, imageDimension (pixels, square, default 224), training period end / endOffset, balanceMode (match_minority or keep_all).

**Trainer:** architecture, epochs, batch_size, val_split, validation_method (chronological or random; chronological is the honest default), purge_chart_windows, embargo_bars, test_fraction (+ evaluate_test), optimizer (adam / adamw / sgd and learning_rate), lr_schedule (constant, reduce_on_plateau, cosine, warmup_cosine), regularization (dropout, l2), early_stopping (patience, min_delta), selection_metric (val_loss, val_auc, val_pr_auc, val_balanced_accuracy, val_accuracy), class_weighting (none or balanced), augmentation (small label-preserving changes only; no flips, rotations or crops), transfer (scratch, frozen, fine_tune with trainable_layers), random_seed.

**Test Data Generator:** symbols, test_period_start / test_period_end (must come after the training period), and the same chart settings as the training data (changing them makes the test images unlike the training images).

**Backtester:** threshold_mode (validation or fixed) and confidence_threshold, starting_capital, position_size_pct, max_exposure_pct, max_concurrent_positions, max_trades_per_day, commission_pct and slippage_pct (percent per side), max_drawdown_pct (halts new entries), embargo_bars, sample_size. TP, SL and horizon are *not* backtester settings in price_sim_v2; they always come from the test dataset's label definition, so changing them means generating new data and retraining.

**Analysis lab:** which experiment to run (atlas, sensitivity, faithfulness, features, embedding), on which images (validation only, one label, one symbol, a date range, a confidence band), the sample size, the layer, the target class and the masking baseline.`;

const GLOSSARY: Record<AiTool, string> = {
  backtester: `## How to read the backtest results

- **methodology**: engine version, the execution model, the outcome convention and the known limitations. Read them before judging the numbers.
- **evaluation_class**: independent_test = the leakage audit found no overlap or test-set selection; exploratory = something could not be verified or was selected on test outcomes, so treat results as hypotheses; blocked = invalid.
- **leakage_audit.checks**: one entry per check (future_in_image, label_overlap, lookback_overlap, dataset_reuse, selection_on_test) with pass / warn / fail / unknown. purged_sample_ids are test samples removed because their outcome window overlapped the training labels.
- **threshold**: the probability cut-off that turns predictions into trades. source validation_locked = picked on validation data before the test (honest); user_fixed = typed in by the user. selection.curve is the validation precision / recall / F1 by threshold.
- **trading_metrics** (portfolio, net of costs unless stated): total_return, annualized_return, sharpe and sortino (annualised from periodic equity returns), max_drawdown (peak to trough on market-valued equity), win_rate (share of closed trades with net P&L > 0, with a Wilson 95 % CI), profit_factor (gross wins / gross losses), expectancy_return (mean net return per trade), avg_exposure and time_in_market, turnover, executed / closed / open_at_end trades, holding_bars, exit_reasons (tp / sl / timeout counts), total_costs, commission and slippage. A metric with value null carries "unavailable" with the reason.
- **classification_metrics** (the model as a classifier on the test charts, independent of trading): confusion_matrix, positive_base_rate (share of label 1), majority_baseline_accuracy, accuracy, precision / recall / F1 for each label at the threshold (label-1 precision is not a trading win rate), calibration (observed label-1 rate per probability bin), roc_auc (0.5 = no ranking skill; with a CI), pr_auc (compare with the base rate), brier (compare with reference_constant_base_rate; lower is better).
- **benchmarks**: buy & hold on the same symbols and dates (and other baselines where available), with total return, drawdown and Sharpe.
- **robustness**: results grouped by_year, by_quarter, by_symbol and by_probability bucket (groups under min_group_size are flagged unstable); concentration.top3_share_of_net (how much of the profit came from the best three trades); slippage_sensitivity and commission_sensitivity (the same simulation rerun at 0×, 1×, 2×, 4× costs); bootstrap (block-bootstrap distribution of returns).
- **threshold_sweep**: the test set re-scored at other thresholds. This is an in-sample sensitivity analysis and must never be used to pick the threshold.
- **diagnostics** and **skipped entries**: signals that were not traded (exposure cap, concurrent-position cap, drawdown halt, missing bars).
- **equity_curve_sample**: evenly spaced rows of the daily equity table (equity, drawdown, exposure, cumulative costs).
- **trade_statistics** and **trades_sample**: computed from the full trade list; the sample shows the largest winners, the largest losers and evenly spaced others.
- **findings**: rule-based conclusions written by the backend, each with measurement, sample size, baseline, assumptions and limitations.
- **model_training_metadata**: the generator settings (label definition, chart style, period) and trainer settings that produced the model. These are the main levers for the next run.`,

  analysis: `## How to read the analysis results

- **context.model**: input size, preprocessing, output head (sigmoid = one probability for label 1), the convolutional layers and the model fingerprint.
- **context.dataset**: number of images, label counts, symbols, the window-end date range, and **split**: whether the validation membership was recorded by the trainer. Only validation images are held out; results computed on training images show what the model memorised, not what generalises.
- **atlas** (attention atlas): the mean Grad-CAM map over a sample. column/row profiles give attention along time (left = oldest bar, right = most recent) and along price (top = highest price); 1 = uniform. Group comparisons split by label, prediction or correctness. Typical / atypical examples are the images most and least like the mean map.
- **sensitivity** (region masking): each third of the chart by time (oldest / middle / recent) and by price level is replaced with a baseline, and the change in the predicted class's probability is measured, with CIs. A negative "recent − oldest" contrast means recent bars matter more. The sliding-window and occlusion results locate the decisive region.
- **faithfulness**: does masking the cells Grad-CAM highlights reduce the prediction more than masking random cells with similar candle coverage? If not, Grad-CAM pictures should not be trusted for this model.
- **features**: channel activity in one convolutional layer. Cohen's d (label 1 − label 0) shows label-discriminative channels; the correlation with the logit shows channels that drive the output. Many dead or saturated channels point to capacity or training problems.
- **embedding** (representation): the penultimate-layer vectors projected to two principal components. explained_variance and the label separation say whether the representation organises charts by label at all.
- **findings**: rule-generated observations, hypotheses, supported and inconclusive claims, each with measurement, CI, n, baseline and limitations.
- **model_training_metadata**: the generator and trainer settings behind the model, which are the levers for the next run.
- Typical failure modes to look for: attention on axes, borders or blank areas (shortcut learning); attention that ignores the most recent bars although the label is about the future; no difference between label groups; Grad-CAM failing the faithfulness test; probabilities that barely move when the chart is masked (the model is close to constant).`,

  optimizer: `## How to read the labeling optimizer results

- A **cell** is one combination of take-profit (tp, %), stop-loss (sl, %) and horizon (h, bars). For each cell the optimizer labels every bar in the research period with the generator's rule and books the payoff.
- **Label payoff** (the optimizer score): enter at the next open on every eligible bar, exit at +TP, −SL or at the horizon. Expiries are booked at 0 %, which flatters results. **Market-valued (mark_to_market)**: the same trades, but expiries are closed at the actual close price. When the two disagree strongly, trust the market-valued number.
- **cagr_pct**: compound annual growth of the payoff; linear_pl_per_year_pct is the non-compounded version; asset is buy & hold on the same window.
- **exits**: TP hits, SL hits, expiries, the mean move on expiry and the share of expiries that were losing.
- **robustness**: neighbourhood statistics around the best cell. median_ratio = median neighbour score as a share of the peak; region is plateau (broad and stable, good), ridge, or isolated (a lone spike, likely overfitting). cells_within_10pct_of_best counts near-equal cells.
- **walk_forward**: the cell is selected on the first part (train) and then measured on the last part (test, out of sample) against buy & hold. test_percentile_label_model is where the selected cell ranks among all cells on the holdout.
- **periods**: research = used for ranking; evaluation = later bars, never used for ranking. Candidate **evaluation** fields are the out-of-sample check.
- **candidates** (methodology v2): each has ranks under the three rank modes, scores (profitability_cagr_pct, suitability, robustness), and research diagnostics: samples, label1_share / label0_share (class balance; very unbalanced labels are hard for a CNN), sl_share, timeout_share, independent (non-overlapping windows), mean_bars_held, block_label1_share and block_range (stability of the label share over time blocks), neighbour_agreement and horizon_agreement, net_return_per_sample_pct, breakeven_precision (the precision a classifier needs to break even after costs), required_lift (how far above the base rate that is), reward_to_risk. **flags** name concrete problems (for example target_does_not_cover_costs, minority_class_below_10pct, label_share_unstable_over_time).
- **scores** documents each rank mode's formula and gate; **limitations** lists what the search does not model.
- **defects** (audit): methodology problems found in the run, by severity; **configuration** compares the requested settings with those applied.
- **conclusion**: the verdict, evidence lines and next steps shown on the results page (rule-based).
- **per_horizon_best**: the best cell for each horizon, showing how the optimum moves with the horizon.
- **timeseries**: the best cell's compounded strategy curve against the normalised asset, as a summarised series.
- Remember that the optimizer scores *labels*, not a model: a perfect label payoff assumes a classifier that is always right. The question for the next run is which label definition a CNN can realistically learn and still profit from after costs (see breakeven_precision and required_lift).`,
};

const TASK: Record<AiTool, string> = {
  backtester:
    "Analyse this backtest: is there real, out-of-sample evidence of an edge after costs, or not? Then tell me what to change in the next run (label definition and chart settings in the generator, trainer settings, test period, or backtester settings) to get a more informative and, if justified, better result.",
  analysis:
    "Analyse these interpretability results: what does the model actually look at, is that plausible for predicting the label, and is there evidence of shortcut learning, under-fitting or memorisation? Then tell me what to change in the next run (generator chart settings or label definition, trainer settings, or which analysis experiments to run next).",
  optimizer:
    "Analyse this label search: is there a label definition worth training a CNN on, and how trustworthy is it (in-sample vs evaluation period, robustness, costs, class balance)? Then tell me what to change in the next optimizer run and which settings to carry into the generator.",
};

export const OUTPUT_FORMAT = `## What to deliver

1. **Verdict** (2–3 sentences): what these results show, and how strong the evidence is.
2. **What the numbers mean**: the 5–8 most important results, each with the value, the baseline it should be compared with, and what it implies. Name the field you are reading.
3. **Problems and risks**: overfitting, leakage, small samples, cost sensitivity, regime dependence, class imbalance, or anything else in the data that weakens the conclusion.
4. **Changes for the next run**: a table with columns *Tool · Setting (exact field name) · Current value · Proposed value · Why · How to tell if it worked*. Change only a few things at once and order them by expected impact.
5. **What to keep unchanged**, and why.
6. **Missing information**: anything you needed but that is not in the data, and which Convolve tool or experiment would provide it.`;

export const TOOL_TITLE: Record<AiTool, string> = {
  backtester: "Backtester",
  analysis: "Analysis (CNN interpretability lab)",
  optimizer: "Labeling Optimizer",
};

export function promptHeader(tool: AiTool): string {
  return `You are an experienced quantitative researcher and machine-learning engineer. I am using Convolve and want your help deciding what to change in my next run. Below you will find (1) what Convolve is and how its tools work, (2) how to read the results of this ${TOOL_TITLE[tool]} run, (3) the settings I can change, and (4) the complete results as JSON.

**Your task:** ${TASK[tool]}`;
}

export function toolGlossary(tool: AiTool): string {
  return GLOSSARY[tool];
}

export function leversSection(): string {
  return LEVERS;
}
