/** When true, the workspace toolbar is unpinned (hidden until edge hover). Default: pinned open. */
export const SIDEBAR_UNPINNED_KEY = "convolve:sidebar-unpinned";

export function readSidebarUnpinned(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_UNPINNED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarUnpinned(v: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_UNPINNED_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
