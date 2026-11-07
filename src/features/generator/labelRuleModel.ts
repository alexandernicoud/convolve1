/** Pure helpers for the labeling-rule visual simulator (no React). */

export type OhlcBar = { open: number; high: number; low: number; close: number };

/** Deterministic synthetic random-walk OHLC for the schematic. */
export function buildSyntheticBars(count: number, seed = 7): OhlcBar[] {
  let x = seed % 2147483647;
  if (x <= 0) x = 7;
  const rand = () => {
    x = (x * 48271) % 2147483647;
    return x / 2147483647;
  };
  const out: OhlcBar[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.48) * 1.4;
    const open = price;
    const close = Math.max(40, open * (1 + drift / 100));
    const high = Math.max(open, close) * (1 + rand() * 0.004);
    const low = Math.min(open, close) * (1 - rand() * 0.004);
    out.push({ open, high, low, close });
    price = close;
  }
  return out;
}

/** Layout numbers shared with tests. */
export function labelRuleLayout(opts: {
  lookback: number;
  horizon: number;
  takeProfitFraction: number;
  stopLossFraction: number;
}) {
  const lookback = Math.max(1, Math.round(opts.lookback));
  const horizon = Math.max(1, Math.round(opts.horizon));
  const entryIndex = lookback; // open of the bar after the chart window
  const totalBars = lookback + 1 + horizon;
  const tp = Number.isFinite(opts.takeProfitFraction) ? Math.max(0, opts.takeProfitFraction) : 0;
  const sl = Number.isFinite(opts.stopLossFraction) ? Math.max(0, opts.stopLossFraction) : 0;
  return { lookback, horizon, entryIndex, totalBars, tp, sl };
}

export function toOhlc(bars: Array<OhlcBar | number>): OhlcBar[] {
  return bars.map((b) => (typeof b === "number" ? { open: b, high: b, low: b, close: b } : b));
}

export function timespanLabel(unit: string, count: number): string {
  const u = unit.toLowerCase();
  const noun =
    u === "days" ? "day" : u === "weeks" ? "week" : u === "years" ? "year" : "month";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
