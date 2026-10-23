/**
 * Side-by-side comparison. Values are only shown where recorded; differences in
 * setup are surfaced as warnings and suppress deltas, because a delta between
 * results produced under different conditions is not a like-for-like comparison.
 */
import type { ReviewBacktestSummary, ReviewModel, ReviewRun } from "@/lib/api";
import { formatPeriod, formatValue, int, isNum, money, num, pctFrac, pctUnits } from "./format";

export type Unit = "pctUnits" | "pctFrac" | "num" | "int" | "money" | "ratio";

export interface MetricDef {
  key: string;
  label: string;
  unit: Unit;
  group: string;
  hint?: string;
}

export interface CompareRow {
  def: MetricDef;
  values: (number | null)[];
  /** Difference from the first column, only when the set is comparable. */
  deltas: (number | null)[] | null;
}

export interface CompareWarning {
  field: string;
  message: string;
  values: string[];
}

export interface Comparison {
  rows: CompareRow[];
  setup: { label: string; values: string[]; differs: boolean }[];
  warnings: CompareWarning[];
  comparable: boolean;
}

export function formatUnit(v: number | null | undefined, unit: Unit): string {
  switch (unit) {
    case "pctUnits":
      return pctUnits(v, 2);
    case "pctFrac":
      return pctFrac(v, 1);
    case "money":
      return money(v, 0);
    case "int":
      return int(v);
    case "ratio":
    case "num":
    default:
      return num(v, 2);
  }
}

export function formatDelta(v: number | null, unit: Unit): string {
  if (!isNum(v)) return "";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  const a = Math.abs(v);
  switch (unit) {
    case "pctUnits":
      return `${sign}${a.toFixed(2)} pp`;
    case "pctFrac":
      return `${sign}${(a * 100).toFixed(1)} pp`;
    case "money":
      return `${sign}$${Math.round(a).toLocaleString()}`;
    case "int":
      return `${sign}${Math.round(a)}`;
    default:
      return `${sign}${a.toFixed(2)}`;
  }
}

const n = (v: unknown): number | null => (isNum(v) ? v : null);

function rowsFor(defs: MetricDef[], get: (key: string, i: number) => number | null, count: number, comparable: boolean): CompareRow[] {
  return defs
    .map((def) => {
      const values = Array.from({ length: count }, (_, i) => get(def.key, i));
      const base = values[0];
      const deltas = comparable && isNum(base) ? values.map((v, i) => (i === 0 || !isNum(v) ? null : v - base)) : null;
      return { def, values, deltas };
    })
    .filter((r) => r.values.some((v) => v != null));
}

function setupRow(label: string, values: string[]) {
  const known = values.filter((v) => v !== "—");
  return { label, values, differs: new Set(known).size > 1 || (known.length > 0 && known.length < values.length) };
}

// ---------------------------------------------------------------- backtests

export const BACKTEST_METRICS: MetricDef[] = [
  { key: "return_pct", label: "Net return", unit: "pctUnits", group: "Trading (net of modelled costs)" },
  { key: "pnl", label: "Net P&L", unit: "money", group: "Trading (net of modelled costs)" },
  { key: "max_drawdown_pct", label: "Max drawdown (peak to trough)", unit: "pctUnits", group: "Trading (net of modelled costs)" },
  { key: "sharpe_ratio", label: "Sharpe (daily, annualized)", unit: "ratio", group: "Trading (net of modelled costs)" },
  { key: "profit_factor", label: "Profit factor", unit: "ratio", group: "Trading (net of modelled costs)" },
  { key: "win_rate", label: "Net win rate", unit: "pctUnits", group: "Trading (net of modelled costs)" },
  { key: "trades", label: "Trades", unit: "int", group: "Trading (net of modelled costs)" },
  { key: "drawdown_below_start_pct", label: "Drawdown below start (legacy)", unit: "pctUnits", group: "Legacy label-payoff estimate only" },
  { key: "label_precision_pct", label: "Label-1 precision (legacy)", unit: "pctUnits", group: "Legacy label-payoff estimate only" },
  { key: "total_charts_analyzed", label: "Charts evaluated", unit: "int", group: "Legacy label-payoff estimate only" },
  { key: "cls_accuracy", label: "Accuracy", unit: "pctFrac", group: "Classification (label agreement, not P&L)" },
  { key: "cls_precision", label: "Precision", unit: "pctFrac", group: "Classification (label agreement, not P&L)" },
  { key: "cls_recall", label: "Recall", unit: "pctFrac", group: "Classification (label agreement, not P&L)" },
  { key: "cls_f1", label: "F1", unit: "pctFrac", group: "Classification (label agreement, not P&L)" },
];

export function backtestMetric(b: ReviewBacktestSummary | undefined, key: string): number | null {
  if (!b) return null;
  if (key.startsWith("cls_")) return n(b.classification?.[key.slice(4) as "accuracy"]);
  return n((b.performance as Record<string, unknown> | undefined)?.[key]);
}

const ASSUMPTION_LABELS: [keyof ReviewBacktestSummary["assumptions"], string][] = [
  ["starting_capital", "Starting capital"],
  ["position_size_pct", "Position size %"],
  ["commission_pct", "Commission %"],
  ["slippage_pct", "Slippage %"],
  ["confidence_threshold", "Confidence threshold"],
  ["tp_pct", "Take profit %"],
  ["sl_pct", "Stop loss %"],
  ["sample_size", "Sample size"],
  ["img_size", "Image size"],
];

export function compareBacktests(runs: ReviewRun[], modelTitle: (id?: string | null) => string): Comparison {
  const summaries = runs.map((r) => r.backtest);
  const methodName = (b: ReviewBacktestSummary | undefined) =>
    !b?.methodology
      ? "—"
      : b.methodology.id !== "price_sim_v2"
        ? "Legacy label-payoff estimate"
        : `Price simulation · ${b.methodology.evaluation_class === "independent_test" ? "independent test" : b.methodology.evaluation_class ?? "exploratory"}`;
  const setup = [
    setupRow("Method", summaries.map(methodName)),
    setupRow("Symbol", summaries.map((b) => formatValue(b?.symbol))),
    setupRow("Period", summaries.map((b) => formatPeriod(b?.period?.start, b?.period?.end))),
    setupRow("Model", runs.map((r) => {
      const id = r.links?.trainer_run_id || r.links?.model_id;
      return id ? modelTitle(id) : "—";
    })),
    setupRow("Test dataset", runs.map((r) => formatValue(r.links?.dataset_id))),
    ...ASSUMPTION_LABELS.map(([k, label]) => setupRow(label, summaries.map((b) => formatValue(b?.assumptions?.[k])))),
  ];
  const warnings: CompareWarning[] = [];
  const warnFor: Record<string, string> = {
    Period: "Backtests cover different periods; market regimes differ.",
    "Test dataset": "Backtests were evaluated on different test datasets.",
    Symbol: "Backtests trade different symbols.",
    "Commission %": "Cost assumptions differ; net results are not directly comparable.",
    "Slippage %": "Cost assumptions differ; net results are not directly comparable.",
    "Position size %": "Position sizing differs.",
    "Starting capital": "Starting capital differs; compare percentages, not P&L.",
    "Confidence threshold": "Signal thresholds differ.",
    "Take profit %": "Exit rules differ.",
    "Stop loss %": "Exit rules differ.",
  };
  for (const s of setup) {
    if (s.differs && warnFor[s.label]) warnings.push({ field: s.label, message: warnFor[s.label], values: s.values });
  }
  const ids = new Set(summaries.map((b) => (b?.methodology ? (b.methodology.id === "price_sim_v2" ? "v2" : "v1") : null)).filter(Boolean));
  if (ids.size > 1)
    warnings.push({
      field: "Method",
      message: "Mixes legacy label-payoff estimates with price-based simulations. Their returns, drawdowns and win rates measure different things and must not be compared.",
      values: setup[0].values,
    });
  else if (ids.has("v1"))
    warnings.push({ field: "Legacy", message: "Legacy label-payoff estimates: not price-based trading simulations.", values: [] });
  const evalClasses = new Set(summaries.map((b) => (b?.methodology?.id === "price_sim_v2" ? b.methodology.evaluation_class : null)).filter(Boolean));
  if (evalClasses.size > 1)
    warnings.push({ field: "Evaluation", message: "Mixes independent tests with exploratory runs.", values: [] });
  runs.forEach((r, i) => {
    if (r.backtest?.performance?.metrics_insufficient_sample)
      warnings.push({ field: "Sample", message: `Column ${i + 1} has too few trades for stable ratios.`, values: [] });
    if (!r.backtest?.performance)
      warnings.push({ field: "Results", message: `Column ${i + 1} has no recorded results (status ${r.status}).`, values: [] });
  });
  const comparable = !warnings.some((w) => w.field !== "Sample" && w.field !== "Model" && w.field !== "Legacy");
  return {
    setup,
    warnings,
    comparable,
    rows: rowsFor(BACKTEST_METRICS, (k, i) => backtestMetric(summaries[i], k), runs.length, comparable),
  };
}

// ------------------------------------------------------------------- models

export const MODEL_METRICS: MetricDef[] = [
  { key: "val_accuracy", label: "Accuracy", unit: "pctFrac", group: "Validation set" },
  { key: "val_loss", label: "Loss", unit: "num", group: "Validation set" },
  { key: "val_label_1_recall", label: "Label-1 recall", unit: "pctFrac", group: "Validation set" },
  { key: "accuracy", label: "Accuracy", unit: "pctFrac", group: "Training set (in-sample)" },
  { key: "loss", label: "Loss", unit: "num", group: "Training set (in-sample)" },
  { key: "label_1_recall", label: "Label-1 recall", unit: "pctFrac", group: "Training set (in-sample)" },
  { key: "epochs_trained", label: "Epochs trained", unit: "int", group: "Training" },
  { key: "best_epoch", label: "Best epoch", unit: "int", group: "Training" },
];

export function compareModels(models: ReviewModel[]): Comparison {
  const tag = (m: ReviewModel) =>
    m.take_profit_fraction != null || m.stop_loss_fraction != null
      ? `TP ${pctFrac(m.take_profit_fraction, 2)} / SL ${pctFrac(m.stop_loss_fraction, 2)}`
      : "—";
  const setup = [
    setupRow("Source", models.map((m) => m.source)),
    setupRow("Symbols", models.map((m) => formatValue(m.symbols))),
    setupRow("Timeframe", models.map((m) => formatValue(m.timeframe))),
    setupRow("Training period", models.map((m) => formatPeriod(m.training_period_start, m.training_period_end))),
    setupRow("Training dataset", models.map((m) => formatValue(m.dataset_id ?? (m.generator_run_id ? `generated:${m.generator_run_id}` : null)))),
    setupRow("Labeling", models.map(tag)),
    setupRow("Horizon (bars)", models.map((m) => formatValue(m.horizon_bars))),
    setupRow("Image size", models.map((m) => formatValue(m.image_dimension ?? m.training?.image_size))),
    setupRow("Train / val samples", models.map((m) =>
      m.training?.train_samples != null ? `${int(m.training.train_samples)} / ${int(m.training.val_samples)}` : "—",
    )),
    setupRow("Validation split", models.map((m) => formatValue(m.training?.val_split))),
    setupRow("Epochs (max)", models.map((m) => formatValue(m.training?.epochs))),
    setupRow("Batch size", models.map((m) => formatValue(m.training?.batch_size))),
    setupRow("Random seed", models.map((m) => formatValue(m.training?.random_seed))),
  ];
  const warnFor: Record<string, string> = {
    "Training dataset": "Models were trained on different datasets; validation sets differ.",
    Labeling: "Label definitions differ; accuracies measure different targets.",
    "Horizon (bars)": "Prediction horizons differ.",
    Symbols: "Models cover different symbols.",
    Timeframe: "Timeframes differ.",
    "Validation split": "Validation splits differ.",
  };
  const warnings: CompareWarning[] = [];
  for (const s of setup) {
    if (s.differs && warnFor[s.label]) warnings.push({ field: s.label, message: warnFor[s.label], values: s.values });
  }
  models.forEach((m, i) => {
    if (!m.metrics || Object.keys(m.metrics).length === 0)
      warnings.push({ field: "Metrics", message: `Column ${i + 1} has no recorded training metrics.`, values: [] });
  });
  const comparable = !warnings.some((w) => w.field !== "Metrics");
  return {
    setup,
    warnings,
    comparable,
    rows: rowsFor(MODEL_METRICS, (k, i) => n((models[i].metrics as Record<string, unknown> | null | undefined)?.[k]), models.length, comparable),
  };
}
