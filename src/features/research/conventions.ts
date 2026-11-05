/**
 * Readable names for the labelling and trade-outcome conventions recorded in run artefacts
 * (backend/app/services/trade_outcomes.py). Unknown ids are returned unchanged.
 */

const LABEL_METHOD: Record<string, string> = {
  tp_first_else_zero_v2: "Label 1 if the target is hit before the stop; unfinished horizons excluded",
  tp_first_else_zero_v1: "Label 1 if the target is hit before the stop; unfinished horizons counted as 0 (older datasets)",
};

const OUTCOME_CONVENTION: Record<string, string> = {
  next_open_tp_sl_v1: "Enter at the next open; stop checked before target; time out at the horizon close",
};

export const labelMethodName = (id?: string | null): string => (id ? LABEL_METHOD[id] ?? id : "—");
export const outcomeConventionName = (id?: string | null): string => (id ? OUTCOME_CONVENTION[id] ?? id : "—");
