import type { InternalModel } from "@/lib/api";

export const createdMs = (m: InternalModel) => {
  const v = m.created_at;
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(n)) return 0;
  return n < 1e12 ? n * 1000 : n;
};

/** Trained library models worth listing: not archived, not an undecided Improve candidate; newest first. */
export function libraryModels(models: InternalModel[]): InternalModel[] {
  return models
    .filter((m) => m.kind === "trained" && !!m.training_run_id && !m.archived && m.lifecycle !== "candidate" && m.lifecycle !== "archived")
    .sort((a, b) => createdMs(b) - createdMs(a));
}
