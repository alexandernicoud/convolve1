import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useHeaderReveal } from "@/context/HeaderRevealContext";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { getPipelineTitle } from "@/components/layout/pipelineTitle";

type Props = {
  children: ReactNode;
  /** Dashboard grid manages its own padding; other tools use padded shell */
  variant?: "dashboard" | "scroll";
};

/**
 * Single-viewport technical shell: fixed below the header strip.
 * Tool pages (non-dashboard) scroll in the main column so all content stays reachable.
 * Dashboard uses variant="dashboard" and manages its own internal overflow.
 */
export function TechnicalLayout({ children, variant = "scroll" }: Props) {
  const { pathname } = useLocation();
  const { compactShellTopPx } = useHeaderReveal();
  const pipelineBarTitle = getPipelineTitle(pathname);
  const toolPageScroll = variant !== "dashboard";

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed left-0 right-0 z-40 flex flex-col overflow-hidden bg-black font-sans text-white transition-[top,height] duration-200 ease-out"
      style={{
        top: compactShellTopPx,
        height: `calc(100dvh - ${compactShellTopPx}px)`,
      }}
    >
      <div className="flex min-h-0 flex-1 items-stretch gap-2.5 overflow-hidden px-2.5 pb-2.5 pt-0">
        <DashboardSidebar />
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {variant !== "dashboard" ? (
            <div className="shrink-0 pb-2 pt-0">
              <DashboardTopBar title={pipelineBarTitle} />
            </div>
          ) : null}
          <div
            className={`flex min-h-0 flex-1 flex-col ${
              toolPageScroll ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden"
            }`}
          >
            {variant === "dashboard" ? (
              children
            ) : (
              <div className="mx-auto w-full min-h-full max-w-[100rem] px-5 pb-6 pt-0 md:px-8 lg:px-10 lg:pb-8">
                <p className="mb-3 max-w-3xl text-[10px] leading-relaxed text-white/32">
                  Free trial compute is shared and substantially slower than a dedicated machine. Generator,
                  training, analysis, and backtests can take much longer here than on localhost.
                </p>
                {/* Content grows; this column scrolls. Do not use h-full/overflow-hidden traps here. */}
                <div className="min-w-0">{children}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
