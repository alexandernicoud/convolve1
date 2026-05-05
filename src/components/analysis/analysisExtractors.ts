import type { MatrixJson } from "./analysisTypes";

export function extractAttentionHeatmap(raw: unknown): MatrixJson | null {
  const r = raw as { heatmap?: { values?: number[][] }; title?: string };
  if (!r?.heatmap?.values?.length) return null;
  return { values: r.heatmap.values, title: r.title };
}
