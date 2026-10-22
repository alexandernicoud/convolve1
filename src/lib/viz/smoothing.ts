/**
 * Exponential moving average for display only. `weight` is the TensorBoard-style smoothing factor
 * (0 = raw). Nulls stay null and do not reset the running value; the first finite value seeds it.
 * Uses bias correction so early points are not pulled toward zero.
 */
export function ema(values: (number | null | undefined)[], weight: number): (number | null)[] {
  const w = Math.min(Math.max(weight, 0), 0.99);
  let last = 0;
  let steps = 0;
  return values.map((v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    last = last * w + (1 - w) * v;
    steps += 1;
    const correction = 1 - Math.pow(w, steps);
    return correction > 0 ? last / correction : v;
  });
}
