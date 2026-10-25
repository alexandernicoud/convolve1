import { createContext, useContext, useEffect, useState } from "react";
import { labelingOptimizerApi } from "@/lib/api";
import { surfaceFromAudit, surfaceFromHeatmaps, type Audit, type Conclusion, type Model, type Surface } from "./lib";
import { candidatesFromRaw, researchFromRaw, type Periods, type RankMode, type ResearchCandidates, type ResearchSurface } from "./research";

export type Metrics = Record<string, any>;
export type Timeseries = { dates?: string[]; strategy_compounded_pct?: number[]; asset_normalized_pct?: number[] };
export type CellIdx = { hi: number; si: number; ti: number };
export type TabId = "overview" | "search" | "performance" | "robustness" | "findings";

export type RunInfo = { methodology_version?: number; label_engine?: string; periods?: Periods };

export type RunData = {
  loading: boolean;
  error: string | null;
  artifacts: string[];
  metrics: Metrics | null;
  audit: Audit | null;
  surface: Surface | null;
  timeseries: Timeseries | null;
  /** Methodology v2 diagnostics; null for runs made before they existed. */
  research: ResearchSurface | null;
  candidates: ResearchCandidates | null;
  runInfo: RunInfo | null;
};

export function useRunData(runId: string | undefined): RunData {
  const [state, setState] = useState<RunData>({
    loading: true, error: null, artifacts: [], metrics: null, audit: null, surface: null, timeseries: null, research: null, candidates: null, runInfo: null,
  });

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const get = (name: string) => labelingOptimizerApi.getArtifact(runId, name).catch(() => null);
    (async () => {
      try {
        const { artifacts } = await labelingOptimizerApi.listArtifacts(runId);
        const has = (n: string) => artifacts.includes(n);
        const [metrics, audit, surfaceRaw, timeseries, researchRaw, candidatesRaw, runInfo] = await Promise.all([
          has("metrics") ? get("metrics") : null,
          has("optimizer_audit") ? get("optimizer_audit") : null,
          has("optimizer_surface") ? get("optimizer_surface") : null,
          has("best_system_timeseries") ? get("best_system_timeseries") : null,
          has("research_surface") ? get("research_surface") : null,
          has("research_candidates") ? get("research_candidates") : null,
          has("optimizer_run") ? get("optimizer_run") : null,
        ]);
        let surface = surfaceFromAudit(surfaceRaw);
        if (!surface && has("heatmaps_cagr")) {
          const best = metrics && Number.isFinite(metrics.best_tp) ? { tp: metrics.best_tp, sl: metrics.best_sl, h: metrics.best_h } : null;
          surface = surfaceFromHeatmaps(await get("heatmaps_cagr"), best);
        }
        if (alive)
          setState({
            loading: false,
            error: null,
            artifacts,
            metrics,
            audit: audit as Audit | null,
            surface,
            timeseries: timeseries as Timeseries | null,
            research: researchFromRaw(researchRaw, surface),
            candidates: candidatesFromRaw(candidatesRaw),
            runInfo: runInfo as RunInfo | null,
          });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Failed to load run" }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);
  return state;
}

/** Load one optional artifact by the first name that exists. */
export function useArtifact<T>(runId: string, artifacts: string[], names: string[], enabled = true): { data: T | null; name: string | null; loading: boolean } {
  const name = names.find((n) => artifacts.includes(n)) ?? null;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!name || !enabled) return;
    let alive = true;
    setLoading(true);
    labelingOptimizerApi
      .getArtifact(runId, name)
      .then((d) => alive && setData(d as T))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [runId, name, enabled]);
  return { data, name, loading };
}

export type ResultsCtxValue = RunData & {
  runId: string;
  symbol?: string;
  conclusion: Conclusion;
  model: Model;
  setModel: (m: Model) => void;
  rankMode: RankMode;
  setRankMode: (m: RankMode) => void;
  hIndex: number;
  setHIndex: (i: number) => void;
  cell: { si: number; ti: number } | null;
  setCell: (c: { si: number; ti: number }) => void;
  bestIdx: CellIdx | null;
  /** Select a grid cell everywhere; optionally switch to the heatmap. */
  select: (c: CellIdx, openHeatmap?: boolean) => void;
  goTab: (t: TabId) => void;
};

export const ResultsCtx = createContext<ResultsCtxValue | null>(null);

export function useResults(): ResultsCtxValue {
  const v = useContext(ResultsCtx);
  if (!v) throw new Error("useResults outside ResultsCtx");
  return v;
}
