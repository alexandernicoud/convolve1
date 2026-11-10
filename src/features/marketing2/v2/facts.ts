import { backtest, grid, lab, labmaps, training } from "../data";

/** Every number quoted on Homepage V2, derived from the real MSFT research chain (see CHAIN in ../data). */

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const signedPct = (x: number, digits = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;
const int = (n: number) => n.toLocaleString("en-US");

const best = training.epochs.find((e) => e.e === training.best_epoch) ?? training.epochs[0];
const last = training.epochs[training.epochs.length - 1];

function findLab(pattern: RegExp) {
  return lab.findings.find((f) => pattern.test(f.title));
}

const deadChannels = findLab(/channels in .* never activate/);
const deadUnits = findLab(/penultimate units are always zero/);
const separating = findLab(/channels separate the labels/);
const onCandles = findLab(/concentrates on candles/);

export const FACTS = {
  symbol: grid.symbol,
  rule: { tp: pct(grid.tp, 0), sl: pct(grid.sl, 0), horizon: grid.horizon },
  charts: int(grid.count),
  size: grid.size,
  trainN: int(training.train_samples),
  valN: int(training.val_samples),
  params: `${(training.params / 1e6).toFixed(1)}M`,
  epochsTrained: training.epochs_trained,
  epochsConfigured: training.epochs_configured,
  bestEpoch: best.e,
  bestValAcc: pct(best.val_acc),
  lastTrainAcc: pct(last.acc),
  lastValLoss: last.val_loss.toFixed(2),
  bestValLoss: best.val_loss.toFixed(2),
  labLayer: labmaps.layer,
  candleAttention: onCandles?.observation ?? "",
  deadChannels: deadChannels?.title ?? "",
  deadUnits: deadUnits?.title ?? "",
  separating: separating?.observation ?? "",
  testN: int(backtest.test_n),
  period: backtest.period,
  threshold: backtest.threshold.toFixed(2),
  commission: `${backtest.costs.commission.toFixed(2)}%`,
  slippage: `${backtest.costs.slippage.toFixed(2)}%`,
  trades: int(backtest.metrics.executed_trades),
  winRate: pct(backtest.metrics.win_rate),
  totalReturn: signedPct(backtest.metrics.total_return),
  maxDrawdown: pct(backtest.metrics.max_drawdown),
  sharpe: backtest.metrics.sharpe.toFixed(2),
  spy: signedPct(backtest.benchmark_returns.spy),
  underlying: signedPct(backtest.benchmark_returns.underlying),
  exposureMatched: signedPct(backtest.benchmark_returns.exposure_matched),
  findings: backtest.findings,
} as const;
