import type { Finding } from "@/features/research/findings";

/** The Improve experiment of the most severe Model Health finding that has one; null when none applies. */
export function recommendedExperiment(findings: Finding[]): { finding: Finding; label: string; to: string } | null {
  const rank = { problem: 0, warning: 1 } as Record<string, number>;
  const hit = findings
    .filter((f) => f.severity in rank && f.action?.to?.startsWith("/tools/improve"))
    .sort((a, b) => rank[a.severity] - rank[b.severity])[0];
  return hit?.action?.to ? { finding: hit, label: hit.action.label, to: hit.action.to } : null;
}
