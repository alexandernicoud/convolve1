import { useEffect, useState } from "react";
import { trainerApi } from "@/lib/api";
import { HeatmapPlotCore } from "./HeatmapPlotCore";
import { cn } from "@/lib/utils";

type Bundle = {
  selected_maps: { index: number; values: number[][] }[];
};

type Props = {
  runId: string;
  analysisId: string;
  filename: string;
  /** Short label (e.g. layer name) shown above the grid. */
  title?: string;
  className?: string;
};

export function LearnedFiltersGrid({ runId, analysisId, filename, title, className }: Props) {
  const [data, setData] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    trainerApi
      .getAnalysisArtifact<Bundle>(runId, analysisId, filename)
      .then((j) => {
        if (!cancelled) setData(j?.selected_maps?.length ? j : null);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [runId, analysisId, filename]);

  if (err) {
    return <p className="text-xs text-rose-300/80">{err}</p>;
  }

  if (!data?.selected_maps?.length) {
    return (
      <div className={cn("flex h-24 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0c0c0e] text-xs text-white/35", className)}>
        Loading…
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {title ? <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/55">{title}</p> : null}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {data.selected_maps.map((m) => (
          <div
            key={m.index}
            className="relative aspect-square overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]"
          >
            <HeatmapPlotCore z={m.values} title={`F${m.index}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
