/**
 * Layer tables of the trainer CNN profiles (backend/runners/cnn_architectures.py) for a given input size.
 * Mirrors backend/app/services/trainer_session.py `standard_architecture`; keep them in sync.
 */
export interface ArchitecturePreview {
  family: string;
  input: [number, number];
  layers: { name: string; shape: number[]; params: number }[];
  totalParams: number | null;
  /** Builder networks (GAP CNN, ResNet, EfficientNet): stage descriptions instead of a layer table. */
  stages?: string[];
}

export const DEFAULT_ARCHITECTURE = "convolve-cnn-v1";

/** Conv filters per block (3×3, valid padding, then 2×2 max-pool) and dense units. */
const LAYOUTS: Record<string, { family: string; filters: number[]; dense: number }> = {
  "convolve-cnn-v1": { family: "Convolve standard CNN", filters: [32, 64, 128], dense: 128 },
  "convolve-cnn-compact-v1": { family: "Compact", filters: [16, 32, 64, 64], dense: 64 },
  "convolve-cnn-balanced-v1": { family: "Balanced (experimental)", filters: [24, 48, 96, 96], dense: 96 },
  "convolve-cnn-deep-v1": { family: "Higher capacity (experimental)", filters: [32, 64, 128, 128, 256], dense: 128 },
};

/** Catalog fields needed to describe a builder network (see TrainerArchitecture). */
type BuilderEntry = { id: string; label: string; family?: string; stages?: string[]; parameters_224: number; min_input?: number };

export function architecturePreview(
  id: string | undefined,
  height: number,
  width: number,
  catalogEntry?: BuilderEntry | null,
): ArchitecturePreview {
  if (catalogEntry && catalogEntry.family === "builder" && catalogEntry.id === id) {
    const fits = Math.min(height, width) >= (catalogEntry.min_input ?? 32);
    return {
      family: catalogEntry.label,
      input: [height, width],
      layers: [],
      stages: catalogEntry.stages ?? [],
      // Global average pooling before the head: the parameter count does not depend on image size.
      totalParams: fits ? catalogEntry.parameters_224 : null,
    };
  }
  const layout = LAYOUTS[id ?? DEFAULT_ARCHITECTURE] ?? LAYOUTS[DEFAULT_ARCHITECTURE];
  let h = Math.floor(height);
  let w = Math.floor(width);
  const layers: ArchitecturePreview["layers"] = [{ name: "Input", shape: [h, w, 3], params: 0 }];
  let channels = 3;
  for (const filters of layout.filters) {
    h -= 2;
    w -= 2;
    if (h <= 0 || w <= 0) return { family: layout.family, input: [height, width], layers, totalParams: null };
    layers.push({ name: `Conv2D 3×3 · ${filters}`, shape: [h, w, filters], params: 9 * channels * filters + filters });
    h = Math.floor(h / 2);
    w = Math.floor(w / 2);
    layers.push({ name: "MaxPool 2×2", shape: [h, w, filters], params: 0 });
    channels = filters;
  }
  const flat = h * w * channels;
  const units = layout.dense;
  layers.push({ name: "Flatten", shape: [flat], params: 0 });
  layers.push({ name: `Dense · ${units}`, shape: [units], params: flat * units + units });
  layers.push({ name: "Dense · 1 (sigmoid)", shape: [1], params: units + 1 });
  return {
    family: layout.family,
    input: [height, width],
    layers,
    totalParams: layers.reduce((s, l) => s + l.params, 0),
  };
}

export function standardArchitecturePreview(height: number, width: number): ArchitecturePreview {
  return architecturePreview(DEFAULT_ARCHITECTURE, height, width);
}
