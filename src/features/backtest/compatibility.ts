/** Front-end compatibility hints between a model and the chosen test set. Advisory only: nothing is blocked. */
export type CompatInput = {
  modelDatasetId?: string | null;
  modelSymbols?: string | null;
  modelTimeframe?: string | null;
  testDatasetId?: string | null;
  testSymbols?: string | null;
  testTimeframe?: string | null;
};

export type CompatResult = { state: "ok" | "warn" | "bad" | "pending" | "info"; value: string; detail?: string };

export function parseSymbols(s?: string | null): string[] {
  if (!s) return [];
  return [...new Set(s.split(/[\s,;/|]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
}

export function modelTestCompatibility(c: CompatInput): CompatResult {
  if (!c.testDatasetId) return { state: "pending", value: "Checked after test data" };
  if (c.modelDatasetId && c.modelDatasetId === c.testDatasetId) {
    return {
      state: "bad",
      value: "Same dataset the model was trained on",
      detail: "Scores would be in-sample, not an independent test.",
    };
  }
  const ms = parseSymbols(c.modelSymbols);
  const ts = parseSymbols(c.testSymbols);
  const notes: string[] = [];
  let state: CompatResult["state"] = "ok";
  if (ms.length && ts.length) {
    const shared = ts.filter((s) => ms.includes(s));
    if (shared.length === 0) {
      state = "warn";
      notes.push(`Model trained on ${ms.join(", ")}, test set covers ${ts.join(", ")}: this measures transfer to other symbols.`);
    } else if (shared.length < ts.length) {
      state = "warn";
      notes.push(`Test set includes symbols the model was not trained on (${ts.filter((s) => !ms.includes(s)).join(", ")}).`);
    }
  }
  const mt = c.modelTimeframe?.trim().toLowerCase();
  const tt = c.testTimeframe?.trim().toLowerCase();
  if (mt && tt && mt !== tt) {
    state = "warn";
    notes.push(`Timeframe differs: model ${mt}, test set ${tt}.`);
  }
  if (!ms.length && !mt) return { state: "info", value: "Not enough model metadata to compare" };
  if (!ts.length && !tt) return { state: "info", value: "Not enough test-set metadata to compare" };
  if (state === "ok") return { state, value: "Symbols and timeframe match" };
  return { state, value: "Check symbols and timeframe", detail: notes.join(" ") };
}
