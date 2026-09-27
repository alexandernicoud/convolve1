import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  buildGeneratorTimelineAxisTicks,
  calendarDaysBetween,
  parseIsoDate,
  isoFromTimelinePercent,
  timelinePercentFromIso,
} from "@/lib/generatorDates";

type Props = {
  testStartIso: string;
  testEndIso: string;
  onTestStartChange: (iso: string) => void;
  onTestEndChange: (iso: string) => void;
  /** Known training period (from model/run metadata) — rendered as a fixed reference band. */
  trainingStartIso?: string | null;
  trainingEndIso?: string | null;
  /** Override heading (default: test-period wording). */
  heading?: string;
  /** Override helper copy under the heading. */
  helperText?: ReactNode;
  /** Legend / readout label for the movable band (default: "Test period"). */
  bandLabel?: string;
};

/**
 * Interactive past timeline (1960 → today) for picking a calendar period.
 * Mirrors the GeneratorTimeline drag UX; when a training period is known it is
 * drawn as a fixed band so overlap with the selection is visible at a glance.
 */
export default function TestPeriodTimeline({
  testStartIso,
  testEndIso,
  onTestStartChange,
  onTestEndChange,
  trainingStartIso,
  trainingEndIso,
  heading,
  helperText,
  bandLabel = "Test period",
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<null | "start" | "end">(null);

  const pctEnd = timelinePercentFromIso(testEndIso);
  const pctStart = timelinePercentFromIso(testStartIso);

  const trainStart = trainingStartIso ? parseIsoDate(trainingStartIso) : null;
  const trainEnd = trainingEndIso ? parseIsoDate(trainingEndIso) : null;
  const trainPctStart = trainStart && trainingStartIso ? timelinePercentFromIso(trainingStartIso) : null;
  const trainPctEnd = trainEnd && trainingEndIso ? timelinePercentFromIso(trainingEndIso) : null;

  const testStartDate = parseIsoDate(testStartIso);
  const testEndDate = parseIsoDate(testEndIso);
  const overlap =
    trainStart != null &&
    trainEnd != null &&
    testStartDate != null &&
    testEndDate != null &&
    testStartDate < trainEnd &&
    testEndDate > trainStart;

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
        onTestEndChange(iso);
        const s = parseIsoDate(testStartIso);
        const e = parseIsoDate(iso);
        if (s && e && s > e) onTestStartChange(iso);
        return;
      }
      const eD = parseIsoDate(testEndIso);
      const sD = parseIsoDate(iso);
      if (eD && sD && sD > eD) {
        onTestStartChange(testEndIso);
        return;
      }
      onTestStartChange(iso);
    },
    [onTestStartChange, onTestEndChange, testStartIso, testEndIso],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      applyPercent(drag, readPercentFromClientX(e.clientX));
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
    const which: "start" | "end" = Math.abs(p - pctStart) <= Math.abs(p - pctEnd) ? "start" : "end";
    setDrag(which);
    applyPercent(which, p);
  };

  const left = Math.min(pctStart, pctEnd);
  const width = Math.max(Math.abs(pctEnd - pctStart), 1.2);

  const axisTicks = buildGeneratorTimelineAxisTicks();
  const testSpanDays =
    testStartDate && testEndDate ? Math.max(0, calendarDaysBetween(testStartDate, testEndDate)) : 0;

  const testBandClass = overlap
    ? "bg-red-500/35 ring-1 ring-red-400/60"
    : "bg-sky-500/30 ring-1 ring-sky-400/45";

  const defaultHelper = (
    <>
      The <span className="text-sky-200/90">blue band</span> is the <strong className="text-white/85">test</strong>{" "}
      period — labeled charts are generated for every trading day inside it.
      {trainPctStart != null || trainPctEnd != null ? (
        <>
          {" "}
          The <span className="text-white/75">grey band</span> is the model's{" "}
          <strong className="text-white/85">training</strong> period; keep the bands apart to avoid data leakage.
        </>
      ) : null}
    </>
  );

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(255,255,255,0.55)]">
          {heading ?? `${bandLabel} — drag handles`}
        </span>
        <span className="text-[10px] text-white/45">Drag handles on the bar · dates follow the handles</span>
      </div>

      <p className="text-xs leading-relaxed text-[#F5F5F5]/55">{helperText ?? defaultHelper}</p>

      <div className="flex flex-wrap items-center gap-4 text-[10px] uppercase tracking-[0.12em] text-white/55">
        <span className="inline-flex items-center gap-2">
          <span
            className={`h-2.5 w-6 rounded-sm ${overlap ? "bg-red-400/60 ring-1 ring-red-300/60" : "bg-sky-400/45 ring-1 ring-sky-300/50"}`}
            aria-hidden
          />
          {bandLabel}
        </span>
        {trainPctStart != null || trainPctEnd != null ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-6 rounded-sm bg-white/25 ring-1 ring-white/30" aria-hidden />
            Training period (model)
          </span>
        ) : null}
      </div>

      <div
        ref={trackRef}
        role="presentation"
        onPointerDown={onTrackPointerDown}
        className="relative w-full cursor-crosshair touch-none overflow-visible rounded border border-white/10 bg-[#0a0a0a]/80 py-8 select-none"
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-2 h-4 px-0 text-[9px]">
          {axisTicks.map((t) =>
            t.label === "Today" ? (
              <span key="today" className="absolute bottom-0 right-0 whitespace-nowrap font-medium text-white/60">
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

        {trainPctStart != null && trainPctEnd != null ? (
          <div
            className="pointer-events-none absolute bottom-7 z-0 h-2.5 rounded bg-white/22 ring-1 ring-white/35"
            style={{
              left: `${Math.min(trainPctStart, trainPctEnd)}%`,
              width: `${Math.max(Math.abs(trainPctEnd - trainPctStart), 1)}%`,
            }}
            title="Training period (from model metadata)"
          />
        ) : null}

        <div
          className={`pointer-events-none absolute bottom-7 z-10 h-3 rounded ${testBandClass}`}
          style={{ left: `${left}%`, width: `${width}%` }}
          title={`${bandLabel} (~${testSpanDays} calendar days)`}
        />

        <button
          type="button"
          aria-label={`${bandLabel} start`}
          className="absolute bottom-5 z-20 w-4 -translate-x-1/2 cursor-grab rounded border border-white/40 bg-white shadow-md active:cursor-grabbing"
          style={{ left: `${pctStart}%`, height: "28px" }}
          onPointerDown={onDown("start")}
        />
        <button
          type="button"
          aria-label={`${bandLabel} end`}
          className="absolute bottom-5 z-20 w-4 -translate-x-1/2 cursor-grab rounded border border-white/40 bg-white shadow-md active:cursor-grabbing"
          style={{ left: `${pctEnd}%`, height: "28px" }}
          onPointerDown={onDown("end")}
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/80">
        <span>
          <span className="text-white/45">Start · </span>
          <span className="font-mono text-white">{testStartIso}</span>
        </span>
        <span>
          <span className="text-white/45">End · </span>
          <span className="font-mono text-white">{testEndIso}</span>
        </span>
        <span>
          <span className="text-white/45">Span · </span>
          <span className="font-mono text-white">~{testSpanDays}d</span>
        </span>
      </div>
    </div>
  );
}
