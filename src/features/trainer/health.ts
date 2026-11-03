/**
 * Model Health: diagnostics computed from a finished run's recorded history, evaluation.json,
 * split counts and architecture table. Each finding carries an evidence level, the numbers it
 * rests on, an experiment that would test it and, where one exists, an Improve preset.
 */
import type { PartitionMetrics, TrainingEpoch, TrainingSession } from "@/lib/api";
import { fmtInt, fmtPct, sortFindings, type Finding } from "@/features/research/findings";

export type ImprovePreset = "smaller" | "gap" | "dense" | "regularize" | "dropout" | "lr" | "class_weight" | "epochs";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const f3 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3));
const p1 = (x: number | null | undefined) => (x == null ? "—" : fmtPct(x, 1));

/** Hanley–McNeil standard error of ROC-AUC. */
export function aucStdError(auc: number, n1: number, n0: number): number | null {
  if (!(n1 > 0 && n0 > 0)) return null;
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const v = (auc * (1 - auc) + (n1 - 1) * (q1 - auc * auc) + (n0 - 1) * (q2 - auc * auc)) / (n1 * n0);
  return v > 0 ? Math.sqrt(v) : null;
}

function share1(counts?: Record<string, number> | null): number | null {
  if (!counts) return null;
  const a = counts["1"] ?? 0;
  const b = counts["0"] ?? 0;
  return a + b > 0 ? a / (a + b) : null;
}

/** Recall of each class from the confusion matrix (rows true, columns predicted). */
export function classRecalls(m: PartitionMetrics): { r0: number | null; r1: number | null; p0: number | null; p1: number | null } {
  const cm = m.confusion_matrix?.rows_true_cols_pred;
  if (!cm || cm.length !== 2) return { r0: null, r1: num(m.recall), p0: null, p1: num(m.precision) };
  const [[tn, fp], [fn, tp]] = cm;
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return { r0: div(tn, tn + fp), r1: div(tp, tp + fn), p0: div(tn, tn + fn), p1: div(tp, tp + fp) };
}

export function modelHealth(session: TrainingSession, runId: string): Finding[] {
  const out: Finding[] = [];
  const improve = (preset: ImprovePreset, label: string) => ({
    label,
    to: `/tools/improve?model=${encodeURIComponent(`trained:${runId}`)}&from=model-health&preset=${preset}`,
  });
  const hist: TrainingEpoch[] = (session.history ?? []).filter((h) => h && typeof h.epoch === "number");
  const savedEpoch = session.summary?.saved_weights_epoch ?? session.best_epoch ?? hist.at(-1)?.epoch ?? null;
  const saved = savedEpoch != null ? hist.find((h) => h.epoch === savedEpoch) ?? session.summary?.saved_weights_metrics ?? null : null;
  const v = session.evaluation?.validation;
  const evaluated = !!v && v.accuracy != null && v.status !== "reserved_not_evaluated";
  const last = hist.at(-1);

  // Training versus validation, generalization gap, over- and underfitting.
  if (saved && num(saved.accuracy) != null && num(saved.val_accuracy) != null) {
    const gap = (saved.accuracy as number) - (saved.val_accuracy as number);
    const vl = hist.map((h) => num(h.val_loss)).filter((x): x is number => x != null);
    const minVl = vl.length ? Math.min(...vl) : null;
    const lastVl = num(last?.val_loss);
    const rising = minVl != null && lastVl != null && lastVl > minVl * 1.1 && hist.length - hist.findIndex((h) => h.val_loss === minVl) > 2;
    const trainLossFalling = hist.length >= 3 && num(hist[0].loss) != null && num(last?.loss) != null && (last!.loss as number) < (hist[0].loss as number) * 0.8;
    const signals = [gap > 0.1, rising && trainLossFalling].filter(Boolean).length;
    const trS = share1(session.train_label_counts);
    const vaS = share1(v?.label_counts) ?? share1(session.val_label_counts);
    const shifted = trS != null && vaS != null && Math.abs(trS - vaS) > 0.1;
    if (signals > 0) {
      out.push({
        id: "overfit",
        severity: signals === 2 ? "problem" : "warning",
        evidence: signals === 2 && !shifted ? "strong" : "plausible",
        title: "Overfitting",
        detail:
          signals === 2
            ? `Training accuracy exceeds validation accuracy by ${fmtPct(gap, 1)} at the saved epoch, and validation loss rose ${fmtPct(lastVl! / minVl! - 1, 0)} above its minimum while training loss kept falling.`
            : gap > 0.1
              ? `Training accuracy exceeds validation accuracy by ${fmtPct(gap, 1)} at the saved epoch.`
              : `Validation loss rose ${fmtPct(lastVl! / minVl! - 1, 0)} above its minimum while training loss kept falling.`,
        why: `The network is memorising patterns specific to the training charts. The saved epoch limits the damage, but the model's capacity is larger than the data supports.${
          shifted ? ` Part of the gap comes from the label mix changing between training (${p1(trS)} label 1) and validation (${p1(vaS)}), so the evidence is weaker.` : ""
        }`,
        measured: [
          { label: "Train / val accuracy", value: `${p1(saved.accuracy)} / ${p1(saved.val_accuracy)}` },
          { label: "Train / val loss", value: `${f3(saved.loss)} / ${f3(saved.val_loss)}` },
          ...(minVl != null && lastVl != null ? [{ label: "Val loss min → last", value: `${f3(minVl)} → ${f3(lastVl)}` }] : []),
        ],
        experiment: "Train the same dataset with stronger regularization and with a smaller or global-average-pooling network; keep the split and seed fixed and compare validation loss.",
        action: improve("regularize", "Compare regularized and smaller variants"),
      });
    } else if (gap < 0.02) {
      out.push({
        id: "overfit",
        severity: "ok",
        title: "No sign of overfitting",
        detail: `Training and validation accuracy are within ${fmtPct(Math.abs(gap), 1)} at the saved epoch.`,
      });
    }
    const base = num(v?.baseline?.accuracy);
    if (base != null && (saved.accuracy as number) < base + 0.02) {
      out.push({
        id: "underfit",
        severity: "problem",
        evidence: (saved.val_accuracy as number) < base + 0.02 ? "strong" : "plausible",
        title: "Underfitting: the model barely fits its training data",
        detail: `Training accuracy ${p1(saved.accuracy)} is within 2 points of always predicting the majority label (${p1(base)}).`,
        why: "If the network cannot separate the training charts, the labels may not be predictable from the images, or optimisation failed (learning rate, too few epochs).",
        measured: [
          { label: "Training accuracy", value: p1(saved.accuracy) },
          { label: "Majority baseline", value: p1(base) },
        ],
        experiment: "Try a different learning rate and more epochs. If training accuracy still stays at the baseline, revisit the labels in the Labeling Optimizer.",
        action: improve("lr", "Compare learning rates"),
      });
    }
  }

  // Early stopping behaviour.
  const configured = session.summary?.epochs_configured ?? session.epochs_total ?? null;
  const trained = session.summary?.epochs_trained ?? session.epochs_completed;
  const best = session.best_epoch ?? savedEpoch;
  if (best != null && trained > 0) {
    if (configured != null && trained >= configured && best >= trained) {
      out.push({
        id: "early-stop",
        severity: "warning",
        evidence: "plausible",
        title: "Still improving when training ended",
        detail: `The best epoch was the last one (${best} of ${configured}); early stopping never triggered.`,
        why: "More epochs may improve the validation metric further.",
        experiment: "Re-run with more epochs and keep early stopping on, so training stops by itself.",
        action: improve("epochs", "Train longer"),
      });
    } else if (best <= 2 && trained >= best + 3) {
      out.push({
        id: "early-stop",
        severity: "warning",
        evidence: "plausible",
        title: `Best validation result came at epoch ${best}`,
        detail: `Training continued for ${trained - best} more epochs without improving the selection metric.`,
        why: "The network fits the training data quickly and then stops generalising. A high learning rate or too much capacity are the usual causes.",
        experiment: "Compare a lower learning rate and stronger regularization on the same split.",
        action: improve("lr", "Compare learning rates"),
      });
    } else {
      out.push({
        id: "early-stop",
        severity: "ok",
        title: `Saved epoch ${best} of ${trained} trained`,
        detail: session.stopping?.reason === "early_stopping" ? "Early stopping ended training after the selection metric stopped improving." : "Training ran its configured epochs.",
      });
    }
  }

  if (evaluated && v) {
    const n1 = v.label_counts?.["1"] ?? 0;
    const n0 = v.label_counts?.["0"] ?? 0;
    const pred = v.predicted_counts ?? {};
    // Constant predictions.
    if (v.n > 0 && ((pred["0"] ?? 0) === 0 || (pred["1"] ?? 0) === 0)) {
      const only = (pred["0"] ?? 0) === 0 ? 1 : 0;
      out.push({
        id: "constant",
        severity: "problem",
        evidence: "confirmed",
        title: `Predicts only label ${only} at the 0.5 threshold`,
        detail: `All ${fmtInt(v.n)} validation charts were classified as label ${only}.`,
        why: "Accuracy then equals the share of that label; the model makes no decisions at this threshold. Ranking metrics (ROC-AUC) can still show whether its probabilities carry information.",
        measured: [
          { label: "Predicted 0 / 1", value: `${fmtInt(pred["0"] ?? 0)} / ${fmtInt(pred["1"] ?? 0)}` },
          { label: "Balanced accuracy", value: p1(num(v.balanced_accuracy)) },
        ],
        experiment: "Train with balanced class weights, and compare a lower learning rate.",
        action: improve("class_weight", "Compare balanced class weights"),
      });
    }

    // ROC-AUC / PR-AUC against baselines.
    const auc = num(v.roc_auc);
    if (auc != null) {
      const se = aucStdError(auc, n1, n0);
      const lo = se != null ? auc - 1.96 * se : null;
      const hi = se != null ? auc + 1.96 * se : null;
      const pr = num(v.pr_auc);
      const prBase = num(v.pr_auc_no_skill);
      const measured = [
        { label: "ROC-AUC", value: `${f3(auc)}${lo != null ? ` (95% CI ${f3(lo)}–${f3(hi)})` : ""}` },
        ...(pr != null ? [{ label: "PR-AUC vs no-skill", value: `${f3(pr)} vs ${f3(prBase)}` }] : []),
        { label: "Validation charts", value: `${fmtInt(n0)} label 0 · ${fmtInt(n1)} label 1` },
      ];
      if (hi != null && hi < 0.5) {
        out.push({
          id: "auc",
          severity: "problem",
          evidence: "confirmed",
          title: "Ranking is worse than chance on validation",
          detail: `ROC-AUC ${f3(auc)} with a 95% interval entirely below 0.5.`,
          why: "Probabilities are inversely related to the outcome on the later period: what the model learned does not carry over in time.",
          measured,
          experiment: "Check the label mix shift between training and validation, and compare a run on a longer training period.",
        });
      } else if (lo == null || lo <= 0.5) {
        out.push({
          id: "auc",
          severity: "warning",
          evidence: "inconclusive",
          title: "No demonstrated ranking skill",
          detail: `ROC-AUC ${f3(auc)}; the 95% interval includes 0.5 (no ranking).`,
          why: "On this validation set the model's probabilities cannot be distinguished from random scores. More validation data or a different model is needed to say more.",
          measured,
          experiment: "Compare architectures on the same split; if none clears 0.5 reliably, the labels may not be predictable from the charts.",
          action: improve("gap", "Compare architectures"),
        });
      } else {
        out.push({
          id: "auc",
          severity: "ok",
          title: `Ranking skill above chance: ROC-AUC ${f3(auc)}`,
          detail: `The 95% interval (${f3(lo)}–${f3(hi)}) excludes 0.5.${pr != null && prBase != null ? ` PR-AUC ${f3(pr)} against ${f3(prBase)} for no skill.` : ""}`,
          measured,
        });
      }
    }

    // Per-class precision and recall.
    const r = classRecalls(v);
    if (r.r0 != null && r.r1 != null && Math.abs(r.r0 - r.r1) > 0.5) {
      const favoured = r.r0 > r.r1 ? 0 : 1;
      out.push({
        id: "per-class",
        severity: "warning",
        evidence: "confirmed",
        title: `Biased towards label ${favoured}`,
        detail: `Recall is ${p1(r.r0)} for label 0 and ${p1(r.r1)} for label 1.`,
        why: "The model mostly finds one class. Overall accuracy hides this; a trading rule built on label 1 would see few or unreliable signals.",
        measured: [
          { label: "Recall 0 / 1", value: `${p1(r.r0)} / ${p1(r.r1)}` },
          { label: "Precision 0 / 1", value: `${p1(r.p0)} / ${p1(r.p1)}` },
        ],
        experiment: "Train with balanced class weights and compare per-class recall on the same split.",
        action: improve("class_weight", "Compare balanced class weights"),
      });
    }

    // Calibration and Brier score.
    const brier = num(v.brier);
    const brierBase = num(v.baseline?.brier);
    const meanP = num(v.mean_probability);
    const valShare = share1(v.label_counts) ?? share1(session.val_label_counts);
    if (brier != null && brierBase != null) {
      const worse = brier >= brierBase;
      const shift = meanP != null && valShare != null ? meanP - valShare : null;
      out.push({
        id: "calibration",
        severity: worse ? "warning" : shift != null && Math.abs(shift) > 0.1 ? "warning" : "ok",
        evidence: worse ? "confirmed" : shift != null && Math.abs(shift) > 0.1 ? "strong" : undefined,
        title: worse ? "Probabilities are no better than the base rate" : shift != null && Math.abs(shift) > 0.1 ? "Probabilities are miscalibrated" : "Probabilities beat the base rate",
        detail: `Brier score ${f3(brier)} against ${f3(brierBase)} for predicting the training label share.${
          shift != null ? ` Mean predicted probability ${p1(meanP)} versus ${p1(valShare)} actual label 1.` : ""
        }`,
        why: worse
          ? "A constant probability would score as well. Confidence thresholds in the Backtester would select charts without information."
          : "Backtest confidence thresholds read these probabilities literally; a systematic offset moves how many trades a threshold allows.",
        measured: [
          { label: "Brier (model / base rate)", value: `${f3(brier)} / ${f3(brierBase)}` },
          { label: "Log loss (model / base rate)", value: `${f3(num(v.log_loss))} / ${f3(num(v.baseline?.log_loss))}` },
        ],
      });
    }

    // Label mix shift between training and validation.
    const trShare = share1(session.train_label_counts);
    if (trShare != null && valShare != null && Math.abs(trShare - valShare) > 0.1) {
      out.push({
        id: "prior-shift",
        severity: "info",
        evidence: "confirmed",
        title: "Label mix shifts between training and validation",
        detail: `Label 1 is ${p1(trShare)} of training charts and ${p1(valShare)} of validation charts.`,
        why: "The later period has a different outcome mix. Accuracy and calibration move with it even if the model is unchanged; compare against the baselines rather than raw accuracy.",
      });
    }

    if (v.n > 0 && v.n < 300) {
      out.push({
        id: "val-size",
        severity: "warning",
        evidence: "confirmed",
        title: `Small validation set: ${fmtInt(v.n)} charts`,
        detail: `Accuracy is precise to about ±${fmtPct(1.96 * Math.sqrt(0.25 / v.n), 1)} (95%).`,
        why: "Differences between models smaller than this are noise.",
      });
    }
  }

  // Class imbalance in training.
  const trShare = share1(session.train_label_counts);
  const weighting = (session.options?.class_weighting as string | undefined) ?? "none";
  if (trShare != null && (trShare < 0.4 || trShare > 0.6) && weighting !== "balanced") {
    out.push({
      id: "imbalance",
      severity: "warning",
      evidence: "confirmed",
      title: `Imbalanced training set: ${p1(trShare)} label 1`,
      detail: "The training loss weighs both labels by their frequency.",
      why: "The model is pulled towards the majority label; per-class recall shows how much.",
      experiment: "Compare balanced class weights on the same split.",
      action: improve("class_weight", "Compare balanced class weights"),
    });
  }

  // Parameter count and distribution.
  const layers = session.architecture?.layers ?? null;
  const total = num(session.architecture?.total_params) ?? num(session.model?.parameters);
  const trainN = num(session.train_samples);
  if (total != null && layers?.length) {
    const top = [...layers].sort((a, b) => b.params - a.params)[0];
    const topShare = total > 0 ? top.params / total : 0;
    const perSample = trainN ? total / trainN : null;
    const heavy = topShare > 0.6 && /dense/i.test(`${top.type ?? ""} ${top.name}`);
    if (heavy || (perSample != null && perSample > 200)) {
      out.push({
        id: "params",
        severity: "warning",
        evidence: "plausible",
        title: heavy ? `${fmtPct(topShare, 0)} of parameters sit in one dense layer` : "Many parameters per training chart",
        detail: `${fmtInt(total)} parameters${trainN ? ` for ${fmtInt(trainN)} training charts (${fmtInt(perSample!)} per chart)` : ""}. Largest layer: ${top.name} with ${fmtInt(top.params)}.`,
        why: "A large dense layer after flattening can memorise pixel positions. This raises overfitting risk; it is not a problem by itself if validation results hold.",
        measured: layers
          .filter((l) => l.params > 0)
          .sort((a, b) => b.params - a.params)
          .slice(0, 4)
          .map((l) => ({ label: l.name, value: `${fmtInt(l.params)} (${fmtPct(l.params / total, 0)})` })),
        experiment: "Compare a global-average-pooling network and a reduced dense layer on the same split.",
        action: improve(heavy ? "gap" : "smaller", heavy ? "Compare a GAP network" : "Compare a smaller network"),
      });
    } else {
      out.push({
        id: "params",
        severity: "ok",
        title: `${fmtInt(total)} parameters`,
        detail: `Largest layer ${top.name} holds ${fmtPct(topShare, 0)}.`,
      });
    }
  }

  out.push({
    id: "channels",
    severity: "info",
    evidence: "inconclusive",
    title: "Inactive channels are measured in Analysis",
    detail: "Training records do not include activations. The Analysis lab measures which convolution channels never activate on your charts.",
    action: { label: "Run the channel check in Analysis", to: `/tools/analysis?model=${encodeURIComponent(`trained:${runId}`)}&tab=diagnostics` },
  });

  return sortFindings(out);
}
