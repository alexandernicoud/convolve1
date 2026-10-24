import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useParams, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useRunsStore } from "@/state/runsStore";
import { HeaderRevealProvider, useHeaderReveal, isCompactHeaderPathname } from "@/context/HeaderRevealContext";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute, isProtectedAppPath } from "@/components/auth/ProtectedRoute";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GlobalBackground from "@/components/AppBackground";
import TechBackground from "@/components/TechBackground";
import ActiveRunBanner from "@/components/ActiveRunBanner";
import Vision from "./pages/Vision";
import VisionHome2 from "./pages/VisionHome2";
import VisionHome3 from "./pages/VisionHome3";
import Home2Page from "./features/marketing2/Home2Page";
import About2Page from "./features/marketing2/About2Page";
import Products2Page from "./features/marketing2/Products2Page";
import PrivacyPage from "./features/legal/PrivacyPage";
import TermsPage from "./features/legal/TermsPage";
import RiskDisclosurePage from "./features/legal/RiskDisclosurePage";
import CookiesPage from "./features/legal/CookiesPage";
import LegalNoticePage from "./features/legal/LegalNoticePage";
import { isLegalPath } from "./features/legal/paths";
import Contact from "./pages/Contact";
import Docs from "./pages/Docs";
import NotFound from "./pages/NotFound";
import RunLog from "./pages/RunLog";
import Account from "./pages/Account";
import PricingPage from "./features/pricing/PricingPage";
import CreditGuardModal, { RunConfirmModal } from "@/components/CreditGuardModal";
import { OnboardingHost } from "@/features/onboarding/OnboardingHost";
import { ExplainLayer } from "@/features/help/ExplainMode";
import HelpPage from "@/features/help/HelpPage";
import Login from "./pages/auth/Login";
import AuthCallback from "./pages/auth/AuthCallback";
import Signup from "./pages/auth/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";

// Product / optimizer (technical UIs under /products; landings removed — use Navigate below)
import LabelingOptimizerTechnical from "./pages/products/LabelingOptimizerTechnical";
import LabelingOptimizerRun from "./pages/products/LabelingOptimizerRun";
import LabelingOptimizerResults from "./pages/products/LabelingOptimizerResults";
import TrainerAdvancedVisuals from "./pages/products/TrainerAdvancedVisuals";

// Tool pages
import Generator from "./pages/Generator";
import GeneratorResults from "./pages/GeneratorResults";
import Trainer from "./pages/Trainer";
import AnalysisTechnical from "./pages/AnalysisTechnical";
import LabPage from "./features/lab/LabPage";
import TrainingSessionPage, { LegacyTrainerAnalysisRedirect } from "./features/trainer/TrainingSessionPage";
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

function KeepHashRedirect({ to }: { to: string }) {
  const { hash } = useLocation();
  return <Navigate to={`${to}${hash}`} replace />;
}

/** Older clients stored `/products/labeling-optimizer/runs/:id` (plural) which has no route. */
function LegacyLabelingOptimizerRunsRedirect() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return <Navigate to="/products/labeling-optimizer/technical" replace />;
  return <Navigate to={`/products/labeling-optimizer/run/${encodeURIComponent(runId)}`} replace />;
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const compact = isCompactHeaderPathname(pathname);
  const shell = (
    <div
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col",
        compact ? "relative h-full min-h-0" : "animate-page-enter",
      )}
    >
      {children}
    </div>
  );
  if (isProtectedAppPath(pathname)) {
    return <ProtectedRoute>{shell}</ProtectedRoute>;
  }
  return shell;
}

function AppShell() {
  const { pathname } = useLocation();
  const { headerContentPushPx } = useHeaderReveal();
  const isMarketing2 =
    pathname === "/" ||
    pathname === "/about" ||
    pathname === "/pricing" ||
    pathname === "/products" ||
    pathname === "/help" ||
    isLegalPath(pathname);
  const showFooter = !isCompactHeaderPathname(pathname) && !isMarketing2;
  const isHomeLanding =
    pathname === "/" ||
    pathname === "/vision" ||
    pathname === "/home3" ||
    isMarketing2;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let isActive = true;

    const reconcile = async () => {
      if (!isActive) return;
      await useRunsStore.getState().mergeRunsFromBackendList(200);
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
          <Route path="/" element={<PageWrapper><Home2Page /></PageWrapper>} />
          <Route path="/vision" element={<PageWrapper><VisionHome2 /></PageWrapper>} />
          <Route path="/home2" element={<KeepHashRedirect to="/" />} />
          <Route path="/home3" element={<PageWrapper><VisionHome3 /></PageWrapper>} />
          <Route path="/founder" element={<Navigate to="/about" replace />} />
          <Route path="/about" element={<PageWrapper><About2Page /></PageWrapper>} />
          <Route path="/about2" element={<KeepHashRedirect to="/about" />} />
          <Route path="/pricing" element={<PageWrapper><PricingPage /></PageWrapper>} />
          <Route path="/products2" element={<KeepHashRedirect to="/products" />} />
          <Route path="/contact" element={<PageWrapper><Contact /></PageWrapper>} />
          <Route path="/help" element={<PageWrapper><HelpPage /></PageWrapper>} />
          <Route path="/privacy" element={<PageWrapper><PrivacyPage /></PageWrapper>} />
          <Route path="/datenschutz" element={<Navigate to="/privacy" replace />} />
          <Route path="/terms" element={<PageWrapper><TermsPage /></PageWrapper>} />
          <Route path="/risk-disclosure" element={<PageWrapper><RiskDisclosurePage /></PageWrapper>} />
          <Route path="/cookies" element={<PageWrapper><CookiesPage /></PageWrapper>} />
          <Route path="/legal" element={<PageWrapper><LegalNoticePage /></PageWrapper>} />
          <Route path="/impressum" element={<Navigate to="/legal" replace />} />
          <Route path="/docs" element={<PageWrapper><Docs /></PageWrapper>} />
          <Route path="/login" element={<PageWrapper><Login /></PageWrapper>} />
          <Route path="/auth/callback" element={<PageWrapper><AuthCallback /></PageWrapper>} />
          <Route path="/signup" element={<PageWrapper><Signup /></PageWrapper>} />
          <Route path="/forgot-password" element={<PageWrapper><ForgotPassword /></PageWrapper>} />
          <Route path="/reset-password" element={<PageWrapper><ResetPassword /></PageWrapper>} />

          {/* Product hub (marketing) + legacy /product/* URLs → technical tools */}
          <Route path="/products" element={<PageWrapper><Products2Page /></PageWrapper>} />
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
          {/* Legacy plural /runs/ 404'd — rewrite to singular /run/ */}
          <Route
            path="/products/labeling-optimizer/runs/:runId"
            element={<LegacyLabelingOptimizerRunsRedirect />}
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
            path="/tools/generator/runs/:runId"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <GeneratorResults />
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
            path="/tools/trainer/runs/:runId"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <TrainingSessionPage />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route path="/tools/trainer/runs/:runId/analysis" element={<LegacyTrainerAnalysisRedirect />} />
          <Route
            path="/tools/analysis"
            element={
              <PageWrapper>
                <TechnicalLayout>
                  <LabPage />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route
            path="/tools/analysis/legacy"
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

          {/* Account workspace (dashboard shell so the sidebar balance stays live) */}
          <Route
            path="/account"
            element={
              <PageWrapper>
                <TechnicalLayout variant="dashboard">
                  <Account />
                </TechnicalLayout>
              </PageWrapper>
            }
          />
          <Route path="/credits" element={<Navigate to="/account?tab=usage" replace />} />

          {/* Fallback */}
          <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
        </Routes>
      </main>
      {showFooter ? <Footer /> : null}
      <CreditGuardModal />
      <RunConfirmModal />
      <OnboardingHost active={isProtectedAppPath(pathname)} />
      <ExplainLayer />
    </div>
  );
}

const AppRoutes = () => (
  <HeaderRevealProvider>
    <AuthProvider>
      <AppShell />
    </AuthProvider>
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
