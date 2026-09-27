/**
 * Rate-based ETA estimator.
 *
 * Instead of the naive `elapsed / percent * (1 - percent)` (which assumes the
 * whole job runs at the average speed seen since t=0), this samples progress
 * over time and extrapolates from the *recent* rate of change. That handles
 * non-linear jobs (e.g. the chart generator, where the rarer label-1 charts
 * arrive slower toward the end) far better, and reacts when a run stalls or
 * speeds up. The result is smoothed with an EMA to avoid a jumpy readout.
 */

interface Sample {
  t: number; // ms timestamp
  p: number; // progress fraction 0..1
}

export interface EtaEstimator {
  /** Record the latest progress fraction (0..1). `nowMs` defaults to Date.now(). */
  record(fraction: number, nowMs?: number): void;
  /** Estimated seconds remaining, or null when not enough signal yet. */
  remainingSeconds(): number | null;
  reset(): void;
}

const WINDOW_MS = 45_000; // only consider progress from the last ~45s for the rate
const MIN_SPAN_MS = 1_200; // need at least this much time between samples to trust a rate
const EMA_ALPHA = 0.35; // smoothing for the emitted estimate

export function createEtaEstimator(): EtaEstimator {
  let samples: Sample[] = [];
  let smoothed: number | null = null;
  let firstT: number | null = null;

  const clampP = (p: number) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0);

  return {
    record(fraction: number, nowMs = Date.now()) {
      const p = clampP(fraction);
      if (firstT == null) firstT = nowMs;
      const last = samples[samples.length - 1];
      // Ignore duplicate/backwards timestamps; keep progress monotonic for the rate math.
      if (last && nowMs <= last.t) return;
      samples.push({ t: nowMs, p: last ? Math.max(last.p, p) : p });
      // Drop samples older than the window (but always keep the last two).
      const cutoff = nowMs - WINDOW_MS;
      if (samples.length > 2) {
        samples = samples.filter((s, i) => i >= samples.length - 2 || s.t >= cutoff);
      }
    },

    remainingSeconds() {
      if (samples.length === 0) return null;
      const latest = samples[samples.length - 1];
      if (latest.p >= 1) return 0;

      // Rate from the oldest in-window sample to the latest.
      const oldest = samples[0];
      const spanMs = latest.t - oldest.t;
      const deltaP = latest.p - oldest.p;

      let etaMs: number | null = null;
      if (spanMs >= MIN_SPAN_MS && deltaP > 1e-4) {
        const ratePerMs = deltaP / spanMs;
        etaMs = (1 - latest.p) / ratePerMs;
      } else if (firstT != null && latest.p > 0.02) {
        // Fallback: average rate since start (needs a bit of progress to be meaningful).
        const totalSpan = latest.t - firstT;
        if (totalSpan >= MIN_SPAN_MS) {
          etaMs = (totalSpan / latest.p) * (1 - latest.p);
        }
      }

      if (etaMs == null || !Number.isFinite(etaMs) || etaMs < 0) return smoothed;

      smoothed = smoothed == null ? etaMs : EMA_ALPHA * etaMs + (1 - EMA_ALPHA) * smoothed;
      return Math.max(0, smoothed / 1000);
    },

    reset() {
      samples = [];
      smoothed = null;
      firstT = null;
    },
  };
}

/** Human-friendly "~Xm Ys remaining" / "~Xs remaining". */
export function formatRemaining(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `~${s}s remaining`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `~${m}m ${rem}s remaining` : `~${m}m remaining`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `~${h}h ${mm}m remaining` : `~${h}h remaining`;
}
