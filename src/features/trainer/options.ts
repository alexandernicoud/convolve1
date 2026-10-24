/**
 * Trainer 2.0 options on the Trainer page. The server validates every value again
 * (backend/runners/trainer_options.py); this module only builds the request, mirrors the checks
 * that are cheap to show early, and describes what each section changes and costs.
 */
import type {
  OptimizerSettings,
  ScheduleSettings,
  SelectionMetric,
  TrainerArchitecture,
  TrainerRunRequest,
  TransferMode,
  ValidationMethod,
} from "@/lib/api";

export interface AdvancedOptions {
  validation_method: ValidationMethod;
  test_fraction: number;
  evaluate_test: boolean;
  purge_chart_windows: boolean;
  embargo_bars: number;
  /** null: taken from the dataset's generator settings. */
  label_horizon_bars: number | null;
  /** Bar size the horizon is counted in; only sent together with label_horizon_bars. */
  label_timeframe: "1d" | "1wk" | "1mo";
  optimizer: OptimizerSettings;
  lr_schedule: ScheduleSettings;
  /** null: the architecture's own default. */
  dropout: number | null;
  l2: number;
  early_stopping: { enabled: boolean; patience: number; min_delta: number };
  selection_metric: SelectionMetric;
  class_weighting: "none" | "balanced";
  augmentation: string[];
  transfer: { mode: TransferMode; trainable_layers: number };
}

export const OPTIMIZER_DEFAULTS: Record<OptimizerSettings["name"], OptimizerSettings> = {
  adam: { name: "adam", learning_rate: 1e-3 },
  adamw: { name: "adamw", learning_rate: 1e-3, weight_decay: 1e-4 },
  sgd: { name: "sgd", learning_rate: 1e-2, momentum: 0.9, nesterov: true },
};

export const SCHEDULE_DEFAULTS: Record<ScheduleSettings["name"], ScheduleSettings> = {
  constant: { name: "constant" },
  reduce_on_plateau: { name: "reduce_on_plateau", factor: 0.5, patience: 2, min_learning_rate: 1e-6 },
  cosine: { name: "cosine", alpha: 0 },
  warmup_cosine: { name: "warmup_cosine", warmup_epochs: 1, alpha: 0 },
};

export const DEFAULT_OPTIONS: AdvancedOptions = {
  validation_method: "chronological",
  test_fraction: 0,
  evaluate_test: false,
  purge_chart_windows: true,
  embargo_bars: 0,
  label_horizon_bars: null,
  label_timeframe: "1d",
  optimizer: OPTIMIZER_DEFAULTS.adam,
  lr_schedule: SCHEDULE_DEFAULTS.constant,
  dropout: null,
  l2: 0,
  early_stopping: { enabled: true, patience: 5, min_delta: 0 },
  selection_metric: "val_loss",
  class_weighting: "none",
  augmentation: [],
  transfer: { mode: "scratch", trainable_layers: 20 },
};

export const SELECTION_LABEL: Record<SelectionMetric, string> = {
  val_loss: "Validation loss (lowest)",
  val_balanced_accuracy: "Validation balanced accuracy (highest)",
  val_auc: "Validation ROC-AUC (highest)",
  val_pr_auc: "Validation PR-AUC (highest)",
  val_accuracy: "Validation accuracy (highest)",
};

export const SCHEDULE_LABEL: Record<ScheduleSettings["name"], string> = {
  constant: "Constant",
  reduce_on_plateau: "Reduce on plateau",
  cosine: "Cosine decay",
  warmup_cosine: "Warmup, then cosine decay",
};

export const OPTIMIZER_LABEL: Record<OptimizerSettings["name"], string> = {
  adam: "Adam",
  adamw: "AdamW (decoupled weight decay)",
  sgd: "SGD with momentum",
};

export type SectionId =
  | "architecture"
  | "optimizer"
  | "schedule"
  | "regularization"
  | "imbalance"
  | "validation"
  | "augmentation"
  | "reproducibility"
  | "selection";

/** What a section changes, what it costs, and the trap to avoid. Shown inside each section. */
export const SECTION_COPY: Record<SectionId, { title: string; effect: string; cost: string }> = {
  architecture: {
    title: "Architecture configuration",
    effect: "Dropout and an L2 penalty on the weights, and for pretrained networks how much of the network is trained.",
    cost: "No change in credits. Fine-tuning more layers trains slower than training only the new head.",
  },
  optimizer: {
    title: "Optimizer",
    effect: "How weights are updated from the gradient. Adam with learning rate 0.001 is the setting every earlier model used.",
    cost: "No change in credits or time per epoch.",
  },
  schedule: {
    title: "Learning-rate schedule",
    effect: "How the learning rate changes during training. Plateau reduction acts once per epoch; cosine schedules change it every batch.",
    cost: "No change in credits. A resumed run continues the schedule exactly where it stopped.",
  },
  regularization: {
    title: "Early stopping",
    effect: "When training stops and which epoch's weights are kept. Patience is the number of epochs without improvement of the selection metric.",
    cost: "Credits are priced on the maximum epochs; stopping early does not change the price.",
  },
  imbalance: {
    title: "Class imbalance",
    effect: "Balanced weights make both labels count equally in the training loss. Validation and test always keep their natural label mix.",
    cost: "No change in credits. Expect more label-1 predictions and different precision and recall.",
  },
  validation: {
    title: "Validation and purging",
    effect:
      "Which charts are held out and which training charts are removed because their outcome window or chart window overlaps a later period.",
    cost: "Held-out and purged charts are not trained on; the price uses the configured validation share.",
  },
  augmentation: {
    title: "Augmentation",
    effect: "Small random changes to training images only. Flips, rotations and crops are not offered because they change what the label means.",
    cost: "Slightly slower epochs; no change in credits.",
  },
  reproducibility: {
    title: "Reproducibility",
    effect:
      "The seed fixes initial weights, dropout, shuffling and augmentation. With the same data, settings, seed and software, a run on the same hardware reproduces bit for bit.",
    cost: "Deterministic operations can be slightly slower. Different CPUs or a GPU can differ in the last decimal places.",
  },
  selection: {
    title: "Evaluation and model selection",
    effect:
      "The validation metric that picks the saved epoch and drives early stopping. Different metrics can pick different epochs: loss rewards calibrated probabilities, AUC rewards ranking, balanced accuracy rewards both labels at the 0.5 threshold.",
    cost: "Never the test period and never backtest profit: tuning on either would make those numbers optimistic.",
  },
};

const near = (a: number | undefined | null, b: number | undefined | null) => (a ?? NaN) === (b ?? NaN) || Math.abs((a ?? 0) - (b ?? 0)) < 1e-12;

function sameShallow(a: object, b: object): boolean {
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    return typeof x === "number" && typeof y === "number" ? near(x, y) : x === y;
  });
}

/** Sections whose settings differ from the defaults (shown as "Changed" on the section header). */
export function changedSections(o: AdvancedOptions, seed: number, defaultSeed = 7): Set<SectionId> {
  const d = DEFAULT_OPTIONS;
  const out = new Set<SectionId>();
  if (o.dropout !== d.dropout || o.l2 !== d.l2 || o.transfer.mode !== d.transfer.mode) out.add("architecture");
  if (!sameShallow(o.optimizer, OPTIMIZER_DEFAULTS[o.optimizer.name]) || o.optimizer.name !== d.optimizer.name) out.add("optimizer");
  if (o.lr_schedule.name !== d.lr_schedule.name || !sameShallow(o.lr_schedule, SCHEDULE_DEFAULTS[o.lr_schedule.name])) out.add("schedule");
  if (!sameShallow(o.early_stopping, d.early_stopping)) out.add("regularization");
  if (o.class_weighting !== d.class_weighting) out.add("imbalance");
  if (
    o.validation_method !== d.validation_method ||
    o.test_fraction !== d.test_fraction ||
    o.evaluate_test !== d.evaluate_test ||
    o.purge_chart_windows !== d.purge_chart_windows ||
    o.embargo_bars !== d.embargo_bars ||
    o.label_horizon_bars !== d.label_horizon_bars
  )
    out.add("validation");
  if (o.augmentation.length) out.add("augmentation");
  if (seed !== defaultSeed) out.add("reproducibility");
  if (o.selection_metric !== d.selection_metric) out.add("selection");
  return out;
}

/** Problems the server would reject, phrased for the form. null when the options are valid. */
export function optionsProblem(o: AdvancedOptions, arch?: TrainerArchitecture | null): string | null {
  if (o.optimizer.name === "adamw" && (o.optimizer.weight_decay ?? 0) > 0 && o.l2 > 0) {
    return "AdamW weight decay and an L2 penalty both shrink the weights; set one of them to 0.";
  }
  if (o.transfer.mode !== "scratch" && arch && !arch.supports_transfer) {
    return `${arch.label} has no pretrained weights; train it from scratch.`;
  }
  if (o.test_fraction < 0 || o.test_fraction > 0.4) return "The test share must be between 0% and 40%.";
  const lr = o.optimizer.learning_rate ?? 0;
  if (!(lr >= 1e-6 && lr <= 1)) return "The learning rate must be between 0.000001 and 1.";
  if (o.dropout != null && (o.dropout < 0 || o.dropout > 0.8)) return "Dropout must be between 0 and 0.8.";
  if (o.early_stopping.enabled && (o.early_stopping.patience < 1 || o.early_stopping.patience > 100)) {
    return "Early-stopping patience must be between 1 and 100 epochs.";
  }
  return null;
}

/**
 * Request fields for these options. Defaults are omitted, so a run with untouched settings sends
 * the same request whether or not this page knows about an option.
 */
export function optionsRequest(o: AdvancedOptions): Partial<TrainerRunRequest> {
  const d = DEFAULT_OPTIONS;
  const req: Partial<TrainerRunRequest> = {};
  if (o.validation_method !== d.validation_method) req.validation_method = o.validation_method;
  if (o.test_fraction > 0) {
    req.test_fraction = o.test_fraction;
    if (o.evaluate_test) req.evaluate_test = true;
  }
  if (!o.purge_chart_windows) req.purge_chart_windows = false;
  if (o.embargo_bars > 0) req.embargo_bars = o.embargo_bars;
  if (o.label_horizon_bars != null) {
    req.label_horizon_bars = o.label_horizon_bars;
    req.label_timeframe = o.label_timeframe;
  }
  if (o.optimizer.name !== d.optimizer.name || !sameShallow(o.optimizer, OPTIMIZER_DEFAULTS[o.optimizer.name])) {
    req.optimizer = { ...o.optimizer };
  }
  if (o.lr_schedule.name !== "constant") req.lr_schedule = { ...o.lr_schedule };
  if (o.dropout != null || o.l2 > 0) {
    req.regularization = { ...(o.dropout != null ? { dropout: o.dropout } : {}), ...(o.l2 > 0 ? { l2: o.l2 } : {}) };
  }
  if (!sameShallow(o.early_stopping, d.early_stopping)) req.early_stopping = { ...o.early_stopping };
  if (o.selection_metric !== d.selection_metric) req.selection_metric = o.selection_metric;
  if (o.class_weighting !== d.class_weighting) req.class_weighting = o.class_weighting;
  if (o.augmentation.length) req.augmentation = [...o.augmentation].sort();
  if (o.transfer.mode !== "scratch") {
    req.transfer = o.transfer.mode === "fine_tune" ? { ...o.transfer } : { mode: o.transfer.mode };
  }
  return req;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One line per non-default choice, for the pre-run review. */
export function describeOptions(o: AdvancedOptions, seed: number): string[] {
  const out: string[] = [];
  const opt = o.optimizer;
  out.push(
    `${OPTIMIZER_LABEL[opt.name]}, learning rate ${opt.learning_rate}` +
      (opt.name === "adamw" ? `, weight decay ${opt.weight_decay}` : "") +
      (opt.name === "sgd" ? `, momentum ${opt.momentum}` : "") +
      (opt.clipnorm ? `, gradients clipped at norm ${opt.clipnorm}` : ""),
  );
  out.push(`Learning rate: ${SCHEDULE_LABEL[o.lr_schedule.name].toLowerCase()}`);
  out.push(`Model selection: ${SELECTION_LABEL[o.selection_metric].toLowerCase()}`);
  out.push(
    o.early_stopping.enabled
      ? `Early stopping after ${o.early_stopping.patience} epochs without improvement${o.early_stopping.min_delta ? ` (by more than ${o.early_stopping.min_delta})` : ""}`
      : "No early stopping: every epoch runs; the best epoch is still the one kept",
  );
  if (o.dropout != null || o.l2 > 0) {
    out.push(
      [o.dropout != null ? `dropout ${o.dropout}` : null, o.l2 > 0 ? `L2 penalty ${o.l2}` : null].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase()),
    );
  }
  if (o.class_weighting === "balanced") out.push("Training loss weighted so both labels count equally");
  if (o.augmentation.length) out.push(`Augmentation: ${o.augmentation.join(", ").replace(/_/g, " ")}`);
  if (o.transfer.mode !== "scratch") {
    out.push(o.transfer.mode === "frozen" ? "ImageNet weights, frozen; only the new head trains" : `ImageNet weights; the last ${o.transfer.trainable_layers} layers are fine-tuned`);
  }
  if (o.test_fraction > 0) {
    out.push(
      `Latest ${pct(o.test_fraction)} reserved as a test period${o.evaluate_test ? ", evaluated once after training" : ", not evaluated (kept untouched)"}`,
    );
  }
  out.push(`Seed ${seed}`);
  return out;
}

export const PURGE_REASON: Record<string, string> = {
  label_window_overlaps_val: "outcome window reaches the validation period",
  label_window_overlaps_test: "outcome window reaches the test period",
  chart_window_overlaps_val: "chart window overlaps the validation period",
  chart_window_overlaps_test: "chart window overlaps the test period",
  no_date: "no dates in the file name",
};

export const METADATA_SOURCE: Record<string, string> = {
  provenance: "recorded bars per chart",
  calendar_upper_bound: "file-name dates plus the horizon (calendar upper bound)",
  dates_only: "file-name dates only (outcome window unknown)",
  undated: "no dates",
};
