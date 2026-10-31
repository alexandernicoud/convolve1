import { useEffect, useRef, useState } from "react";

/**
 * Displayed progress that keeps moving between server updates.
 *
 * Servers report progress in steps (container start, then batches), so a raw bar sits still
 * for long stretches. Between two reports the bar eases towards a ceiling with an exponential
 * curve, 1 - e^(-Δt/τ): fast at first, slower the longer no news arrives. The ceiling is the
 * last reported value plus at most 12 points (and at most 40% of what is left), so the bar is
 * never far ahead of the real value, never reaches 100% before the run is done and never moves
 * backwards. During start-up (below 5%) it creeps towards 12% so the user sees it working.
 */
export type SmoothState = { shown: number; base: number; baseAt: number };

const TAU_MS = 7_000;
const LEAD = 0.12;
const LEAD_SHARE = 0.4;
const STARTUP = 0.05;
const MAX_BEFORE_DONE = 0.99;

export function initialSmooth(real: number, nowMs: number): SmoothState {
  const p = clamp01(real);
  return { shown: p, base: p, baseAt: nowMs };
}

export function advanceSmooth(state: SmoothState, real: number, nowMs: number, done = false): SmoothState {
  if (done) return { shown: 1, base: 1, baseAt: nowMs };
  const p = clamp01(real);
  const s = p > state.base + 1e-6 ? { ...state, base: p, baseAt: nowMs } : state;
  const ceiling = s.base < STARTUP ? LEAD : Math.min(s.base + LEAD, s.base + (1 - s.base) * LEAD_SHARE);
  const eased = s.base + (ceiling - s.base) * (1 - Math.exp(-(nowMs - s.baseAt) / TAU_MS));
  return { ...s, shown: Math.min(MAX_BEFORE_DONE, Math.max(s.shown, s.base, eased)) };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v > 1 ? v / 100 : v));
}

const shared = new Map<string, SmoothState>();

/**
 * `real` as a 0..1 fraction (values above 1 are read as percent). Returns the fraction to draw.
 * With `key` (a run id) the state survives remounts, so every surface showing that run agrees.
 */
export function useSmoothProgress(
  real: number,
  { done = false, active = true, key }: { done?: boolean; active?: boolean; key?: string } = {},
): number {
  const local = useRef<SmoothState | null>(null);
  const read = () => (key ? shared.get(key) ?? null : local.current);
  const write = (s: SmoothState) => {
    if (key) shared.set(key, s);
    else local.current = s;
  };
  const [shown, setShown] = useState(() => read()?.shown ?? clamp01(real));
  useEffect(() => {
    const now = Date.now();
    const next = advanceSmooth(read() ?? initialSmooth(real, now), real, now, done);
    write(next);
    setShown(next.shown);
    if (!active || done) return;
    const id = window.setInterval(() => {
      const cur = read();
      if (!cur) return;
      const s = advanceSmooth(cur, cur.base, Date.now());
      write(s);
      setShown(s.shown);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, done, active, key]);
  return shown;
}
