/**
 * Improve workspace: presentation rules for verdicts, groups and the keep/discard suggestion.
 *
 * The server decides the verdict (app/services/improve_sessions.py). This module only maps it to
 * wording and to what the workspace suggests; the user always makes the decision.
 */
import type { ImproveExperiment, ImproveGroup, ImproveVerdictId } from "@/lib/api";

export const VERDICT_COPY: Record<ImproveVerdictId, { label: string; tone: "good" | "bad" | "neutral" | "muted" }> = {
  clearly_improved: { label: "Clearly improved", tone: "good" },
  no_clear_difference: { label: "No clear difference", tone: "neutral" },
  insufficient_evidence: { label: "No clear difference · insufficient evidence", tone: "neutral" },
  worse: { label: "Worse", tone: "bad" },
  not_comparable: { label: "Not comparable", tone: "muted" },
  pending: { label: "Waiting for results", tone: "muted" },
  replicate: { label: "Noise replicate", tone: "muted" },
};

export const GROUP_COPY: Record<ImproveGroup, string> = {
  awaiting_decision: "Awaiting your decision",
  running: "Running",
  queued: "Queued",
  kept: "Kept in your library",
  archived: "Archived",
  failed: "Failed or cancelled",
};

export type Suggestion = { action: "keep" | "discard" | "replicate" | null; text: string };

/** What the workspace proposes for a completed candidate. Never applied without confirmation. */
export function suggestion(e: Pick<ImproveExperiment, "verdict" | "is_replicate" | "group">): Suggestion {
  if (e.group !== "awaiting_decision") return { action: null, text: "" };
  if (e.is_replicate || e.verdict.verdict === "replicate")
    return {
      action: "discard",
      text: "A replicate of the original settings. It only measures noise; archiving it keeps it in the noise estimate.",
    };
  switch (e.verdict.verdict) {
    case "clearly_improved":
      return { action: "keep", text: "Clearly better than the original on validation data. Suggested: keep it in your library." };
    case "worse":
      return { action: "discard", text: "Worse than the original. Suggested: archive it." };
    case "no_clear_difference":
      return { action: "discard", text: "Not clearly better than the original. Suggested: archive it." };
    case "insufficient_evidence":
      return {
        action: "replicate",
        text: "The difference cannot be judged yet. Add seed replicates of the original (and of this variant) before deciding, or archive it.",
      };
    default:
      return { action: null, text: "" };
  }
}

export const GROUP_ORDER: ImproveGroup[] = ["awaiting_decision", "running", "queued", "kept", "archived", "failed"];

export function byGroup(experiments: ImproveExperiment[]): Record<ImproveGroup, ImproveExperiment[]> {
  const out = Object.fromEntries(GROUP_ORDER.map((g) => [g, [] as ImproveExperiment[]])) as Record<ImproveGroup, ImproveExperiment[]>;
  for (const e of experiments) (out[e.group] ?? out.failed).push(e);
  return out;
}

export function isActive(experiments: ImproveExperiment[]): boolean {
  return experiments.some((e) => e.group === "running" || e.group === "queued");
}

/** One line per changed setting, from the server's config diff, else the recorded change list. */
export function changeLines(e: Pick<ImproveExperiment, "changed" | "recorded_changes">): string[] {
  if (e.changed.length) return e.changed.map((c) => `${c.label}: ${show(c.from)} → ${show(c.to)}`);
  return e.recorded_changes;
}

function show(v: unknown): string {
  if (v == null) return "none";
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== "" && !(Array.isArray(x) && !x.length));
    return entries.length ? entries.map(([k, x]) => `${k} ${Array.isArray(x) ? x.join("×") : String(x)}`).join(", ") : "none";
  }
  return String(v);
}
