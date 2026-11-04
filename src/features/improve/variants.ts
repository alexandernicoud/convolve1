/**
 * Improve Model: controlled variants of a finished trainer run.
 *
 * The baseline request is rebuilt from the run's recorded session (dataset, image size, batch,
 * epochs, validation share and method, seed, architecture and resolved Trainer 2.0 options). Each
 * variant changes one factor (or one named bundle) and keeps everything else identical, so a
 * difference in validation metrics can be attributed to that change, up to seed noise; the "seed"
 * variant measures that noise.
 */
import type { TrainerRunRequest, TrainingSession } from "@/lib/api";

export type VariantKey =
  | "seed"
  | "smaller"
  | "gap"
  | "dense"
  | "regularize"
  | "dropout"
  | "l2"
  | "lr_down"
  | "lr_up"
  | "class_weight"
  | "epochs";

/** Backend preset id recorded with the experiment (app/services/experiments.py PRESETS). */
const PRESET: Record<VariantKey, string> = {
  seed: "seed",
  smaller: "smaller",
  gap: "gap",
  dense: "dense",
  regularize: "regularize",
  dropout: "dropout",
  l2: "l2",
  lr_down: "lr",
  lr_up: "lr",
  class_weight: "class_weight",
  epochs: "epochs",
};

/** Which variants a link's `preset` parameter preselects. */
export const PRESET_SELECTS: Record<string, VariantKey[]> = {
  smaller: ["seed", "smaller", "gap"],
  gap: ["seed", "gap", "smaller"],
  dense: ["seed", "dense", "smaller"],
  regularize: ["seed", "regularize", "smaller", "gap"],
  dropout: ["seed", "dropout", "regularize"],
  l2: ["seed", "l2", "regularize"],
  lr: ["seed", "lr_down", "lr_up"],
  class_weight: ["seed", "class_weight"],
  epochs: ["seed", "epochs"],
};

export const VARIANT_COPY: Record<VariantKey, { label: string; hypothesis: string }> = {
  seed: {
    label: "Same settings, different seed",
    hypothesis: "Measures run-to-run noise. A variant only beats the baseline if it beats this replicate too.",
  },
  smaller: {
    label: "Smaller CNN (Compact)",
    hypothesis: "If the model memorizes training charts, a network with far fewer parameters should narrow the train–validation gap.",
  },
  gap: {
    label: "GAP CNN (experimental)",
    hypothesis: "Global average pooling removes the large dense layer and adds batch normalization and dropout; tests whether a heavily regularized design generalizes better. It also discards horizontal position.",
  },
  dense: {
    label: "Reduced dense layer (v1 with 32 units)",
    hypothesis: "Most of v1's parameters sit in the dense layer after Flatten. Shrinking only that layer tests whether it is the source of overfitting.",
  },
  regularize: {
    label: "Stronger regularization (dropout + L2)",
    hypothesis: "Penalizing large weights and dropping units should reduce overfitting if the network fits noise.",
  },
  dropout: {
    label: "More dropout",
    hypothesis: "Isolates the effect of dropout before the output layer.",
  },
  l2: {
    label: "L2 weight penalty",
    hypothesis: "Isolates the effect of an L2 penalty on all weights.",
  },
  lr_down: {
    label: "Lower learning rate (÷3)",
    hypothesis: "If validation loss is noisy or rises early, smaller steps can find a better minimum.",
  },
  lr_up: {
    label: "Higher learning rate (×3)",
    hypothesis: "If training loss falls slowly and both losses stay high, larger steps can escape a poor start.",
  },
  class_weight: {
    label: "Balanced class weights",
    hypothesis: "If the model favours the majority label, weighting the loss makes both labels count equally.",
  },
  epochs: {
    label: "Train longer (2× epochs)",
    hypothesis: "If the run hit its epoch limit while validation still improved, more epochs may help. Costs more credits.",
  },
};

export const ORDER: VariantKey[] = ["seed", "smaller", "gap", "dense", "regularize", "dropout", "l2", "lr_down", "lr_up", "class_weight", "epochs"];

const COMPACT = "convolve-cnn-compact-v1";
const GAP = "convolve-cnn-gap-v1";
const V1 = "convolve-cnn-v1";
const DENSE32 = "convolve-cnn-dense32-v1";

export interface Baseline {
  request: TrainerRunRequest;
  /** Pricing inputs (same keys as the Trainer page). */
  pricing: Record<string, unknown>;
  /** Why the baseline cannot be reproduced; empty when it can. */
  problems: string[];
  /** Differences between the original run and any rerun under today's trainer. */
  notes: string[];
}

const round = (x: number) => Number(x.toPrecision(3));

export function baselineFromSession(session: TrainingSession, fallbackName = "model.keras"): Baseline {
  const problems: string[] = [];
  const notes: string[] = [];
  const c = session.config ?? ({} as TrainingSession["config"]);
  const o = session.options ?? null;
  const datasetId = session.dataset?.id;
  if (!datasetId) problems.push("This model was trained from a local folder without a dataset id, so its data cannot be selected again.");
  if (session.stage !== "completed") problems.push("The run has not completed.");
  const [h, w] = c.image_size ?? [224, 224];
  const request: TrainerRunRequest = {
    use_standard_config: false,
    dataset_id: datasetId,
    generator_run_id: session.dataset?.generator_run_id,
    model_name: session.model_name || fallbackName,
    image_height: h,
    image_width: w,
    batch_size: c.batch_size ?? 16,
    epochs: c.epochs ?? 30,
    val_split: c.val_split ?? 0.2,
    random_seed: c.random_seed ?? 7,
  };
  if (c.architecture && c.architecture !== V1) request.architecture = c.architecture;
  if ((session.trainer_protocol ?? c.trainer_protocol ?? 1) < 2) {
    notes.push(
      "The original model was trained with the earlier trainer (random validation split, no purging). Reruns use the current trainer with a chronological, purged validation split, so compare variants with the new-seed replicate, not with the original numbers.",
    );
  }
  if (o) {
    if (o.validation_method) request.validation_method = o.validation_method;
    if (o.optimizer) request.optimizer = { ...o.optimizer };
    if (o.lr_schedule && o.lr_schedule.name !== "constant") request.lr_schedule = { ...o.lr_schedule };
    const reg = o.regularization;
    if (reg && (reg.dropout != null || (reg.l2 ?? 0) > 0)) {
      request.regularization = { ...(reg.dropout != null ? { dropout: reg.dropout } : {}), ...((reg.l2 ?? 0) > 0 ? { l2: reg.l2 } : {}) };
    }
    if (o.early_stopping) request.early_stopping = { ...o.early_stopping };
    if (o.selection_metric) request.selection_metric = o.selection_metric;
    if (o.class_weighting && o.class_weighting !== "none") request.class_weighting = o.class_weighting as "balanced";
    if (o.augmentation?.length) request.augmentation = [...o.augmentation];
    if (o.transfer && o.transfer.mode !== "scratch") request.transfer = { ...o.transfer };
    if ((o.test_fraction ?? 0) > 0) {
      request.test_fraction = o.test_fraction;
      if (o.evaluate_test) request.evaluate_test = true;
    }
    if (o.purge_chart_windows === false) request.purge_chart_windows = false;
    if ((o.embargo_bars ?? 0) > 0) request.embargo_bars = o.embargo_bars;
  } else if (c.validation_method) {
    request.validation_method = c.validation_method;
  }
  if (c.label_horizon_source === "user" && c.label_horizon_bars != null) {
    request.label_horizon_bars = c.label_horizon_bars;
    request.label_timeframe = (c.label_timeframe as TrainerRunRequest["label_timeframe"]) ?? "1d";
  }
  return { request, pricing: pricingFor(request, session.dataset?.image_count ?? null), problems, notes };
}

export function pricingFor(r: TrainerRunRequest, datasetImages: number | null): Record<string, unknown> {
  return {
    use_standard_config: false,
    image_height: r.image_height,
    image_width: r.image_width,
    epochs: r.epochs,
    val_split: r.val_split,
    dataset_images: datasetImages,
  };
}

export interface Variant {
  key: VariantKey;
  preset: string;
  replicate: number;
  request: TrainerRunRequest;
  changed: string[];
  available: boolean;
  reason?: string;
  note?: string;
}

const archOf = (r: TrainerRunRequest) => r.architecture ?? V1;

function withName(r: TrainerRunRequest, key: VariantKey, replicate: number): TrainerRunRequest {
  const stem = (r.model_name || "model.keras").replace(/\.keras$/i, "").slice(0, 60);
  return { ...r, model_name: `${stem}-${key.replace("_", "-")}${replicate > 0 ? `-r${replicate + 1}` : ""}.keras` };
}

/**
 * ``replicate`` repeats a variant with another seed: 0 is the first run, 1 the second, and so on.
 * For "seed" every replicate is another run of the original settings (seed + 1 + replicate); for the
 * other variants replicate n > 0 adds n to the original seed. Repeats are what turn a single
 * difference into evidence: a verdict needs the run-to-run spread.
 */
export function buildVariant(
  key: VariantKey,
  base: TrainerRunRequest,
  archLabel: (id: string) => string = (id) => id,
  replicate = 0,
): Variant {
  const r: TrainerRunRequest = structuredClone(base);
  let available = true;
  let reason: string | undefined;
  let note: string | undefined;
  const reg = { dropout: base.regularization?.dropout ?? null, l2: base.regularization?.l2 ?? 0 };
  const adamwDecay = base.optimizer?.name === "adamw" && (base.optimizer.weight_decay ?? 0) > 0;
  const setReg = (dropout: number | null, l2: number) => {
    if (dropout == null && !(l2 > 0)) delete r.regularization;
    else r.regularization = { ...(dropout != null ? { dropout } : {}), ...(l2 > 0 ? { l2 } : {}) };
  };
  switch (key) {
    case "seed":
      r.random_seed = (base.random_seed ?? 7) + 1 + replicate;
      break;
    case "smaller":
      if (archOf(base) === COMPACT) [available, reason] = [false, "The model already uses the Compact network."];
      else r.architecture = COMPACT;
      break;
    case "gap":
      if (archOf(base) === GAP) [available, reason] = [false, "The model already uses the GAP network."];
      else {
        r.architecture = GAP;
        if (base.transfer) delete r.transfer;
        if (reg.dropout == null) note = "Uses the GAP network's own dropout of 0.3.";
      }
      break;
    case "dense":
      if (archOf(base) !== V1) [available, reason] = [false, "Defined for the original v1 network only; for other networks compare the Compact network."];
      else r.architecture = DENSE32;
      break;
    case "regularize": {
      const dropout = reg.dropout == null || reg.dropout < 0.3 ? 0.3 : Math.min(0.6, round(reg.dropout + 0.2));
      const l2 = adamwDecay ? 0 : reg.l2 > 0 ? Math.min(0.01, round(reg.l2 * 10)) : 1e-4;
      setReg(dropout, l2);
      if (adamwDecay) note = "AdamW weight decay already shrinks the weights, so only dropout is raised.";
      break;
    }
    case "dropout":
      if (reg.dropout != null && reg.dropout >= 0.5) [available, reason] = [false, `Dropout is already ${reg.dropout}.`];
      else setReg(0.5, reg.l2);
      break;
    case "l2":
      if (adamwDecay) [available, reason] = [false, "AdamW weight decay and an L2 penalty both shrink the weights; the trainer accepts only one."];
      else setReg(reg.dropout, reg.l2 > 0 ? Math.min(0.01, round(reg.l2 * 10)) : 1e-4);
      break;
    case "lr_down":
    case "lr_up": {
      const opt = base.optimizer ?? { name: "adam" as const, learning_rate: 1e-3 };
      const lr = opt.learning_rate ?? (opt.name === "sgd" ? 1e-2 : 1e-3);
      const next = round(key === "lr_down" ? lr / 3 : lr * 3);
      if (next < 1e-6 || next > 1) [available, reason] = [false, "The learning rate would leave the allowed range."];
      else r.optimizer = { ...opt, learning_rate: next };
      break;
    }
    case "class_weight":
      if (base.class_weighting === "balanced") [available, reason] = [false, "Class weights are already balanced."];
      else r.class_weighting = "balanced";
      break;
    case "epochs":
      r.epochs = Math.min(200, (base.epochs ?? 30) * 2);
      if (r.epochs === base.epochs) [available, reason] = [false, "Already at the maximum number of epochs."];
      break;
  }
  if (key !== "seed" && replicate > 0) r.random_seed = (base.random_seed ?? 7) + replicate;
  return {
    key,
    preset: PRESET[key],
    replicate,
    request: withName(r, key, replicate),
    changed: available ? describeChanges(base, r, archLabel) : [],
    available,
    reason,
    note,
  };
}

const fmt = (v: unknown) => (v == null ? "none" : String(v));

/** One line per setting that differs between two requests (model name excluded). */
export function describeChanges(a: TrainerRunRequest, b: TrainerRunRequest, archLabel: (id: string) => string = (id) => id): string[] {
  const out: string[] = [];
  if (archOf(a) !== archOf(b)) out.push(`Architecture: ${archLabel(archOf(a))} → ${archLabel(archOf(b))}`);
  if (a.random_seed !== b.random_seed) out.push(`Seed: ${fmt(a.random_seed)} → ${fmt(b.random_seed)}`);
  if (a.epochs !== b.epochs) out.push(`Max epochs: ${fmt(a.epochs)} → ${fmt(b.epochs)}`);
  const da = a.regularization?.dropout ?? null, db = b.regularization?.dropout ?? null;
  if (da !== db) out.push(`Dropout: ${da == null ? "architecture default" : da} → ${db == null ? "architecture default" : db}`);
  const la = a.regularization?.l2 ?? 0, lb = b.regularization?.l2 ?? 0;
  if (la !== lb) out.push(`L2 penalty: ${la} → ${lb}`);
  const ra = a.optimizer?.learning_rate ?? null, rb = b.optimizer?.learning_rate ?? null;
  if (ra !== rb) out.push(`Learning rate: ${ra ?? "default"} → ${rb ?? "default"}`);
  if ((a.class_weighting ?? "none") !== (b.class_weighting ?? "none")) out.push(`Class weights: ${a.class_weighting ?? "none"} → ${b.class_weighting ?? "none"}`);
  if (!!a.transfer !== !!b.transfer) out.push(`Pretrained weights: ${a.transfer ? a.transfer.mode : "none"} → ${b.transfer ? b.transfer.mode : "none"}`);
  return out;
}

/** Every experiment branches from the session's original model and names it as the anchor. */
export function experimentPayload(v: Variant, anchorRunId: string, origin: string | null): NonNullable<TrainerRunRequest["experiment"]> {
  return {
    parent_run_id: anchorRunId,
    anchor_run_id: anchorRunId,
    variant_key: v.key,
    replicate: v.replicate,
    preset: v.preset,
    origin,
    changed: v.changed,
  };
}

/** Next unused replicate index for a variant, given the variant keys/replicates already launched. */
export function nextReplicate(key: VariantKey, launched: { variant_key?: string | null; replicate?: number | null; is_replicate?: boolean }[]): number {
  const used = launched
    .filter((e) => e.variant_key === key || (key === "seed" && !e.variant_key && e.is_replicate))
    .map((e) => e.replicate ?? 0);
  return used.length ? Math.max(...used) + 1 : 0;
}

/** Validation numbers compared side by side. Missing values stay null. */
export interface ComparisonRow {
  auc: number | null;
  balancedAccuracy: number | null;
  logLoss: number | null;
  trainValGap: number | null;
  savedEpoch: number | null;
  epochsRun: number;
  params: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function comparisonRow(s: TrainingSession): ComparisonRow {
  const v = s.evaluation?.validation;
  const saved = s.summary?.saved_weights_epoch ?? s.best_epoch ?? null;
  const row = saved != null ? s.history.find((x) => x.epoch === saved) : s.history.at(-1);
  const gap = row && num(row.accuracy) != null && num(row.val_accuracy) != null ? (row.accuracy as number) - (row.val_accuracy as number) : null;
  return {
    auc: num(v?.roc_auc),
    balancedAccuracy: num(v?.balanced_accuracy),
    logLoss: num(v?.log_loss),
    trainValGap: gap,
    savedEpoch: saved,
    epochsRun: s.epochs_completed ?? s.history.length,
    params: num(s.model?.parameters) ?? num(s.architecture?.total_params),
  };
}

/** How evaluation results of a run may be used, given its experiment record. */
export function selectionStatus(s: Pick<TrainingSession, "experiment">): { id: "original" | "validation_only" | "test_results"; label: string; detail: string } {
  const e = s.experiment;
  if (!e) return { id: "original", label: "Original model", detail: "Not created with Improve; no selection history is recorded." };
  if (e.selection === "test_results") {
    const spans = e.selection_history
      .filter((h) => h.kind === "backtest")
      .map((h) => `${h.first_decision ?? "?"} to ${h.last_decision ?? "?"}`)
      .join("; ");
    return {
      id: "test_results",
      label: "Designed after inspecting test results",
      detail: `Backtests on overlapping dates (${spans || "unknown dates"}) are research evaluation, not independent confirmation. Confirm on a later period.`,
    };
  }
  return { id: "validation_only", label: "Selected on validation data", detail: "Created from validation results only; a backtest on a new test period can still be independent." };
}
