import type { InternalModel } from "@/lib/api";

/** Picker suffix so an undecided Improve experiment is never mistaken for an original model. */
export function lifecycleSuffix(m: Pick<InternalModel, "lifecycle" | "improve">): string {
  if (m.lifecycle === "candidate") return " · Improve candidate (undecided)";
  if (m.lifecycle === "kept") return m.improve?.preferred ? " · Kept, preferred" : " · Kept";
  return "";
}

/** Originals and kept models first, undecided candidates last; order is otherwise preserved. */
export function candidatesLast<T extends Pick<InternalModel, "lifecycle">>(models: T[]): T[] {
  return [...models.filter((m) => m.lifecycle !== "candidate"), ...models.filter((m) => m.lifecycle === "candidate")];
}
