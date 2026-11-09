/**
 * The workspace's "recommended next experiment".
 *
 * Built only from recorded evidence: the original's Model Health findings, the run-to-run noise
 * estimate and the experiments already in the session. An observed problem (a finding) and the
 * hypothesis that a change may fix it are kept apart; nothing here promises an improvement.
 */
import { EVIDENCE_LABEL, type Finding } from "@/features/research/findings";
import type { ImproveExperiment, ImproveSession } from "@/lib/api";
import { PRESET_SELECTS, VARIANT_COPY, type VariantKey } from "./variants";

export type PurposeId = "overfitting" | "stability" | "imbalance" | "robustness" | "architecture";

export const PURPOSES: { id: PurposeId; title: string; blurb: string; keys: VariantKey[] }[] = [
  {
    id: "overfitting",
    title: "Reduce overfitting",
    blurb: "For models that fit their training charts much better than the validation charts.",
    keys: ["smaller", "regularize", "dropout", "l2"],
  },
  {
    id: "stability",
    title: "Improve training stability",
    blurb: "For learning curves that are noisy, peak early, stall, or were still improving when training ended.",
    keys: ["lr_down", "lr_up", "epochs"],
  },
  {
    id: "imbalance",
    title: "Handle class imbalance",
    blurb: "For models that mostly predict one label.",
    keys: ["class_weight"],
  },
  {
    id: "robustness",
    title: "Test model robustness",
    blurb: "Retrains the original settings with another random seed to measure how much results vary by chance alone.",
    keys: ["seed"],
  },
  {
    id: "architecture",
    title: "Explore architectures",
    blurb: "Swaps the network design while keeping the data, split and training settings fixed.",
    keys: ["gap", "dense"],
  },
];

/** Short action titles for the recommendation panel. */
export const ACTION_TITLE: Record<VariantKey, string> = {
  seed: "Retrain the original with another seed",
  smaller: "Test a smaller network",
  gap: "Test a global-average-pooling network",
  dense: "Test a reduced dense layer",
  regularize: "Test stronger regularization",
  dropout: "Test more dropout",
  l2: "Test an L2 weight penalty",
  lr_down: "Test a lower learning rate",
  lr_up: "Test a higher learning rate",
  class_weight: "Test balanced class weights",
  epochs: "Test training for longer",
};

/** Experiments that address each Model Health finding, most direct first. */
export function keysForFinding(f: Finding): VariantKey[] {
  switch (f.id) {
    case "overfit":
      return ["regularize", "smaller", "gap"];
    case "params":
      return /dense layer/i.test(f.title) ? ["gap", "dense", "smaller"] : ["smaller", "gap"];
    case "underfit":
      return ["lr_up", "lr_down", "epochs"];
    case "early-stop":
      return /still improving/i.test(f.title) ? ["epochs"] : ["lr_down", "regularize"];
    case "constant":
      return ["class_weight", "lr_down"];
    case "per-class":
    case "imbalance":
      return ["class_weight"];
    case "auc":
      return f.severity === "warning" ? ["gap", "smaller"] : [];
    default:
      return [];
  }
}

const EXPLORATORY: VariantKey[] = ["smaller", "regularize", "gap", "lr_down", "class_weight", "dense", "dropout", "l2", "lr_up", "epochs"];
const SEVERITY_RANK: Record<string, number> = { problem: 0, warning: 1 };
const EVIDENCE_RANK: Record<string, number> = { confirmed: 0, strong: 1, plausible: 2, inconclusive: 3 };

export type RecommendationKind = "diagnosis" | "evidence" | "exploratory" | "done";

export interface Recommendation {
  kind: RecommendationKind;
  key: VariantKey;
  /** The finding that motivates it; null when nothing was diagnosed. */
  finding: Finding | null;
  title: string;
  /** What was measured. Null for exploratory experiments. */
  observed: string | null;
  evidence: string | null;
  /** Why the change may help: a hypothesis to test, not a result. */
  hypothesis: string;
  /** Experiment the user already ran that this recommendation follows up on. */
  followsUp: ImproveExperiment | null;
  alternatives: VariantKey[];
}

export interface RecommendInput {
  findings: Finding[];
  experiments: ImproveExperiment[];
  noise: ImproveSession["noise"];
  available: (key: VariantKey) => boolean;
  /** Variants a link from Model Health asked for (``?preset=``). */
  preset?: string | null;
}

/** A variant counts as tried once a non-failed run of it exists. */
export function tried(key: VariantKey, experiments: ImproveExperiment[]): boolean {
  return experiments.some((e) => e.variant_key === key && e.group !== "failed");
}

export function recommend({ findings, experiments, noise, available, preset }: RecommendInput): Recommendation {
  const open = (k: VariantKey) => available(k) && !tried(k, experiments);
  const undecided = experiments.filter((e) => e.group === "awaiting_decision" && !e.is_replicate && e.verdict.verdict === "insufficient_evidence");

  // 1. Experiments already ran but cannot be judged: more seeds first.
  if (undecided.length && !noise.sufficient && available("seed")) {
    const n = undecided.length;
    return {
      kind: "evidence",
      key: "seed",
      finding: null,
      title: ACTION_TITLE.seed,
      observed: `${n} experiment${n === 1 ? "" : "s"} cannot be judged yet: the original settings have run ${noise.baseline_runs} of the ${noise.required} times needed to measure run-to-run noise.`,
      evidence: null,
      hypothesis:
        "Training the same settings with another seed shows how much results move by chance alone. Once enough runs exist, verdicts can say whether a change clearly helped or hurt.",
      followsUp: undecided[0],
      alternatives: [],
    };
  }
  const repeatable = undecided.find((e) => e.variant_key && available(e.variant_key as VariantKey));
  if (repeatable && noise.sufficient) {
    const key = repeatable.variant_key as VariantKey;
    return {
      kind: "evidence",
      key,
      finding: null,
      title: `Repeat “${VARIANT_COPY[key].label}” with another seed`,
      observed: "This experiment's difference from the original is within what a single run can resolve.",
      evidence: null,
      hypothesis: "A second run of the same change shows whether the difference holds or was luck.",
      followsUp: repeatable,
      alternatives: [],
    };
  }

  // 2. The most severe, best-supported finding with an untried fix.
  const ranked = findings
    .filter((f) => f.severity in SEVERITY_RANK && keysForFinding(f).length)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (EVIDENCE_RANK[a.evidence ?? ""] ?? 4) - (EVIDENCE_RANK[b.evidence ?? ""] ?? 4),
    );
  const wanted = (preset && PRESET_SELECTS[preset]?.filter((k) => k !== "seed")) || [];
  const presetKey = wanted.find(open);
  if (presetKey) {
    const f = ranked.find((x) => keysForFinding(x).includes(presetKey)) ?? null;
    return diagnosis(presetKey, f, f ? keysForFinding(f).filter((k) => k !== presetKey && open(k)) : []);
  }
  for (const f of ranked) {
    const keys = keysForFinding(f).filter(open);
    if (keys.length) return diagnosis(keys[0], f, keys.slice(1, 3));
  }

  // 3. Nothing diagnosed (or every fix tried): an honest exploratory test.
  const explore = EXPLORATORY.filter(open);
  if (explore.length) {
    const addressed = ranked.length > 0;
    return {
      kind: "exploratory",
      key: explore[0],
      finding: null,
      title: ACTION_TITLE[explore[0]],
      observed: null,
      evidence: null,
      hypothesis: addressed
        ? `The experiments that target Model Health's findings have been run. This is an exploratory test: ${lower(VARIANT_COPY[explore[0]].hypothesis)}`
        : `Model Health found no specific problem to fix, so this is an exploratory test rather than a fix: ${lower(VARIANT_COPY[explore[0]].hypothesis)}`,
      followsUp: null,
      alternatives: explore.slice(1, 3),
    };
  }

  return {
    kind: "done",
    key: "seed",
    finding: null,
    title: ACTION_TITLE.seed,
    observed: "Every standard experiment has been run against this original.",
    evidence: null,
    hypothesis: "More runs of the original settings tighten the noise estimate, which makes the existing verdicts more reliable.",
    followsUp: null,
    alternatives: [],
  };
}

function diagnosis(key: VariantKey, f: Finding | null, alternatives: VariantKey[]): Recommendation {
  return {
    kind: f ? "diagnosis" : "exploratory",
    key,
    finding: f,
    title: ACTION_TITLE[key],
    observed: f ? `${f.title}. ${f.detail}` : null,
    evidence: f?.evidence ? EVIDENCE_LABEL[f.evidence] : null,
    hypothesis: VARIANT_COPY[key].hypothesis,
    followsUp: null,
    alternatives,
  };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
