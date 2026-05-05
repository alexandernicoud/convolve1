import { useEffect, useState } from "react";
import { trainerApi } from "@/lib/api";
import { HeatmapPlotCore, heatmapAspectRatio } from "./HeatmapPlotCore";
import { HeatmapScaleChip } from "./AnalysisChartChrome";
import type { MatrixJson } from "./analysisTypes";
import { cn } from "@/lib/utils";

export type { MatrixJson };

type Props = {
  runId: string;
  analysisId: string;
  filename: string;
  title?: string;
  hint?: string;
  className?: string;
  /** Set false to hide the color-scale legend chip (e.g. for very small tiles). */
  showScale?: boolean;
  scaleLabel?: string;
  /** Map API JSON to matrix (e.g. attention_overlay nests values under heatmap). */
  extract?: (raw: unknown) => MatrixJson | null;
};

export function MatrixHeatmapPlot({
  runId,
  analysisId,
  filename,
  title,
  hint,
  className,
  showScale = true,
  scaleLabel = "Intensity",
  extract,
}: Props) {
  const [data, setData] = useState<MatrixJson | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    trainerApi
      .getAnalysisArtifact<unknown>(runId, analysisId, filename)
      .then((raw) => {
        if (cancelled) return;
        const parsed = extract ? extract(raw) : (raw as MatrixJson);
        setData(parsed && parsed.values?.length ? parsed : null);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [runId, analysisId, filename, extract]);

  if (err) {
    return (
      <div className={cn("rounded-2xl border border-white/[0.08] bg-[#0c0c0e] p-4 text-xs text-rose-300/80", className)}>
        {err}
      </div>
    );
  }

  if (!data?.values?.length) {
    return (
      <div
        className={cn(
          "flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]",
          className,
        )}
      >
        <span className="text-xs text-white/35">Loading…</span>
      </div>
    );
  }

  const aspect = heatmapAspectRatio(data.values);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]",
        className,
      )}
      style={{ aspectRatio: aspect }}
    >
      <HeatmapPlotCore
        z={data.values}
        title={title || data.title}
        hint={hint}
      />
      {showScale ? <HeatmapScaleChip label={scaleLabel} /> : null}
    </div>
  );
}
