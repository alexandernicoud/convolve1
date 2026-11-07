/** Persist whether the workspace toolbar (left rail) is collapsed. */
export const SIDEBAR_COLLAPSED_KEY = "convolve:sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(v: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
