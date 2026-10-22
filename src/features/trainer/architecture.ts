/**
 * Layer table of the fixed trainer CNN (backend/runners/trainer_runner.py) for a given input size.
 * Mirrors backend/app/services/trainer_session.py `standard_architecture`; keep them in sync.
 */
export interface ArchitecturePreview {
  family: string;
  input: [number, number];
  layers: { name: string; shape: number[]; params: number }[];
  totalParams: number | null;
}

export function standardArchitecturePreview(height: number, width: number): ArchitecturePreview {
  let h = Math.floor(height);
  let w = Math.floor(width);
  const layers: ArchitecturePreview["layers"] = [{ name: "Input", shape: [h, w, 3], params: 0 }];
  let channels = 3;
  for (const filters of [32, 64, 128]) {
    h -= 2;
    w -= 2;
    if (h <= 0 || w <= 0) return { family: "Convolve standard CNN", input: [height, width], layers, totalParams: null };
    layers.push({ name: `Conv2D 3×3 · ${filters}`, shape: [h, w, filters], params: 9 * channels * filters + filters });
    h = Math.floor(h / 2);
    w = Math.floor(w / 2);
    layers.push({ name: "MaxPool 2×2", shape: [h, w, filters], params: 0 });
    channels = filters;
  }
  const flat = h * w * channels;
  layers.push({ name: "Flatten", shape: [flat], params: 0 });
  layers.push({ name: "Dense · 128", shape: [128], params: flat * 128 + 128 });
  layers.push({ name: "Dense · 1 (sigmoid)", shape: [1], params: 129 });
  return {
    family: "Convolve standard CNN",
    input: [height, width],
    layers,
    totalParams: layers.reduce((s, l) => s + l.params, 0),
  };
}
