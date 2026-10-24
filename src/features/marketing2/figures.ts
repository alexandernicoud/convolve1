/**
 * Computation figures for the marketing pages, derived from a recorded training run
 * (data/training.json) so that no figure is typed in by hand.
 *
 * Kinds: "measured" comes straight from the run record, "calculated" is arithmetic on measured values,
 * "estimate" uses a stated approximation.
 */
import { OPTIMIZER_DEFAULTS, SCHEDULE_DEFAULTS, SELECTION_LABEL } from "../trainer/options";

export interface ArchLayer {
  kind: string;
  out: number[];
  kernel?: number[] | null;
  params: number;
}

export interface RunRecord {
  train_samples: number;
  epochs_trained: number;
  params: number;
  arch: ArchLayer[];
}

export interface Figures {
  inputValues: number;
  params: number;
  forwardMacs: number;
  forwardFlops: number;
  stepsPerEpoch: number;
  optimizerSteps: number;
  imagePasses: number;
  weightUpdates: number;
  trainingFlopsEstimate: number;
}

/** Multiply-accumulates of one forward pass: Conv2D = out_h·out_w·filters·(k_h·k_w·in_channels), Dense = in·out. */
export function forwardMacs(arch: ArchLayer[], inputChannels = 3): number {
  let channels = inputChannels;
  let features = 0;
  let macs = 0;
  for (const l of arch) {
    const outSize = l.out.reduce((a, b) => a * b, 1);
    if (l.kind === "Conv2D") {
      const [kh, kw] = l.kernel ?? [3, 3];
      macs += outSize * kh * kw * channels;
    } else if (l.kind === "Dense") {
      macs += features * outSize;
    }
    channels = l.out[l.out.length - 1];
    features = outSize;
  }
  return macs;
}

/**
 * `batch` is the run's batch size; Keras counts the final partial batch as a step.
 * Training compute is estimated as 3 × forward FLOPs per image (forward pass plus a backward pass of about twice its cost).
 */
export function runFigures(run: RunRecord, image: [number, number, number], batch: number): Figures {
  const macs = forwardMacs(run.arch, image[2]);
  const stepsPerEpoch = Math.ceil(run.train_samples / batch);
  const optimizerSteps = stepsPerEpoch * run.epochs_trained;
  const imagePasses = run.train_samples * run.epochs_trained;
  return {
    inputValues: image[0] * image[1] * image[2],
    params: run.params,
    forwardMacs: macs,
    forwardFlops: 2 * macs,
    stepsPerEpoch,
    optimizerSteps,
    imagePasses,
    weightUpdates: optimizerSteps * run.params,
    trainingFlopsEstimate: 3 * 2 * macs * imagePasses,
  };
}

/**
 * Platform facts. Must match backend/scripts/7.2.py (Labeling Optimizer grid),
 * backend/runners/cnn_architectures.py (catalogue, params and GFLOPs measured at 224 × 224),
 * backend/runners/trainer_options.py (training choices; pinned by tests/test_trainer2_architectures.py)
 * and the Generator's image-size options.
 */
export const SYSTEM = {
  optimizer: { tpSteps: 25, slSteps: 25, horizonMin: 1, horizonMax: 200 },
  /** Optimizer run 20261022_174018_c1f6bf (INTC, daily, 2025-10-22 to 2026-10-20): bars each rule was replayed over. */
  optimizerRun: { symbol: "INTC", bars: 249 },
  trainer: {
    /** Architectures trained from scratch only, plus EfficientNet-B0 from scratch, frozen or fine-tuned on ImageNet weights. */
    networkStarts: 6 + 3,
    classWeightings: 2,
    /** Subsets of the two label-preserving augmentations (pixel noise, vertical shift). */
    augmentationSets: 2 ** 2,
  },
  architectures: [
    { id: "convolve-cnn-gap-v1", params: 394_353, gflops: 0.506 },
    { id: "convolve-efficientnet-b0-v1", params: 4_050_852, gflops: 0.769 },
    { id: "convolve-resnet18-v1", params: 11_186_625, gflops: 3.627 },
  ],
  architectureCount: 7,
  maxChartSize: 512,
} as const;

export const optimizerCells = (o = SYSTEM.optimizer) => o.tpSteps * o.slSteps * (o.horizonMax - o.horizonMin + 1);

/** Discrete Trainer setups for one dataset; continuous values (learning rate, dropout, L2, patience) are not counted. */
export function trainingSetups(): { total: number; factors: [string, number][] } {
  const factors: [string, number][] = [
    ["network starts", SYSTEM.trainer.networkStarts],
    ["optimizers", Object.keys(OPTIMIZER_DEFAULTS).length],
    ["LR schedules", Object.keys(SCHEDULE_DEFAULTS).length],
    ["selection metrics", Object.keys(SELECTION_LABEL).length],
    ["class weightings", SYSTEM.trainer.classWeightings],
    ["augmentation sets", SYSTEM.trainer.augmentationSets],
  ];
  return { total: factors.reduce((a, [, n]) => a * n, 1), factors };
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

/** 16297888 → "1.6 × 10⁷" */
export function sci(v: number, digits = 1): string {
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const mant = v / 10 ** exp;
  return `${mant.toFixed(digits)} × 10${String(exp)
    .split("")
    .map((c) => SUP[c])
    .join("")}`;
}

export const int = (v: number) => Math.round(v).toLocaleString("en-US");
