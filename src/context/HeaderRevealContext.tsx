import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

const HEADER_PX = 80;
/** Visible strip height when header is collapsed in reveal mode */
export const HEADER_PEEK_PX = 12;

/** Inset around the compact (rounded) header bar on all sides — matches workspace gutters */
export const HEADER_INSET_PX = 10;
/** Inner height of the expanded header bar */
export const HEADER_INNER_EXPANDED_PX = 80;
/** Inner height when collapsed to peek strip */
export const HEADER_INNER_PEEK_PX = 12;

/**
 * Viewport Y where the technical shell (sidebar + workspace) should start:
 * top inset + inner bar + bottom inset below the bar.
 */
export function getCompactShellTopPx(revealMode: boolean, headerRevealed: boolean): number {
  const inner = revealMode && !headerRevealed ? HEADER_INNER_PEEK_PX : HEADER_INNER_EXPANDED_PX;
  return HEADER_INSET_PX + inner + HEADER_INSET_PX;
}

/**
 * Routes where the global header uses the slim top strip + expand-on-hover behavior.
 * All other routes keep the header fully visible at all times.
 */
export function isCompactHeaderPathname(pathname: string): boolean {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return true;
  if (pathname.startsWith("/tools/")) return true;
  if (pathname.startsWith("/products/labeling-optimizer/")) return true;
  if (pathname.startsWith("/products/trainer/analysis/")) return true;
  return false;
}

type Ctx = {
  headerStripPx: number;
  headerContentPushPx: number;
  /** Top offset for fixed TechnicalLayout on compact routes (below inset header). */
  compactShellTopPx: number;
  headerRevealed: boolean;
  setHeaderRevealed: (v: boolean) => void;
  /** True only on dashboard + technical routes (and fine pointer): header can collapse to peek strip */
  revealMode: boolean;
};

const HeaderRevealContext = createContext<Ctx | null>(null);

export function HeaderRevealProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const compactRoute = useMemo(() => isCompactHeaderPathname(pathname), [pathname]);

  const [finePointer, setFinePointer] = useState(true);
  const [headerRevealed, setHeaderRevealedState] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => {
      const fine = mq.matches;
      setFinePointer(fine);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /** Collapse behavior only on dashboard / technical pages, and only with fine pointer */
  const revealMode = compactRoute && finePointer;

  useEffect(() => {
    if (!compactRoute) {
      setHeaderRevealedState(true);
    } else if (finePointer) {
      setHeaderRevealedState(false);
    } else {
      setHeaderRevealedState(true);
    }
  }, [compactRoute, pathname, finePointer]);

  const setHeaderRevealed = useCallback((v: boolean) => {
    setHeaderRevealedState(v);
  }, []);

  const headerStripPx = useMemo(() => {
    if (!revealMode) return HEADER_PX;
    return headerRevealed ? HEADER_PX : HEADER_PEEK_PX;
  }, [revealMode, headerRevealed]);

  const compactShellTopPx = useMemo(() => {
    if (!compactRoute) return HEADER_PX;
    return getCompactShellTopPx(revealMode, revealMode ? headerRevealed : true);
  }, [compactRoute, revealMode, headerRevealed]);

  const headerContentPushPx = useMemo(() => {
    if (!compactRoute) return HEADER_PX;
    return compactShellTopPx;
  }, [compactRoute, compactShellTopPx]);

  const value = useMemo(
    () => ({
      headerStripPx,
      headerContentPushPx,
      compactShellTopPx,
      headerRevealed: revealMode ? headerRevealed : true,
      setHeaderRevealed,
      revealMode,
    }),
    [compactShellTopPx, headerContentPushPx, headerRevealed, headerStripPx, revealMode, setHeaderRevealed],
  );

  return <HeaderRevealContext.Provider value={value}>{children}</HeaderRevealContext.Provider>;
}

export function useHeaderReveal() {
  const ctx = useContext(HeaderRevealContext);
  if (!ctx) throw new Error("useHeaderReveal must be used within HeaderRevealProvider");
  return ctx;
}

export const HEADER_HEIGHT_PX = HEADER_PX;
