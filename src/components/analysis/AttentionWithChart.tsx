import { useEffect, useMemo, useState } from "react";
import { apiUrl, trainerApi } from "@/lib/api";
import { HeatmapPlotCore, heatmapAspectRatio } from "./HeatmapPlotCore";
import { HeatmapScaleChip } from "./AnalysisChartChrome";
import { RasterChartPanel } from "./RasterChartPanel";
import { cn } from "@/lib/utils";

export type AttentionJson = {
  width?: number;
  height?: number;
  heatmap: { width?: number; height?: number; values: number[][] };
  chart_image_file: string;
};

export type AttentionPayload =
  | { status: "loading"; error: null }
  | { status: "error"; error: string }
  | {
      status: "ready";
      error: null;
      heatmap: { values: number[][]; width: number; height: number };
      inputWidth: number;
      inputHeight: number;
      chartSrc: string;
    };

/**
 * Shared data hook powering AttentionWithChart and the §2 page layout.
 * Resolves the artifact + the absolute image URL in one place.
 */
export function useAttentionPayload(
  runId: string,
  analysisId: string,
  filename: string | null,
): AttentionPayload {
  const [raw, setRaw] = useState<AttentionJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filename) {
      setRaw(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setRaw(null);
    trainerApi
      .getAnalysisArtifact<AttentionJson>(runId, analysisId, filename)
      .then((j) => {
        if (!cancelled && j?.heatmap?.values?.length) setRaw(j);
        else if (!cancelled) setError("No attention payload returned");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [runId, analysisId, filename]);

  const chartSrc = useMemo(() => {
    if (!raw?.chart_image_file) return "";
    return apiUrl(
      `/trainer/runs/${runId}/analysis/${analysisId}/images/${encodeURIComponent(raw.chart_image_file)}`,
    );
  }, [runId, analysisId, raw]);

  if (error) return { status: "error", error };
  if (!raw) return { status: "loading", error: null };

  const inputWidth = raw.width ?? raw.heatmap?.width ?? raw.heatmap.values[0]?.length ?? 224;
  const inputHeight = raw.height ?? raw.heatmap?.height ?? raw.heatmap.values.length ?? 224;
  const heatmapCols = raw.heatmap.values[0]?.length ?? 0;
  const heatmapRows = raw.heatmap.values.length;

  return {
    status: "ready",
    error: null,
    heatmap: { values: raw.heatmap.values, width: heatmapCols, height: heatmapRows },
    inputWidth,
    inputHeight,
    chartSrc,
  };
}

type Props = {
  runId: string;
  analysisId: string;
  filename: string;
  className?: string;
};

export function AttentionWithChart({ runId, analysisId, filename, className }: Props) {
  const payload = useAttentionPayload(runId, analysisId, filename);

  if (payload.status === "error") {
    return (
      <div className={cn("rounded-2xl border border-white/[0.08] bg-[#0c0c0e] p-4 text-xs text-rose-300/80", className)}>
        {payload.error}
      </div>
    );
  }

  if (payload.status === "loading") {
    return (
      <div className={cn("flex aspect-[2/1] items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0c0c0e] text-xs text-white/35", className)}>
        Loading…
      </div>
    );
  }

  const heatmapAspect = heatmapAspectRatio(payload.heatmap.values);
  const rasterAspect = payload.inputWidth / payload.inputHeight;

  return (
    <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start", className)}>
      <div
        className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]"
        style={{ aspectRatio: heatmapAspect }}
      >
        <HeatmapPlotCore
          z={payload.heatmap.values}
          title="Class activation"
          hint="Grad-CAM"
        />
        <HeatmapScaleChip label="Attention" minLabel="low" maxLabel="high" />
      </div>
      <div
        className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]"
        style={{ aspectRatio: rasterAspect }}
      >
        <RasterChartPanel
          src={payload.chartSrc}
          title="Model input"
          widthPx={payload.inputWidth}
          heightPx={payload.inputHeight}
        />
      </div>
    </div>
  );
}
