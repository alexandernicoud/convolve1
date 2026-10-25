import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGeneratorTimelineAxisTicks,
  calendarDaysBetween,
  estimateChartsPerLabelFromRange,
  estimateMinTrainingPhaseDaysForCharts,
  getPastTimelineBounds,
  isoDateString,
  isoFromTimelinePercent,
  parseIsoDate,
  subtractTimeframeSteps,
  timelinePercentFromIso,
} from "@/lib/generatorDates";
import type { TimelineEstimate } from "@/features/generator/plan";

type Mode = "range" | "end-only";
type Timeframe = "1d" | "1wk" | "1mo";

type Props = {
  mode: Mode;
  /** Newest dataset bar region (maps to endOffset). */
  referenceEndIso: string;
  /** Earliest training interest (only used when mode === "range"). */
  trainingStartIso: string;
  onReferenceEndChange: (iso: string) => void;
  onTrainingStartChange: (iso: string) => void;
  /** Charts-per-label target — used for the rough total (~×2) chip left of the end lever. */
  chartsPerLabel?: number;
  timeframe?: Timeframe;
  /** Period the run reads and whether the target fits (from trading bars when available). */
  estimate?: TimelineEstimate | null;
};

const STATUS_TEXT: Record<TimelineEstimate["status"], string> = {
  enough: "text-emerald-200/85",
  short: "text-amber-200/90",
  approx: "text-white/60",
  loading: "text-white/45",
};

/**
 * Interactive past timeline (1960 → today) + locked future segment.
 * Drag handles on the bar to set dates — primary input, not decorative.
 */
export default function GeneratorTimeline({
  mode,
  referenceEndIso,
  trainingStartIso,
  onReferenceEndChange,
  onTrainingStartChange,
  chartsPerLabel = 0,
  timeframe = "1d",
  estimate = null,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<null | "start" | "end">(null);

  const pctEnd = timelinePercentFromIso(referenceEndIso);
  const pctStart = mode === "range" ? timelinePercentFromIso(trainingStartIso) : pctEnd;
  const pctEstStart = estimate ? timelinePercentFromIso(estimate.startIso) : null;

  /** Training-period readout shown left of the end lever. */
  const periodChip = useMemo(() => {
    const end = parseIsoDate(referenceEndIso);
    if (!end) return null;
    if (estimate) {
      const start = parseIsoDate(estimate.startIso);
      return {
        startIso: estimate.startIso,
        endIso: estimate.endIso,
        totalCharts: estimate.totalCharts,
        spanDays: start ? calendarDaysBetween(start, end) : 0,
      };
    }
    let start: Date | null = null;
    let perLabel = chartsPerLabel;
    if (mode === "range") {
      start = parseIsoDate(trainingStartIso);
      if (start && end && start < end) {
        perLabel = chartsPerLabel > 0 ? chartsPerLabel : estimateChartsPerLabelFromRange(start, end, timeframe);
      }
    } else {
      // Fixed dataset size: estimate how far back the training window reaches.
      const days = estimateMinTrainingPhaseDaysForCharts(Math.max(1, chartsPerLabel), timeframe);
      start = subtractTimeframeSteps(end, "1d", days);
      perLabel = chartsPerLabel;
    }
    if (!start || start >= end) return null;
    const totalCharts = Math.max(0, Math.round(perLabel) * 2);
    const spanDays = calendarDaysBetween(start, end);
    return {
      startIso: isoDateString(start),
      endIso: isoDateString(end),
      totalCharts,
      spanDays,
    };
  }, [mode, referenceEndIso, trainingStartIso, chartsPerLabel, timeframe, estimate]);

  const readPercentFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return ((clientX - r.left) / r.width) * 100;
  }, []);

  const applyPercent = useCallback(
    (which: "start" | "end", rawPct: number) => {
      const iso = isoFromTimelinePercent(rawPct);
      if (which === "end") {
        onReferenceEndChange(iso);
        if (mode === "range") {
          const s = parseIsoDate(trainingStartIso);
          const e = parseIsoDate(iso);
          if (s && e && s > e) onTrainingStartChange(iso);
        }
        return;
      }
      const sIso = iso;
      const eD = parseIsoDate(referenceEndIso);
      const sD = parseIsoDate(sIso);
      if (eD && sD && sD > eD) {
        onTrainingStartChange(referenceEndIso);
        return;
      }
      onTrainingStartChange(sIso);
    },
    [mode, onReferenceEndChange, onTrainingStartChange, referenceEndIso, trainingStartIso],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = readPercentFromClientX(e.clientX);
      applyPercent(drag, p);
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, readPercentFromClientX, applyPercent]);

  const onDown =
    (which: "start" | "end") =>
    (e: React.PointerEvent) => {
      if (which === "start" && mode === "end-only") return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      if (el instanceof HTMLElement && typeof el.setPointerCapture === "function") {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      setDrag(which);
      applyPercent(which, readPercentFromClientX(e.clientX));
    };

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const el = e.currentTarget;
    if (el instanceof HTMLElement && typeof el.setPointerCapture === "function") {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    const p = readPercentFromClientX(e.clientX);
    if (mode === "end-only") {
      setDrag("end");
      applyPercent("end", p);
      return;
    }
    const ds = Math.abs(p - pctStart);
    const de = Math.abs(p - pctEnd);
    const which: "start" | "end" = ds <= de ? "start" : "end";
    setDrag(which);
    applyPercent(which, p);
  };

  const endOnlyLeft = pctEstStart != null ? Math.min(pctEstStart, pctEnd) : 0;
  const left = mode === "range" ? Math.min(pctStart, pctEnd) : endOnlyLeft;
  const width =
    mode === "range" ? Math.max(Math.abs(pctEnd - pctStart), 1.2) : Math.max(pctEnd - endOnlyLeft, 1.2);
  /** Fixed period with automatic extension: history read before the chosen start. */
  const extensionLeft =
    mode === "range" && pctEstStart != null && pctEstStart < Math.min(pctStart, pctEnd) - 0.05 ? pctEstStart : null;
  /** Right edge of the training highlight — test phase is timeline from here chronologically forward to Today. */
  const bandRightPct = left + width;

  const { pastEnd } = getPastTimelineBounds();
  const axisTicks = buildGeneratorTimelineAxisTicks();
  const datasetEndDate = parseIsoDate(referenceEndIso);
  /** Calendar days from end of training (dataset end) through today — the test / backtest strip. */
  const testPhaseDays = datasetEndDate ? Math.max(0, calendarDaysBetween(datasetEndDate, pastEnd)) : 0;
  const testPhaseYears = testPhaseDays / 365.25;
  const testPhaseNone = testPhaseDays === 0;
  const testPhaseTooShort = testPhaseDays > 0 && testPhaseDays < 365;
  const testPhaseWarnStrip = testPhaseDays < 365;
  const testStripClass = testPhaseWarnStrip
    ? "bg-amber-400/35 ring-1 ring-amber-400/50 ring-inset"
    : "bg-sky-500/22 ring-1 ring-sky-400/35 ring-inset";

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(255,255,255,0.55)]">
          {mode === "range" ? "Fixed training period — drag handles" : "Fixed dataset size — dataset end (drag)"}
        </span>
        <span className="text-[10px] text-white/45">Drag handles on the bar · dates follow the handles</span>
      </div>

      <p className="text-xs leading-relaxed text-[#F5F5F5]/55">
        {mode === "range" ? (
          <>
            The <span className="text-white/75">lighter band</span> is the <strong className="text-white/85">training</strong>{" "}
            phase (samples are drawn from this span). The <span className="text-white/75">strip from the end of that band
            to Today</span> is the <strong className="text-white/85">test phase</strong> (holdout / backtest calendar only
            after training—time before the training window is not treated as test data).
          </>
        ) : (
          <>
            The <span className="text-white/75">lighter band</span> is the history the run needs to reach your chart
            count, worked out from actual trading bars. From the dataset end handle{" "}
            <span className="text-white/75">to Today</span> is the <strong className="text-white/85">test phase</strong>{" "}
            (forward calendar for out-of-sample evaluation).
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-4 text-[10px] uppercase tracking-[0.12em] text-white/55">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-sm bg-white/25 ring-1 ring-white/30" aria-hidden />
          Training phase
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className={`h-2.5 w-6 rounded-sm ${testPhaseWarnStrip ? "bg-amber-400/50 ring-1 ring-amber-300/60" : "bg-sky-400/45 ring-1 ring-sky-300/50"}`}
            aria-hidden
          />
          Test phase → Today
        </span>
      </div>

      <div className="flex w-full gap-1">
        <div
          ref={trackRef}
          role="presentation"
          onPointerDown={onTrackPointerDown}
          className="relative flex-[19] min-w-0 cursor-crosshair touch-none overflow-visible rounded border border-white/10 bg-[#0a0a0a]/80 pb-8 pt-12 select-none"
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-2 h-4 px-0 text-[9px]">
            {axisTicks.map((t) =>
              t.label === "Today" ? (
                <span
                  key="today"
                  className="absolute bottom-0 right-0 whitespace-nowrap font-medium text-white/60"
                >
                  Today
                </span>
              ) : (
                <span
                  key={`${t.label}-${Math.round(t.pct * 1000)}`}
                  className={`absolute bottom-0 whitespace-nowrap text-white/38 ${
                    t.pct < 2 ? "left-0 translate-x-0 text-left" : "-translate-x-1/2"
                  }`}
                  style={t.pct < 2 ? undefined : { left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ),
            )}
          </div>

          {/* Test phase: chronologically after training (dataset end) → Today */}
          <div
            className={`pointer-events-none absolute bottom-7 z-0 h-3 rounded-r ${testStripClass}`}
            style={{
              left: `${Math.min(bandRightPct, 100)}%`,
              width: `${Math.max(0, 100 - Math.min(bandRightPct, 100))}%`,
            }}
            title={`Test / backtest phase (~${testPhaseDays} calendar days)`}
          />
          <div
            className="pointer-events-none absolute bottom-7 z-10 h-2.5 rounded bg-white/22 ring-1 ring-white/35"
            style={{ left: `${left}%`, width: `${width}%` }}
            title={estimate ? `Training data ${estimate.startIso} → ${estimate.endIso}` : "Training phase"}
            data-testid="timeline-training-band"
          />
          {extensionLeft != null ? (
            <div
              className="pointer-events-none absolute bottom-7 z-10 h-2.5 rounded-l border border-dashed border-white/45 bg-white/[0.07]"
              style={{ left: `${extensionLeft}%`, width: `${Math.max(Math.min(pctStart, pctEnd) - extensionLeft, 0.6)}%` }}
              title={`Extended back to ${estimate?.startIso} to reach the chart count`}
            />
          ) : null}

          {mode === "range" ? (
            <button
              type="button"
              aria-label="Training phase start"
              className="absolute bottom-5 z-20 w-4 -translate-x-1/2 cursor-grab rounded border border-white/40 bg-white shadow-md active:cursor-grabbing"
              style={{ left: `${pctStart}%`, height: "28px" }}
              onPointerDown={onDown("start")}
            />
          ) : null}

          {/* Rough period + chart count, parked just left of the end lever */}
          {periodChip ? (
            <div
              className="pointer-events-none absolute z-30 hidden -translate-x-full whitespace-nowrap text-right sm:block"
              style={{
                left: `calc(${Math.max(pctEnd, 8)}% - 10px)`,
                bottom: "2.85rem",
              }}
              title={
                estimate
                  ? `${estimate.note} · ${periodChip.spanDays} calendar days`
                  : `Training period ~${periodChip.spanDays}d · ~${periodChip.totalCharts} charts (both labels)`
              }
            >
              <div
                className={`inline-block rounded-md border bg-[#0a0a0a]/90 px-2 py-1 shadow-lg backdrop-blur-sm ${
                  estimate?.status === "short" ? "border-amber-300/50" : "border-white/20"
                }`}
              >
                <div className="font-mono text-[10px] leading-tight text-white/85">
                  {periodChip.startIso}
                  <span className="mx-0.5 text-white/40">→</span>
                  {periodChip.endIso}
                </div>
                {estimate && estimate.status !== "approx" ? (
                  <div className={`mt-0.5 text-[10px] font-medium tabular-nums ${STATUS_TEXT[estimate.status]}`}>
                    {estimate.status === "short"
                      ? `${estimate.totalCharts.toLocaleString()} of ${estimate.requestedTotal.toLocaleString()} charts`
                      : `${estimate.totalCharts.toLocaleString()} charts`}
                  </div>
                ) : (
                  <div className="mt-0.5 text-[10px] font-medium tabular-nums text-white/60">
                    {estimate ? "" : "~"}
                    {periodChip.totalCharts.toLocaleString()} charts
                    {estimate ? <span className="ml-1 text-white/40">· span at least</span> : null}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            aria-label={mode === "range" ? "Training phase end / dataset end" : "Dataset end"}
            className="absolute bottom-5 z-20 w-4 -translate-x-1/2 cursor-grab rounded border border-white/40 bg-white shadow-md active:cursor-grabbing"
            style={{ left: `${pctEnd}%`, height: "28px" }}
            onPointerDown={onDown("end")}
          />
        </div>

        <div
          className="flex flex-[1] min-w-[52px] flex-col items-center justify-center rounded border border-dashed border-white/20 bg-white/[0.04] px-1 text-center"
          title="Reserved for future live deployment"
        >
          <span className="text-[9px] font-medium uppercase leading-tight text-white/50">Live bot deployment</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/80">
        {mode === "range" ? (
          <span>
            <span className="text-white/45">Training start · </span>
            <span className="font-mono text-white">{trainingStartIso}</span>
          </span>
        ) : null}
        {estimate ? (
          <span>
            <span className="text-white/45">{mode === "range" && extensionLeft == null ? "First chart data · " : "Data needed from · "}</span>
            <span className="font-mono text-white">{estimate.startIso}</span>
          </span>
        ) : null}
        <span>
          <span className="text-white/45">Dataset end · </span>
          <span className="font-mono text-white">{referenceEndIso}</span>
          <span className="ml-2 text-[10px] text-white/40">(≤ {isoDateString(pastEnd)})</span>
        </span>
        <span>
          <span className="text-white/45">Test phase span · </span>
          <span className="font-mono text-white">
            ~{testPhaseDays}d (~{testPhaseYears < 10 ? testPhaseYears.toFixed(2) : testPhaseYears.toFixed(1)} yr)
          </span>
          <span className="ml-2 text-[10px] text-white/40">dataset end → today</span>
        </span>
      </div>
      {estimate ? (
        <p role="status" aria-live="polite" className={`text-xs ${STATUS_TEXT[estimate.status]}`} data-testid="timeline-estimate-status">
          {estimate.note}
        </p>
      ) : null}

      {testPhaseNone ? (
        <div className="rounded-lg border border-amber-500/45 bg-amber-500/12 px-3 py-2.5 text-xs leading-relaxed text-amber-50/95">
          <p className="font-semibold text-amber-100">No test phase</p>
          <p className="mt-1.5 text-amber-50/90">
            Dataset end lines up with Today, so there is no calendar strip after training for backtesting. Move the
            dataset end <strong className="text-amber-50">back in time</strong> to create a test phase; we recommend{" "}
            <strong className="text-amber-50">at least one year</strong> after the end of training for meaningful
            holdout results.
          </p>
        </div>
      ) : testPhaseTooShort ? (
        <div className="rounded-lg border border-amber-500/45 bg-amber-500/12 px-3 py-2.5 text-xs leading-relaxed text-amber-50/95">
          <p className="font-semibold text-amber-100">Test phase under one year</p>
          <p className="mt-1.5 text-amber-50/90">
            Training with this little time after your training window does not leave enough room for meaningful
            backtesting. We recommend <strong className="text-amber-50">at least one year</strong> of test-phase calendar
            for valuable insights. Move your <strong className="text-amber-50">dataset end</strong> (end of training
            data) further <strong className="text-amber-50">back in time</strong> so more history sits before Today.
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-sky-100/80">
          Test phase is about {Math.round(testPhaseYears * 10) / 10} years of calendar runway—enough for serious
          holdout-style checks at a glance.
        </p>
      )}
    </div>
  );
}
