import type { TrainingSession } from "@/lib/api";

/**
 * Counts derived from a training session: only from recorded configuration, completed epochs and the
 * latest batch report. Anything that cannot be derived exactly is null, never guessed.
 */
export interface RunCompute {
  epochsDone: number;
  /** Batches per epoch: the trainer's own count when reported, else ceil(train / batch). */
  stepsPerEpoch: number | null;
  /** Training images passed through the network; an image counts once per epoch. */
  imagesProcessed: number | null;
  /** Gradient steps taken by the optimizer (one per batch). */
  optimizerSteps: number | null;
  /** Total parameters in the network. */
  parameters: number | null;
  /** Parameters the optimizer adjusts (frozen transfer layers excluded). */
  trainableParameters: number | null;
  /** optimizerSteps × trainableParameters: individual weight values rewritten so far. */
  parameterUpdates: number | null;
  /** FLOPs for one image, forward only (2 per multiply-add). */
  forwardFlops: number | null;
  forwardFlopsSource: "measured" | "layer table" | null;
  /** Rough training cost: forward + backward ≈ 3 × forward, per training image processed. Validation excluded. */
  trainingFlopsEstimate: number | null;
  inputShape: [number, number, number] | null;
  learningRate: { value: number; source: string } | null;
  /** True when the in-epoch counts come from a live batch report (which arrives every few seconds). */
  includesLiveBatch: boolean;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Multiply-adds of one forward pass, from a sequential layer table (Conv2D / Dense rows with output shapes). */
export function layerTableMacs(layers: { name: string; shape: number[] | null; params: number }[] | null | undefined): number | null {
  if (!layers?.length) return null;
  let macs = 0;
  let counted = 0;
  for (const l of layers) {
    const shape = l.shape ?? [];
    if (/^Conv2D/i.test(l.name) && shape.length === 3) {
      const [h, w, filters] = shape;
      macs += h * w * (l.params - filters);
      counted += 1;
    } else if (/^Dense/i.test(l.name) && shape.length === 1) {
      macs += l.params - shape[0];
      counted += 1;
    }
  }
  return counted ? macs : null;
}

export function runCompute(session: TrainingSession | null | undefined): RunCompute {
  const done = session?.epochs_completed ?? session?.history?.length ?? 0;
  const train = finite(session?.train_samples) ? session!.train_samples! : null;
  const batch = finite(session?.config?.batch_size) ? session!.config.batch_size! : null;
  const live = session?.stage === "training" ? session?.live_epoch : null;
  const liveBatches = finite(live?.batches) && live!.batches! > 0 ? live!.batches! : null;
  const stepsPerEpoch = liveBatches ?? (train && batch ? Math.ceil(train / batch) : null);

  const inLiveEpoch = !!live && finite(live.batch) && live.epoch_in_progress === done + 1;
  const liveSteps = inLiveEpoch ? live!.batch! : 0;
  const liveImages = inLiveEpoch && batch && train ? Math.min(live!.batch! * batch, train) : 0;

  const imagesProcessed = train != null && (!inLiveEpoch || batch) ? done * train + liveImages : null;
  const optimizerSteps = stepsPerEpoch != null ? done * stepsPerEpoch + liveSteps : null;

  const arch = session?.architecture ?? null;
  const sequential = !!arch?.layers?.length && !arch?.stages;
  const transfer = session?.options?.transfer?.mode;
  const parameters = finite(session?.model?.parameters) ? session!.model!.parameters! : finite(arch?.total_params) ? arch!.total_params! : null;
  const trainableParameters = finite(session?.model?.trainable_parameters)
    ? session!.model!.trainable_parameters!
    : sequential && (!transfer || transfer === "scratch") && finite(arch?.total_params)
      ? arch!.total_params!
      : null;

  const measured = finite(session?.model?.forward_gflops) ? session!.model!.forward_gflops! * 1e9 : null;
  const tableMacs = sequential ? layerTableMacs(arch!.layers) : null;
  const forwardFlops = measured ?? (tableMacs != null ? 2 * tableMacs : null);

  const size = session?.config?.image_size;
  const inputShape: [number, number, number] | null = size && size.length === 2 && size.every(finite) ? [size[0], size[1], 3] : null;

  const last = session?.history?.length ? session.history[session.history.length - 1] : null;
  const configured = session?.options?.optimizer?.learning_rate;
  const learningRate = finite(last?.learning_rate)
    ? { value: last!.learning_rate!, source: `epoch ${last!.epoch}` }
    : finite(configured)
      ? { value: configured, source: "configured" }
      : (session?.trainer_protocol ?? session?.config?.trainer_protocol ?? 1) < 2 && arch
        ? { value: 1e-3, source: "Keras Adam default" }
        : null;

  return {
    epochsDone: done,
    stepsPerEpoch,
    imagesProcessed,
    optimizerSteps,
    parameters,
    trainableParameters,
    parameterUpdates: optimizerSteps != null && trainableParameters != null ? optimizerSteps * trainableParameters : null,
    forwardFlops,
    forwardFlopsSource: measured != null ? "measured" : tableMacs != null ? "layer table" : null,
    trainingFlopsEstimate: forwardFlops != null && imagesProcessed != null ? 3 * forwardFlops * imagesProcessed : null,
    inputShape,
    learningRate,
    includesLiveBatch: inLiveEpoch,
  };
}

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** Scientific notation with superscript exponent, e.g. 1.6 × 10¹⁰; plain digits below 10⁶ (and for small magnitudes above 10⁻³). */
export function fmtSci(v: number | null | undefined, digits = 1): string {
  if (!finite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs < 1e6 && abs >= 1e-3) return abs >= 1 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toPrecision(3)));
  const exp = Math.floor(Math.log10(abs));
  const mant = v / 10 ** exp;
  const m = mant.toFixed(digits).replace(/\.0+$/, "");
  return `${m === "1" ? "" : `${m} × `}10${String(exp).split("").map((c) => SUP[c] ?? c).join("")}`;
}
