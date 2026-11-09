/** Persist "don't show the Manage starting screen again". */
export const HIDE_RESEARCH_START_KEY = "convolve:hide-research-start";

export function readHideResearchStart(): boolean {
  try {
    return localStorage.getItem(HIDE_RESEARCH_START_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHideResearchStart(v: boolean): void {
  try {
    localStorage.setItem(HIDE_RESEARCH_START_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
