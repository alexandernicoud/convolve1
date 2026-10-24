import type { TrainerProgressResponse, TrainingSession } from "@/lib/api";

export type ApiStatus = "running" | "done" | "failed" | "cancelled" | string;

export const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

export const isTerminal = (status?: string | null) => !!status && TERMINAL_STATUSES.has(status);

/** Stages the backend can actually distinguish (see backend/app/services/trainer_session.py PHASE_STAGE). */
export const STAGE_ORDER = ["queued", "preparing", "initializing", "training", "saving", "completed"] as const;

export const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  preparing: "Preparing dataset",
  initializing: "Initializing model",
  training: "Training",
  saving: "Saving artifacts",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const STAGE_DETAIL: Record<string, string> = {
  queued: "Waiting for a training machine to pick up the run.",
  preparing: "Scanning labeled images and building the train/validation split.",
  initializing: "Building the network and compiling the optimizer.",
  training: "Fitting the model. Batch progress updates every few seconds; metrics at the end of every epoch.",
  saving: "Writing the model file, history and summary.",
  completed: "Training finished and the model was saved.",
  failed: "Training stopped with an error.",
  cancelled: "Training was cancelled.",
};

/** Session stage, falling back to the API status when the session is absent (older backends). */
export function stageOf(resp?: TrainerProgressResponse | null): string {
  if (!resp) return "preparing";
  if (resp.session?.stage) return resp.session.stage;
  if (resp.status === "done") return "completed";
  if (resp.status === "failed") return "failed";
  if (resp.status === "cancelled") return "cancelled";
  const phase = resp.progress?.phase;
  if (phase === "queued") return "queued";
  if (phase === "building") return "initializing";
  if (phase === "training") return "training";
  if (phase === "saving") return "saving";
  return "preparing";
}

/**
 * Completed-epoch progress. `total` is the configured maximum; early stopping (patience 5 on
 * val_loss) can end training before it, so this is "epochs done of at most N", never a time estimate.
 */
export function epochProgress(session?: TrainingSession | null): { done: number; total: number | null; fraction: number | null } {
  const done = session?.epochs_completed ?? session?.history?.length ?? 0;
  const total = session?.epochs_total ?? session?.config?.epochs ?? null;
  const fraction = total && total > 0 ? Math.min(1, done / total) : null;
  return { done, total, fraction };
}

/** Seconds from the server start time to finish (or `nowSec` while running). */
export function elapsedSeconds(session: TrainingSession | null | undefined, nowSec: number): number | null {
  const start = session?.started_at;
  if (!start) return null;
  const end = session?.finished_at ?? nowSec;
  return Math.max(0, end - start);
}

/**
 * Upper-bound estimate of remaining time: measured mean epoch duration × epochs left before the
 * configured maximum. Early stopping can only make the real remainder shorter.
 */
export function remainingUpperBound(session?: TrainingSession | null): number | null {
  const mean = session?.mean_epoch_seconds;
  const { done, total } = epochProgress(session);
  if (!mean || !total || done < 2 || done >= total) return null;
  return mean * (total - done);
}

export const TIMING_LABEL: Record<string, { label: string; detail: string }> = {
  waiting_for_machine: { label: "Waiting for a machine", detail: "Dispatch, container start and worker start-up" },
  dataset_download: { label: "Dataset download", detail: "Restoring the stored dataset onto the training machine" },
  framework_start: { label: "TensorFlow start-up", detail: "Loading the machine-learning framework" },
  data_preparation: { label: "Data preparation", detail: "Scanning images, train/validation split, input pipeline" },
  model_build: { label: "Model build", detail: "Creating and compiling the network" },
  first_batch: { label: "First batch", detail: "Graph compilation plus the first training step" },
  training: { label: "Training", detail: "Fitting the network on the training images" },
  validation: { label: "Validation", detail: "Scoring held-out images after every epoch" },
  model_save: { label: "Saving model", detail: "Writing the model file" },
  upload: { label: "Uploading results", detail: "Copying the model and reports to storage" },
};

/** Phase durations: one decimal under 10 s so sub-second phases do not read as "0 s". */
export function fmtPhaseSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 0.05) return "< 0.1 s";
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Measured phases with their share of the measured total, largest phase flagged. */
export function timingRows(timings?: TrainingSession["timings"]): { key: string; label: string; detail: string; seconds: number; share: number; largest: boolean }[] {
  const phases = (timings?.phases ?? []).filter((p) => Number.isFinite(p.seconds) && p.seconds >= 0);
  const total = phases.reduce((sum, p) => sum + p.seconds, 0);
  if (!phases.length || total <= 0) return [];
  const max = Math.max(...phases.map((p) => p.seconds));
  return phases.map((p) => ({
    key: p.key,
    label: TIMING_LABEL[p.key]?.label ?? p.key,
    detail: TIMING_LABEL[p.key]?.detail ?? "",
    seconds: p.seconds,
    share: p.seconds / total,
    largest: p.seconds === max,
  }));
}

/** Epochs since the best validation loss, compared with the early-stopping patience. */
export function patienceUsed(session?: TrainingSession | null): { since: number; patience: number } | null {
  const best = session?.best_epoch;
  const done = session?.epochs_completed ?? 0;
  const patience = session?.architecture?.early_stopping?.patience ?? 5;
  if (!best || !done) return null;
  return { since: Math.max(0, done - best), patience };
}

/** Polling delay: 2 s while healthy, exponential backoff on failures (max 30 s), slower when hidden. */
export function nextPollDelay(failures: number, hidden: boolean): number {
  if (failures <= 0) return hidden ? 10_000 : 2_000;
  return Math.min(30_000, 2_000 * Math.pow(2, Math.min(failures, 4)));
}

/** Map API status onto the runs store vocabulary. */
export function storeStatus(status: ApiStatus): "running" | "succeeded" | "failed" | "cancelled" | "queued" {
  if (status === "done") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

export function marketLabel(market?: TrainingSession["dataset"]["market"]): string | null {
  if (!market) return null;
  const syms = market.symbols;
  const symbols = Array.isArray(syms) ? syms.join(", ") : typeof syms === "string" ? syms : null;
  const tf = typeof market.timeframe === "string" ? market.timeframe : null;
  return [symbols, tf].filter(Boolean).join(" · ") || null;
}
