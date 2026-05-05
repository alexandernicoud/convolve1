export type MatrixJson = {
  type?: string;
  title?: string;
  subtitle?: string;
  values: number[][];
  width?: number;
  height?: number;
  display_range?: { vmin?: number; vmax?: number };
};
