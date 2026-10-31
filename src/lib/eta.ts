/**
 * Rate-based ETA estimator.
 *
 * Extrapolates from the rate measured since real work began, not since the run was created:
 * container start-up and data download sit on a flat plateau (the server reports 1-5% for a
 * while) and would otherwise make every estimate far too long. The recent rate (last ~30 s)
 * and the rate since work began are averaged, so a stall shows up without one slow batch
 * doubling the estimate. The emitted value is smoothed and may only rise slowly.
 */

interface Sample {
  t: number; // ms timestamp
  p: number; // progress fraction 0..1
}

export interface EtaEstimator {
  /** Record the latest progress fraction (0..1). `nowMs` defaults to Date.now(). */
  record(fraction: number, nowMs?: number): void;
  /** Estimated seconds remaining, or null when not enough signal yet. */
  remainingSeconds(nowMs?: number): number | null;
  /** Progress per millisecond once work has begun, or null. */
  ratePerMs(): number | null;
  reset(): void;
}

const WINDOW_MS = 30_000;
const MIN_SPAN_MS = 2_000;
const MIN_WORK = 0.02; // progress made after the plateau before an estimate is shown
const PLATEAU_STEP = 0.004; // a rise this large ends the start-up plateau
const EMA_ALPHA = 0.4;
const MAX_RISE = 1.15; // an estimate may grow by at most 15% (+2 s) per reading

export function createEtaEstimator(): EtaEstimator {
  let samples: Sample[] = [];
  let workStart: Sample | null = null;
  let firstP: number | null = null;
  let smoothed: number | null = null;
  let lastEmitAt: number | null = null;

  const clampP = (p: number) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0);

  const rate = (): number | null => {
    const latest = samples[samples.length - 1];
    if (!latest || !workStart) return null;
    const total = latest.t - workStart.t >= MIN_SPAN_MS ? (latest.p - workStart.p) / (latest.t - workStart.t) : null;
    const oldest = samples.find((s) => s.t >= workStart!.t) ?? samples[0];
    const recent = latest.t - oldest.t >= MIN_SPAN_MS ? (latest.p - oldest.p) / (latest.t - oldest.t) : null;
    const rates = [total, recent].filter((r): r is number => r != null && r > 0);
    return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  };

  return {
    record(fraction: number, nowMs = Date.now()) {
      const last = samples[samples.length - 1];
      if (last && nowMs <= last.t) return;
      const p = last ? Math.max(last.p, clampP(fraction)) : clampP(fraction);
      if (firstP == null) firstP = p;
      if (!workStart && last && p - firstP >= PLATEAU_STEP) workStart = last;
      samples.push({ t: nowMs, p });
      const cutoff = nowMs - WINDOW_MS;
      if (samples.length > 2) samples = samples.filter((s, i) => i >= samples.length - 2 || s.t >= cutoff);
    },

    remainingSeconds(nowMs = Date.now()) {
      const latest = samples[samples.length - 1];
      if (!latest) return null;
      if (latest.p >= 1) return 0;
      if (!workStart || latest.p - workStart.p < MIN_WORK) return null;
      const r = rate();
      if (r == null) return smoothed == null ? null : Math.max(0, smoothed / 1000);
      // Time since the last reading counts down too, so the readout keeps moving between polls.
      const raw = Math.max(0, (1 - latest.p) / r - (nowMs - latest.t));
      if (smoothed == null) smoothed = raw;
      else {
        const elapsed = lastEmitAt == null ? 0 : nowMs - lastEmitAt;
        const expected = Math.max(0, smoothed - elapsed);
        const next = EMA_ALPHA * raw + (1 - EMA_ALPHA) * expected;
        smoothed = Math.min(next, expected * MAX_RISE + 2_000);
      }
      lastEmitAt = nowMs;
      return Math.max(0, smoothed / 1000);
    },

    ratePerMs: rate,

    reset() {
      samples = [];
      workStart = null;
      firstP = null;
      smoothed = null;
      lastEmitAt = null;
    },
  };
}

/** "about 40s left" / "about 2 min left": rounded so the readout does not flicker. */
export function formatRemaining(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s <= 5) return "almost done";
  if (s < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)}s left`;
  const m = s / 60;
  if (m < 10) return `about ${Math.round(m * 2) / 2} min left`.replace(".5 min", "½ min");
  if (m < 60) return `about ${Math.round(m)} min left`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return mm ? `about ${h} h ${mm} min left` : `about ${h} h left`;
}
