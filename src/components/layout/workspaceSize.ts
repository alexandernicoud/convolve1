import { useSyncExternalStore } from "react";

/** User-adjustable workspace chrome: sidebar width and header height (desktop only). */
export const SIDEBAR_WIDTH = { min: 64, default: 92, max: 232, step: 8 } as const;
export const HEADER_HEIGHT = { min: 44, default: 52, max: 80, step: 4 } as const;

export const SIDEBAR_WIDTH_KEY = "convolve:sidebar-width";
export const HEADER_HEIGHT_KEY = "convolve:header-height";

type Bounds = { min: number; default: number; max: number };

export function clampSize(value: number, b: Bounds): number {
  if (!Number.isFinite(value)) return b.default;
  return Math.round(Math.min(b.max, Math.max(b.min, value)));
}

export function parseStoredSize(raw: string | null, b: Bounds): number {
  if (raw == null || raw.trim() === "") return b.default;
  return clampSize(Number(raw), b);
}

/** Sidebar presentation for a given width: icons only, stacked icon + tag, or icon + full label. */
export type SidebarDensity = "compact" | "stacked" | "wide";

export function sidebarDensity(width: number): SidebarDensity {
  if (width < 80) return "compact";
  if (width < 148) return "stacked";
  return "wide";
}

/** Header metrics scale with height so logo, title and buttons stay proportional. */
export function headerMetrics(height: number) {
  const s = height / HEADER_HEIGHT.default;
  const r = (n: number) => Math.round(n * s);
  return {
    height,
    logo: r(32),
    title: Math.round(19 * s * 10) / 10,
    button: Math.max(30, r(40)),
    buttonFont: Math.max(12, Math.min(16, Math.round(14 * s))),
    icon: Math.max(14, Math.min(20, r(16))),
    padX: Math.max(12, r(18)),
    gap: Math.max(6, r(10)),
  };
}

type State = { sidebarWidth: number; headerHeight: number };

function read(key: string, b: Bounds): number {
  try {
    return parseStoredSize(localStorage.getItem(key), b);
  } catch {
    return b.default;
  }
}

let state: State = {
  sidebarWidth: typeof window === "undefined" ? SIDEBAR_WIDTH.default : read(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH),
  headerHeight: typeof window === "undefined" ? HEADER_HEIGHT.default : read(HEADER_HEIGHT_KEY, HEADER_HEIGHT),
};
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function persist(key: string, value: number, b: Bounds) {
  try {
    if (value === b.default) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

export function setSidebarWidth(px: number, save = true) {
  const v = clampSize(px, SIDEBAR_WIDTH);
  if (v !== state.sidebarWidth) emit({ ...state, sidebarWidth: v });
  if (save) persist(SIDEBAR_WIDTH_KEY, v, SIDEBAR_WIDTH);
}

export function setHeaderHeight(px: number, save = true) {
  const v = clampSize(px, HEADER_HEIGHT);
  if (v !== state.headerHeight) emit({ ...state, headerHeight: v });
  if (save) persist(HEADER_HEIGHT_KEY, v, HEADER_HEIGHT);
}

export function resetWorkspaceSize(which: "sidebar" | "header" | "both" = "both") {
  if (which !== "header") setSidebarWidth(SIDEBAR_WIDTH.default);
  if (which !== "sidebar") setHeaderHeight(HEADER_HEIGHT.default);
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIDEBAR_WIDTH_KEY) emit({ ...state, sidebarWidth: parseStoredSize(e.newValue, SIDEBAR_WIDTH) });
    if (e.key === HEADER_HEIGHT_KEY) emit({ ...state, headerHeight: parseStoredSize(e.newValue, HEADER_HEIGHT) });
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

const DESKTOP = "(min-width: 768px)";

function subscribeDesktop(l: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", l);
  return () => mq.removeEventListener("change", l);
}

/** Current sizes. Below the md breakpoint the header keeps its default height (no resizing on phones). */
export function useWorkspaceSize(): State & { desktop: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
  return { ...s, headerHeight: desktop ? s.headerHeight : HEADER_HEIGHT.default, desktop };
}
