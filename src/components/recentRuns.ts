import type { GlobalRun } from "@/lib/api";

export type CollapsedRun = GlobalRun & { repeats: number };

/** Back-to-back failures with the same message are one row ("Failed 3×"); the newest is kept. */
export function collapseRepeatedFailures(sorted: GlobalRun[]): CollapsedRun[] {
  const out: CollapsedRun[] = [];
  for (const run of sorted) {
    const prev = out[out.length - 1];
    if (prev && run.status === "failed" && prev.status === "failed" && (run.message || "") === (prev.message || "")) {
      prev.repeats += 1;
      continue;
    }
    out.push({ ...run, repeats: 1 });
  }
  return out;
}
