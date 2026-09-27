/** Calendar helpers for chart generator UX (approximate; backend still anchors on server "today"). */

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function calendarDaysBetween(start: Date, end: Date): number {
  const s = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const e = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((e - s) / 86400000);
}

/**
 * Maps "reference end date" (user intent: newest chart window ends ~ this calendar day)
 * to backend `endOffset` = number of timeframe bars between that day and today.
 */
export function computeEndOffsetFromReferenceEnd(
  referenceEnd: Date,
  timeframe: "1d" | "1wk" | "1mo",
): number {
  const today = startOfLocalDay(new Date());
  const ref = startOfLocalDay(referenceEnd);
  const diffDays = calendarDaysBetween(ref, today);
  if (diffDays < 0) return 0;
  if (timeframe === "1d") return diffDays;
  if (timeframe === "1wk") return Math.floor(diffDays / 7);
  let months = (today.getFullYear() - ref.getFullYear()) * 12 + (today.getMonth() - ref.getMonth());
  if (today.getDate() < ref.getDate()) months -= 1;
  return Math.max(0, months);
}

export function shiftCalendarByTimespan(end: Date, timespanUnit: string, timespanCount: number): Date {
  const d = new Date(end);
  const u = timespanUnit.toLowerCase();
  const n = timespanCount;
  if (u.startsWith("month")) d.setMonth(d.getMonth() - n);
  else if (u.startsWith("week")) d.setDate(d.getDate() - 7 * n);
  else if (u.startsWith("day")) d.setDate(d.getDate() - n);
  else d.setMonth(d.getMonth() - n);
  return d;
}

export function subtractTimeframeSteps(from: Date, timeframe: "1d" | "1wk" | "1mo", steps: number): Date {
  const d = new Date(from);
  if (timeframe === "1d") d.setDate(d.getDate() - steps);
  else if (timeframe === "1wk") d.setDate(d.getDate() - 7 * steps);
  else d.setMonth(d.getMonth() - steps);
  return d;
}

export function timespanToApproxDays(timespanUnit: string, timespanCount: number): number {
  const u = timespanUnit.toLowerCase();
  const n = timespanCount;
  if (u.startsWith("month")) return n * 30;
  if (u.startsWith("week")) return n * 7;
  if (u.startsWith("day")) return n;
  return n * 30;
}

export function horizonToApproxDays(timeframe: "1d" | "1wk" | "1mo", horizonBars: number): number {
  if (timeframe === "1d") return horizonBars;
  if (timeframe === "1wk") return horizonBars * 7;
  return horizonBars * 30;
}

export function isoDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return startOfLocalDay(new Date(y, m - 1, d));
}

const PAST_TIMELINE_START_YEAR = 1960;

/** Past segment of the generator timeline (1960 → local today). */
export function getPastTimelineBounds(): { pastStart: Date; pastEnd: Date } {
  return {
    pastStart: new Date(PAST_TIMELINE_START_YEAR, 0, 1),
    pastEnd: startOfLocalDay(new Date()),
  };
}

/** Map horizontal position on the past bar (0–100) to an ISO calendar day (clamped). */
export function isoFromTimelinePercent(percent: number): string {
  const { pastStart, pastEnd } = getPastTimelineBounds();
  const totalMs = pastEnd.getTime() - pastStart.getTime() || 1;
  const p = Math.min(100, Math.max(0, percent));
  const t = pastStart.getTime() + (p / 100) * totalMs;
  return isoDateString(startOfLocalDay(new Date(t)));
}

/** Inverse: ISO date → 0–100 on the past bar. */
export function timelinePercentFromIso(iso: string): number {
  const { pastStart, pastEnd } = getPastTimelineBounds();
  const d = parseIsoDate(iso);
  if (!d) return 0;
  const totalMs = pastEnd.getTime() - pastStart.getTime() || 1;
  const clamped = Math.min(Math.max(d.getTime(), pastStart.getTime()), pastEnd.getTime());
  return ((clamped - pastStart.getTime()) / totalMs) * 100;
}

/** Approximate timeframe bars between two calendar days (upper bound for UX). */
export function estimateBarsBetween(start: Date, end: Date, timeframe: "1d" | "1wk" | "1mo"): number {
  if (start >= end) return 0;
  const days = calendarDaysBetween(start, end);
  if (timeframe === "1d") return Math.max(0, days);
  if (timeframe === "1wk") return Math.max(0, Math.floor(days / 7));
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Heuristic charts-per-label from a calendar training window.
 * Backend still uses chartsPerLabel; this approximates how many samples fit the span (two labels + skips).
 */
export function estimateChartsPerLabelFromRange(
  start: Date,
  end: Date,
  timeframe: "1d" | "1wk" | "1mo",
): number {
  const bars = estimateBarsBetween(start, end, timeframe);
  const heuristic = Math.floor(bars * 0.34);
  return Math.min(12000, Math.max(20, heuristic));
}

/** Same bar→charts ratio as `estimateChartsPerLabelFromRange` (inverse direction). */
const CHARTS_HEURISTIC_BARS_PER_CHART = 0.34;

/**
 * Minimum suggested **calendar-day** length of a training phase for `chartsPerLabel` samples.
 * Inverts the charts heuristic (bars ≈ charts / 0.34), maps bars to calendar days by timeframe,
 * then applies **≥1.5×** headroom. For **daily** bars, calendar span is stretched by **7/5** because
 * bars ignore weekends but wall-clock does not.
 */
export function estimateMinTrainingPhaseDaysForCharts(
  chartsPerLabel: number,
  timeframe: "1d" | "1wk" | "1mo",
): number {
  const c = Math.max(1, Math.min(12000, chartsPerLabel));
  const bars = Math.ceil(c / CHARTS_HEURISTIC_BARS_PER_CHART);
  let baseCalendarDays: number;
  if (timeframe === "1d") {
    baseCalendarDays = bars * (7 / 5);
  } else if (timeframe === "1wk") {
    baseCalendarDays = bars * 7;
  } else {
    baseCalendarDays = bars * 30;
  }
  return Math.ceil(baseCalendarDays * 1.5);
}

export type GeneratorTimelineAxisTick = { label: string; pct: number };

/**
 * Year labels placed at the same calendar→percent mapping as drag handles (1960 → local today).
 */
export function buildGeneratorTimelineAxisTicks(): GeneratorTimelineAxisTick[] {
  const { pastStart, pastEnd } = getPastTimelineBounds();
  const startY = pastStart.getFullYear();
  const endY = pastEnd.getFullYear();
  const span = Math.max(1, endY - startY);
  const step = Math.max(10, Math.round(span / 6));
  const years = new Set<number>();
  for (let y = startY; y < endY; y += step) years.add(y);
  years.add(startY);
  const nearEnd = Math.max(startY, endY - step);
  years.add(nearEnd);
  const sortedYears = [...years].filter((y) => y >= startY && y <= endY).sort((a, b) => a - b);
  const ticks: GeneratorTimelineAxisTick[] = [];
  for (const y of sortedYears) {
    const pct = timelinePercentFromIso(isoDateString(new Date(y, 0, 1)));
    if (pct >= 99.3) continue;
    ticks.push({ label: String(y), pct });
  }
  ticks.sort((a, b) => a.pct - b.pct);
  const pruned: GeneratorTimelineAxisTick[] = [];
  for (const t of ticks) {
    if (pruned.length && t.pct - pruned[pruned.length - 1].pct < 4) continue;
    pruned.push(t);
  }
  pruned.push({ label: "Today", pct: 100 });
  return pruned;
}
