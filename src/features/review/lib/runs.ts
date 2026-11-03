import type { ReviewOverviewResponse, ReviewRun } from "@/lib/api";

/**
 * Runs whose output is already listed in a dedicated section (a model under Models, a training
 * or test set under Datasets) are not repeated here.
 */
export function producedListedAsset(r: ReviewRun, data: Pick<ReviewOverviewResponse, "models" | "datasets">): boolean {
  if (r.tool === "trainer") return data.models.some((m) => m.training_run_id === r.id || m.id === r.id);
  if (r.tool === "training-chart-generator") return data.datasets.some((d) => d.generator_run_id === r.id);
  if (r.tool === "testdata") return data.datasets.some((d) => d.testdata_run_id === r.id);
  return false;
}
