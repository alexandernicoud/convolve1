import { Suspense, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

/** Soft placeholder while a lazy tool chunk loads — keeps sidebar/top bar mounted. */
function WorkspacePageFallback() {
  return (
    <div className="flex min-h-[40vh] flex-1 flex-col gap-3 py-2" aria-busy="true" aria-label="Loading workspace page">
      <div className="h-8 w-48 max-w-[50%] rounded-lg bg-white/[0.06]" />
      <div className="h-4 w-full max-w-xl rounded bg-white/[0.04]" />
      <div className="mt-2 min-h-[12rem] flex-1 rounded-xl border border-white/25 bg-white/[0.03]" />
    </div>
  );
}

/**
 * Opacity-only enter (same language as marketing `animate-page-enter`).
 * No transform — transforms here would break `position:fixed` TechnicalLayout descendants.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="animate-page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <Suspense fallback={<WorkspacePageFallback />}>{children}</Suspense>
    </div>
  );
}
