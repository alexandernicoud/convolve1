/**
 * Improve workspace: presentation rules for verdicts, groups and the keep/discard suggestion.
 *
 * The server decides the verdict (app/services/improve_sessions.py). This module only maps it to
 * wording and to what the workspace suggests; the user always makes the decision.
 */
import type { ImproveExperiment, ImproveGroup, ImproveSession, ImproveVerdictId } from "@/lib/api";

export const VERDICT_COPY: Record<ImproveVerdictId, { label: string; tone: "good" | "bad" | "neutral" | "muted" }> = {
  clearly_improved: { label: "Clearly improved", tone: "good" },
  no_clear_difference: { label: "No clear difference", tone: "neutral" },
  insufficient_evidence: { label: "Insufficient evidence", tone: "neutral" },
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

export type NextAction = { kind: "keep" | "archive" | "seed_original" | "repeat" | null; label: string; why: string };

export interface ResultCopy {
  label: string;
  tone: "good" | "bad" | "neutral" | "muted";
  /** One plain sentence on what the numbers mean. */
  meaning: string;
  next: NextAction;
}

/**
 * Plain-language reading of a server verdict. Only ``clearly_improved`` reads as better: a small
 * positive difference under ``no_clear_difference`` or ``insufficient_evidence`` is described as
 * not (yet) evidence of improvement, and never suggests keeping.
 */
export function resultCopy(
  e: Pick<ImproveExperiment, "verdict" | "deltas" | "is_replicate" | "variant_key">,
  noise: Pick<ImproveSession["noise"], "sufficient" | "baseline_runs" | "required">,
): ResultCopy {
  const v = e.verdict.verdict;
  const base = VERDICT_COPY[v] ?? VERDICT_COPY.pending;
  const d = e.deltas?.roc_auc ?? e.verdict.difference ?? null;
  const dir = d == null || Math.abs(d) < 0.0005 ? "flat" : d > 0 ? "up" : "down";
  const moreSeeds: NextAction = noise.sufficient
    ? e.variant_key && !e.is_replicate
      ? { kind: "repeat", label: "Run another seed", why: "A second run of this same change shows whether the difference holds or was luck." }
      : { kind: null, label: "", why: "" }
    : {
        kind: "seed_original",
        label: "Run another seed of the original",
        why: `Verdicts need ${noise.required} runs of the original settings to measure run-to-run noise; ${noise.baseline_runs} ${noise.baseline_runs === 1 ? "exists" : "exist"} so far.`,
      };
  if (e.is_replicate || v === "replicate")
    return {
      ...base,
      meaning: "A rerun of the original settings with another seed. It measures run-to-run noise and is not a candidate model.",
      next: { kind: "archive", label: "Archive replicate", why: "It stays in the noise estimate after archiving." },
    };
  switch (v) {
    case "clearly_improved":
      return {
        ...base,
        meaning: "ROC-AUC rose by more than run-to-run noise and validation sampling can explain.",
        next: { kind: "keep", label: "Keep improved model", why: "It joins your library next to the original; the original is not replaced." },
      };
    case "worse":
      return {
        ...base,
        meaning: "ROC-AUC fell by more than the noise margin. This change did not help this model.",
        next: { kind: "archive", label: "Archive experiment", why: "Archiving hides it from your tools and can be undone. The original model is unchanged." },
      };
    case "no_clear_difference":
      return {
        ...base,
        meaning:
          dir === "up"
            ? "ROC-AUC is slightly higher, but within the noise margin, so this is not evidence of an improvement."
            : dir === "down"
              ? "ROC-AUC is slightly lower, but within the noise margin, so this is not evidence it is worse."
              : "ROC-AUC is practically the same as the original.",
        next: moreSeeds.kind ? moreSeeds : { kind: "archive", label: "Archive experiment", why: "Not clearly better than the original. Archiving can be undone." },
      };
    case "insufficient_evidence":
      return {
        ...base,
        meaning:
          dir === "up"
            ? "Performance increased slightly, but there is not enough evidence yet to separate the difference from training randomness."
            : dir === "down"
              ? "Performance decreased slightly, but there is not enough evidence yet to separate the difference from training randomness."
              : "There is not enough evidence yet to compare this experiment with the original.",
        next: moreSeeds.kind ? moreSeeds : { kind: "archive", label: "Archive experiment", why: "Archiving can be undone." },
      };
    case "not_comparable":
      return { ...base, meaning: "Its validation setup differs from the original, so the numbers cannot be compared directly.", next: { kind: null, label: "", why: "" } };
    default:
      return { ...base, meaning: "Results appear when training finishes.", next: { kind: null, label: "", why: "" } };
  }
}

/** Human-readable experiment name: the change it tests, then which run of it. */
export function experimentTitle(
  e: Pick<ImproveExperiment, "variant_key" | "replicate" | "is_replicate" | "display_name" | "name" | "run_id">,
  labels: Record<string, { label: string }>,
): string {
  const key = e.variant_key ?? (e.is_replicate ? "seed" : null);
  const base = key && labels[key] ? labels[key].label : (e.display_name ?? e.name ?? e.run_id).replace(/\.keras$/i, "");
  return (e.replicate ?? 0) > 0 ? `${base} · run ${(e.replicate ?? 0) + 1}` : base;
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
