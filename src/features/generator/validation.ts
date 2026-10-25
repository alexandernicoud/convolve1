import { parseIsoDate } from "@/lib/generatorDates";

/** Form fields that can be invalid, in on-screen order. */
export const FIELD_ORDER = [
  "symbols",
  "chartsPerLabel",
  "trainingStart",
  "referenceEnd",
  "datasetName",
  "horizonBars",
  "takeProfit",
  "stopLoss",
  "endOffset",
] as const;
export type FieldKey = (typeof FIELD_ORDER)[number];
export type FieldErrors = Partial<Record<FieldKey, string>>;

/** Collapsible containers a field lives in (outermost first); open them all to reveal it. */
export type SectionKey = "chartSettings" | "advanced";
export const FIELD_SECTIONS: Record<FieldKey, SectionKey[]> = {
  symbols: [],
  chartsPerLabel: [],
  trainingStart: [],
  referenceEnd: [],
  datasetName: ["chartSettings"],
  horizonBars: ["chartSettings"],
  takeProfit: ["chartSettings"],
  stopLoss: ["chartSettings"],
  endOffset: ["chartSettings", "advanced"],
};

export const FIELD_IDS: Record<FieldKey, string> = {
  symbols: "gen-symbols",
  chartsPerLabel: "gen-charts-per-class",
  trainingStart: "gen-training-start",
  referenceEnd: "gen-dataset-end",
  datasetName: "gen-dataset-name",
  horizonBars: "gen-horizon",
  takeProfit: "gen-take-profit",
  stopLoss: "gen-stop-loss",
  endOffset: "gen-end-offset",
};

export const MAX_CHARTS_PER_CLASS = 20000;
export const MAX_SYMBOLS = 50;
export const MAX_NAME_LENGTH = 120;

export type GeneratorFormState = {
  symbols: string[];
  chartsPerLabel: number;
  volumeMode: "by_charts" | "by_period";
  trainingStartIso: string;
  referenceEndIso: string;
  datasetName: string;
  horizonBars: number;
  takeProfitFraction: number;
  stopLossFraction: number;
  useRawEndOffset: boolean;
  endOffset: number;
  todayIso: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Same rules as the backend's `generator_request_errors`. */
export function validateGenerator(s: GeneratorFormState): FieldErrors {
  const e: FieldErrors = {};
  if (s.symbols.length === 0) e.symbols = "Add at least one stock symbol.";
  else if (s.symbols.length > MAX_SYMBOLS) e.symbols = `Use at most ${MAX_SYMBOLS} stock symbols.`;

  if (!Number.isFinite(s.chartsPerLabel)) e.chartsPerLabel = "Charts per class is required.";
  else if (!Number.isInteger(s.chartsPerLabel) || s.chartsPerLabel < 1 || s.chartsPerLabel > MAX_CHARTS_PER_CLASS)
    e.chartsPerLabel = `Charts per class must be a whole number between 1 and ${MAX_CHARTS_PER_CLASS.toLocaleString("en-US")}.`;

  const end = ISO.test(s.referenceEndIso) ? parseIsoDate(s.referenceEndIso) : null;
  if (!s.referenceEndIso) e.referenceEnd = "Dataset end is required.";
  else if (!end) e.referenceEnd = "Dataset end must be a valid date.";
  else if (s.referenceEndIso > s.todayIso) e.referenceEnd = "Dataset end cannot be in the future.";

  if (s.volumeMode === "by_period") {
    const start = ISO.test(s.trainingStartIso) ? parseIsoDate(s.trainingStartIso) : null;
    if (!s.trainingStartIso) e.trainingStart = "Training start is required.";
    else if (!start) e.trainingStart = "Training start must be a valid date.";
    else if (end && start >= end) e.trainingStart = "Training start must be before the dataset end.";
  }

  const name = s.datasetName.trim();
  if (!name) e.datasetName = "Dataset name is required.";
  else if (name.length > MAX_NAME_LENGTH) e.datasetName = `Dataset name must be at most ${MAX_NAME_LENGTH} characters.`;

  if (!Number.isFinite(s.horizonBars)) e.horizonBars = "Horizon is required.";
  else if (!Number.isInteger(s.horizonBars) || s.horizonBars < 1 || s.horizonBars > 500)
    e.horizonBars = "Horizon must be a whole number between 1 and 500 bars.";

  if (!Number.isFinite(s.takeProfitFraction)) e.takeProfit = "Take profit is required.";
  else if (s.takeProfitFraction <= 0 || s.takeProfitFraction > 1) e.takeProfit = "Take profit must be above 0 % and at most 100 %.";

  if (!Number.isFinite(s.stopLossFraction)) e.stopLoss = "Stop loss is required.";
  else if (s.stopLossFraction <= 0 || s.stopLossFraction >= 1) e.stopLoss = "Stop loss must be above 0 % and below 100 %.";

  if (s.useRawEndOffset && (!Number.isInteger(s.endOffset) || s.endOffset < 0))
    e.endOffset = "End offset must be a whole number of bars, 0 or more.";
  return e;
}

export function errorList(errors: FieldErrors): { field: FieldKey; message: string }[] {
  return FIELD_ORDER.filter((f) => errors[f]).map((f) => ({ field: f, message: errors[f] as string }));
}

/** Sections to open and the field to focus after a blocked run attempt. */
export function revealPlan(errors: FieldErrors): { open: SectionKey[]; focus: FieldKey | null } {
  const list = errorList(errors);
  const open = [...new Set(list.flatMap((x) => FIELD_SECTIONS[x.field]))];
  return { open, focus: list[0]?.field ?? null };
}

/** Starts generation only when the form is valid; returns whether it started. */
export async function submitIfValid(errors: FieldErrors, start: () => Promise<void> | void): Promise<boolean> {
  if (errorList(errors).length) return false;
  await start();
  return true;
}

/** Backend 422 text ("field: message; field: message") → form field errors. */
const BACKEND_FIELDS: Record<string, FieldKey> = {
  symbols: "symbols",
  chartsPerLabel: "chartsPerLabel",
  trainingStart: "trainingStart",
  referenceEnd: "referenceEnd",
  datasetName: "datasetName",
  horizonBars: "horizonBars",
  takeProfit: "takeProfit",
  stopLoss: "stopLoss",
  endOffset: "endOffset",
};

export function fieldErrorsFromServer(message: string): FieldErrors {
  const out: FieldErrors = {};
  const re = new RegExp(`\\b(${Object.keys(BACKEND_FIELDS).join("|")}): ([^;"\\]]+)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    const f = BACKEND_FIELDS[m[1]];
    if (f && !out[f]) out[f] = m[2].trim();
  }
  return out;
}

/** Suggested dataset name until the user edits it. */
export function suggestDatasetName(symbols: string[], timeframe: string, tp: number, sl: number): string {
  const tf = timeframe === "1wk" ? "1W" : timeframe === "1mo" ? "1M" : "1D";
  const pct = (x: number) => (Number.isFinite(x) ? `${Number((x * 100).toFixed(2))}%` : "?");
  const syms = symbols.length > 3 ? `${symbols.slice(0, 3).join(", ")} +${symbols.length - 3}` : symbols.join(", ");
  return `${syms || "Dataset"} · ${tf} · TP ${pct(tp)} / SL ${pct(sl)}`;
}
