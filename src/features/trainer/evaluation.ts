/**
 * Reading of a run's evaluation.json (backend/runners/eval_metrics.py) for the session page.
 * Only states comparisons that follow from the recorded numbers; never infers trading skill.
 */
import type { PartitionMetrics, TrainingSession } from "@/lib/api";

export type MetricRow = {
  key: string;
  label: string;
  model: number | null;
  /** The constant predictor's value; null when no baseline applies. */
  baseline: number | null;
  baselineNote?: string;
  lowerIsBetter?: boolean;
  /** Format as a percentage (shares) instead of a plain number. */
  pct?: boolean;
  /** Reason the value is undefined on this partition (e.g. one class absent). */
  undefinedReason?: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function metricRows(m: PartitionMetrics): MetricRow[] {
  const b = m.baseline ?? {};
  const und = m.undefined ?? {};
  return [
    { key: "accuracy", label: "Accuracy", model: num(m.accuracy), baseline: num(b.accuracy), baselineNote: "always the training majority label", pct: true },
    {
      key: "balanced_accuracy",
      label: "Balanced accuracy",
      model: num(m.balanced_accuracy),
      baseline: num(b.balanced_accuracy),
      baselineNote: "any constant prediction",
      pct: true,
      undefinedReason: und.balanced_accuracy,
    },
    { key: "roc_auc", label: "ROC-AUC", model: num(m.roc_auc), baseline: num(m.roc_auc) == null ? null : 0.5, baselineNote: "no ranking", undefinedReason: und.roc_auc },
    {
      key: "pr_auc",
      label: "PR-AUC (label 1)",
      model: num(m.pr_auc),
      baseline: num(m.pr_auc_no_skill),
      baselineNote: "share of label 1",
      undefinedReason: und.pr_auc,
    },
    { key: "log_loss", label: "Log loss", model: num(m.log_loss), baseline: num(b.log_loss), baselineNote: "training label share as probability", lowerIsBetter: true },
    { key: "brier", label: "Brier score", model: num(m.brier), baseline: num(b.brier), baselineNote: "training label share as probability", lowerIsBetter: true },
    { key: "precision", label: "Precision (label 1)", model: num(m.precision), baseline: null, pct: true, undefinedReason: und.precision },
    { key: "recall", label: "Recall (label 1)", model: num(m.recall), baseline: null, pct: true, undefinedReason: und.recall },
    { key: "f1", label: "F1 (label 1)", model: num(m.f1), baseline: null, pct: true, undefinedReason: und.f1 },
  ];
}

/** "better" / "worse" / "equal" against the baseline, or null when there is nothing to compare. */
export function versusBaseline(r: MetricRow): "better" | "worse" | "equal" | null {
  if (r.model == null || r.baseline == null) return null;
  const d = r.model - r.baseline;
  if (Math.abs(d) < 1e-9) return "equal";
  return (r.lowerIsBetter ? d < 0 : d > 0) ? "better" : "worse";
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Plain statements about one partition, in order of importance. */
export function findings(m: PartitionMetrics): string[] {
  const out: string[] = [];
  if (m.status === "reserved_not_evaluated" || m.accuracy == null) return out;
  const pred = m.predicted_counts ?? {};
  const p0 = pred["0"] ?? 0;
  const p1 = pred["1"] ?? 0;
  if (m.n > 0 && (p0 === 0 || p1 === 0)) {
    const only = p0 === 0 ? 1 : 0;
    out.push(
      `The model predicted label ${only} for every chart at the 0.5 threshold${
        m.baseline?.majority_label === only ? ", which is exactly what the majority baseline does" : ""
      }.`,
    );
  }
  const acc = num(m.accuracy);
  const bacc = num(m.baseline?.accuracy);
  if (acc != null && bacc != null) {
    const bal = num(m.balanced_accuracy);
    const n0 = m.label_counts?.["0"] ?? 0;
    const n1 = m.label_counts?.["1"] ?? 0;
    const prior = num(m.baseline?.prior_label_1);
    const drift =
      prior != null && n0 + n1 > 0 && Math.abs(n1 / (n0 + n1) - prior) >= 0.05
        ? ` Label 1 is ${pct1(n1 / (n0 + n1))} of this partition against ${pct1(prior)} of the training charts, so predicting the other label more often raises accuracy by itself.`
        : "";
    out.push(
      acc > bacc + 1e-9
        ? bal != null && bal <= 0.5
          ? `Accuracy ${pct1(acc)} is above the ${pct1(bacc)} of always predicting label ${m.baseline?.majority_label}, but balanced accuracy is ${pct1(bal)}: the model does not separate the labels better than a constant guess.${drift}`
          : `Accuracy ${pct1(acc)} is above the ${pct1(bacc)} of always predicting label ${m.baseline?.majority_label}.`
        : `Accuracy ${pct1(acc)} is not above the ${pct1(bacc)} of always predicting label ${m.baseline?.majority_label}${acc > 0.5 ? ", even though it is above 50%" : ""}.`,
    );
  }
  const ll = num(m.log_loss);
  const bll = num(m.baseline?.log_loss);
  if (ll != null && bll != null) {
    out.push(
      ll < bll
        ? `Log loss ${ll.toFixed(4)} is lower than the constant baseline's ${bll.toFixed(4)}. That can come from ranking charts better or only from an average probability closer to this partition's label mix; ROC-AUC separates the two.`
        : `Log loss ${ll.toFixed(4)} is not lower than the constant baseline's ${bll.toFixed(4)}: the probabilities are no better than the training label share.`,
    );
  }
  const auc = num(m.roc_auc);
  if (auc != null) {
    out.push(`ROC-AUC ${auc.toFixed(3)}; 0.5 means label-1 charts are not ranked above label-0 charts.`);
  }
  return out;
}

export const SELECTION_NAME: Record<string, string> = {
  val_loss: "validation loss",
  val_balanced_accuracy: "validation balanced accuracy",
  val_auc: "validation ROC-AUC",
  val_pr_auc: "validation PR-AUC",
  val_accuracy: "validation accuracy",
};

export function selectionName(session: Pick<TrainingSession, "selection_metric"> | null | undefined): string {
  const n = session?.selection_metric?.name ?? "val_loss";
  return SELECTION_NAME[n] ?? n;
}

/** Why the run ended, from the recorded stopping block (protocol 2) or the legacy summary. */
export function stoppingText(session: TrainingSession): string | null {
  const s = session.stopping;
  const patience = session.options?.early_stopping?.patience;
  if (s?.reason === "early_stopping" && s.monitor && patience) {
    const name = SELECTION_NAME[s.monitor] ?? s.monitor;
    return `Early stopping: ${patience} epochs without a better ${name}.`;
  }
  if (s?.detail) {
    return s.reason === "early_stopping" ? `Early stopping: ${s.detail.replace(/val_/g, "validation ").replace(/_/g, " ")}.` : `${s.detail}.`;
  }
  const sum = session.summary;
  if (sum?.stopped_early != null) return sum.stopped_early ? "Early stopping ended the run." : "Ran to the configured maximum epochs.";
  return null;
}

/** Histogram bars as shares of each label, so unequal class sizes stay comparable. */
export function histogramShares(h: NonNullable<PartitionMetrics["probability_histogram"]>): { from: number; to: number; label0: number; label1: number }[] {
  const n0 = h.label_0.reduce((a, b) => a + b, 0);
  const n1 = h.label_1.reduce((a, b) => a + b, 0);
  return h.label_0.map((c0, i) => ({
    from: h.edges[i],
    to: h.edges[i + 1],
    label0: n0 ? c0 / n0 : 0,
    label1: n1 ? (h.label_1[i] ?? 0) / n1 : 0,
  }));
}
