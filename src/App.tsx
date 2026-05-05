import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useRunsStore } from "@/state/runsStore";
import { HeaderRevealProvider, useHeaderReveal, isCompactHeaderPathname } from "@/context/HeaderRevealContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GlobalBackground from "@/components/AppBackground";
import TechBackground from "@/components/TechBackground";
import ActiveRunBanner from "@/components/ActiveRunBanner";
import Vision from "./pages/Vision";
import VisionHome2 from "./pages/VisionHome2";
import VisionHome3 from "./pages/VisionHome3";
import Contact from "./pages/Contact";
import Docs from "./pages/Docs";
import NotFound from "./pages/NotFound";
import Founders from "./pages/Founders";
import RunLog from "./pages/RunLog";
import Account from "./pages/Account";

// Product / optimizer (technical UIs under /products; landings removed — use Navigate below)
import LabelingOptimizerTechnical from "./pages/products/LabelingOptimizerTechnical";
import LabelingOptimizerRun from "./pages/products/LabelingOptimizerRun";
import LabelingOptimizerResults from "./pages/products/LabelingOptimizerResults";
import TrainerAdvancedVisuals from "./pages/products/TrainerAdvancedVisuals";
import ProductsHub from "./pages/products/ProductsHub";

// Tool pages
import Generator from "./pages/Generator";
import Trainer from "./pages/Trainer";
import AnalysisTechnical from "./pages/AnalysisTechnical";
import Backtester from "./pages/Backtester";
import BacktesterResults from "./pages/BacktesterResults";
import Optimizer from "./pages/tools/Optimizer";
import Deploy from "./pages/tools/Deploy";
import Dashboard from "./pages/Dashboard";
import DashboardDemo from "./pages/DashboardDemo";
import DashboardBotsDirectory from "./pages/DashboardBotsDirectory";
import DashboardPortfolio from "./pages/DashboardPortfolio";
import DashboardTradeHistory from "./pages/DashboardTradeHistory";
import DashboardCommunityRanking from "./pages/DashboardCommunityRanking";
import LiveBotDetail from "./pages/LiveBotDetail";
import { TechnicalLayout } from "@/components/layout/TechnicalLayout";

const queryClient = new QueryClient();

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col animate-page-enter">
      {children}
    </div>
  );
}

function AppShell() {
  const { pathname } = useLocation();
  const { headerContentPushPx } = useHeaderReveal();
  const showFooter = !isCompactHeaderPathname(pathname);
  const isHomeLanding =
    pathname === "/" ||
    pathname === "/vision" ||
    pathname === "/home2" ||
    pathname === "/home3";

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let isActive = true;

    const reconcile = async () => {
      if (!isActive) return;
      await useRunsStore.getState().reconcileRunsWithBackend({ concurrency: 4 });
    };

    const startInterval = () => {
      if (interval) return;
      interval = setInterval(reconcile, 45000);
    };

    const stopInterval = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    reconcile();
    startInterval();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopInterval();
      } else {
        reconcile();
        startInterval();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isActive = false;
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {!isHomeLanding ?
        <>
          <GlobalBackground />
          <TechBackground />
        </>
      : null}
      <ScrollToTop />
      <Header />
      <ActiveRunBanner />
      <main
        className={cn(
          "flex min-h-0 flex-grow flex-col transition-[padding-top] duration-200 ease-out",
          (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) && "bg-black text-white",
          isHomeLanding && "bg-black",
          isCompactHeaderPathname(pathname) && "overflow-hidden"
        )}
        style={{
          /* Compact workspace uses fixed TechnicalLayout; main padding would stack and add a false gap */
          paddingTop: isCompactHeaderPathname(pathname) ? 0 : headerContentPushPx,
        }}
      >
        <Routes>
          {/* Main pages */}
          <Route path="/" element={<PageWrapper><VisionHome2 /></PageWrapper>} />
          <Route path="/vision" element={<PageWrapper><VisionHome2 /></PageWrapper>} />
          <Route path="/home2" element={<PageWrapper><VisionHome2 /></PageWrapper>} />
          <Route path="/home3" element={<PageWrapper><VisionHome3 /></PageWrapper>} />
          <Route path="/founder" element={<Navigate to="/about" replace />} />
          <Route path="/about" element={<PageWrapper><Founders /></PageWrapper>} />
          <Route path="/account" element={<PageWrapper><Account /></PageWrapper>} />
          <Route path="/contact" element={<PageWrapper><Contact /></PageWrapper>} />
          <Route path="/docs" element={<PageWrapper><Docs /></PageWrapper>} />

          {/* Product hub (marketing) + legacy /product/* URLs → technical tools */}
          <Route path="/products" element={<PageWrapper><ProductsHub /></PageWrapper>} />
          <Route path="/products/train-bot" element={<Navigate to="/tools/trainer" replace />} />
          <Route path="/products/backtest" element={<Navigate to="/tools/backtester" replace />} />
          <Route path="/products/generate-data" element={<Navigate to="/tools/generator" replace />} />
          <Route
            path="/products/optimize-labeling"
            element={<Navigate to="/products/labeling-optimizer/technical" replace />}
          />
          <Route path="/products/live-bots" element={<Navigate to="/dashboard/bots" replace />} />
          <Route
            path="/products/labeling-optimizer/technical"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <LabelingOptimizerTechnical />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/products/labeling-optimizer/run/:runId"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <LabelingOptimizerRun />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/products/labeling-optimizer/results/:runId"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <LabelingOptimizerResults />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/products/trainer/analysis/:runId/:analysisId"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <TrainerAdvancedVisuals />
                </TechnicalLayout>
              </PageWrapper>
            }
          />

          {/* Tool pages */}
          <Route
            path="/tools/generator"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <Generator />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/tools/trainer"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <Trainer />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/tools/analysis"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <AnalysisTechnical />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/tools/backtester"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <Backtester />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/tools/backtester/runs/:runId"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <BacktesterResults />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route path="/tools/optimizer" element={<Navigate to="/products/labeling-optimizer/technical" replace />} />
          <Route
            path="/tools/run-log/:toolFamily"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <RunLog />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/tools/run-log"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <RunLog />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/tools/deploy"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <Deploy />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/dashboard"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <Dashboard />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/dashboard/demo"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <DashboardDemo />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/dashboard/bots"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <DashboardBotsDirectory />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/dashboard/portfolio"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <DashboardPortfolio />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/dashboard/trade-history"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <DashboardTradeHistory />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/dashboard/community-ranking"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <DashboardCommunityRanking />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/dashboard/bots/:botId"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <LiveBotDetail />
                </TechnicalLayout>
              </PageWrapper>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
        </Routes>
      </main>
      {showFooter ? <Footer /> : null}
    </div>
  );
}

const AppRoutes = () => (
  <HeaderRevealProvider>
    <AppShell />
  </HeaderRevealProvider>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
