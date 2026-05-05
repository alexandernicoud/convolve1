/** Axis / chart labels: `$280k` instead of `$280,000`. */
export function formatUsdAxisK(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) {
    const k = abs / 1000;
    const str = k >= 100 ? k.toFixed(0) : k.toFixed(1);
    return `${sign}$${str}k`;
  }
  return `${sign}$${Math.round(abs)}`;
}
