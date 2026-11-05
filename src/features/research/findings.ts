/**
 * Shared shape for diagnostic findings (Dataset Health, Model Health, backtest and analysis
 * findings). Rules produce these from measured values only; nothing here guesses.
 */

export type Severity = "problem" | "warning" | "info" | "ok";

/**
 * How strongly the measurements support the finding:
 * confirmed = the number itself is the problem; strong = several consistent signals;
 * plausible = one signal that has other explanations; inconclusive = not enough data to say.
 */
export type Evidence = "confirmed" | "strong" | "plausible" | "inconclusive";

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  confirmed: "Confirmed",
  strong: "Strong evidence",
  plausible: "Plausible hypothesis",
  inconclusive: "Inconclusive",
};

const SEVERITY_WORD: Record<Severity, string> = { problem: "Problem", warning: "Warning", info: "Note", ok: "OK" };

/** Badge text naming severity and evidence separately, so it always agrees with problem/warning counts. */
export function findingBadge(f: Pick<Finding, "severity" | "evidence">): string | null {
  if (!f.evidence) return null;
  if (f.severity === "ok") return EVIDENCE_LABEL[f.evidence];
  return `${SEVERITY_WORD[f.severity]} · ${EVIDENCE_LABEL[f.evidence].toLowerCase()}`;
}

export interface FindingAction {
  label: string;
  /** In-app route. */
  to?: string;
  /** Page-local target (a form field or section id) the page knows how to reveal. */
  target?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  evidence?: Evidence;
  title: string;
  /** What was detected, in one or two sentences. */
  detail: string;
  /** Why it matters for the result. */
  why?: string;
  measured?: { label: string; value: string }[];
  /** An experiment that would confirm or rule out the finding. */
  experiment?: string;
  action?: FindingAction;
}

const RANK: Record<Severity, number> = { problem: 0, warning: 1, info: 2, ok: 3 };

export function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

export function worstSeverity(list: Finding[]): Severity {
  return list.reduce<Severity>((w, f) => (RANK[f.severity] < RANK[w] ? f.severity : w), "ok");
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtPct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
