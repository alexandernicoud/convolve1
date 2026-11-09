import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TechnicalLayout } from "@/components/layout/TechnicalLayout";
import { PageTransition } from "@/components/layout/PageTransition";

/** Warm the common tool chunks so hops between Generator / Trainer / … do not blank. */
function PrefetchWorkspaceChunks() {
  useEffect(() => {
    const ric = window.requestIdleCallback?.bind(window);
    const cancelRic = window.cancelIdleCallback?.bind(window);
    const run = () => {
      void Promise.all([
        import("@/pages/Generator"),
        import("@/pages/Trainer"),
        import("@/pages/Backtester"),
        import("@/pages/RunLog"),
        import("@/pages/Dashboard"),
        import("@/features/lab/LabPage"),
        import("@/features/improve/ImprovePage"),
        import("@/pages/tools/Deploy"),
        import("@/pages/Account"),
      ]);
    };
    if (ric && cancelRic) {
      const id = ric(() => run());
      return () => cancelRic(id);
    }
    const t = window.setTimeout(run, 150);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

/** Stable workspace chrome (sidebar + top bar) with fading page content. */
export function WorkspaceShell() {
  const { pathname } = useLocation();
  const variant = pathname === "/account" || pathname.startsWith("/dashboard") ? "dashboard" : "scroll";
  return (
    <TechnicalLayout variant={variant}>
      <PrefetchWorkspaceChunks />
      <PageTransition>
        <Outlet />
      </PageTransition>
    </TechnicalLayout>
  );
}
