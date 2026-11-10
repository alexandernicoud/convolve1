import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useParams, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useRunsStore } from "@/state/runsStore";
import { HeaderRevealProvider, useHeaderReveal, isCompactHeaderPathname } from "@/context/HeaderRevealContext";
import { AuthProvider } from "@/context/AuthContext";
import { AccentProvider } from "@/features/accent/AccentProvider";
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
import SubscriptionTermsPage from "./features/legal/SubscriptionTermsPage";
import RefundPolicyPage from "./features/legal/RefundPolicyPage";
import CookiesPage from "./features/legal/CookiesPage";
import LegalNoticePage from "./features/legal/LegalNoticePage";
import { isLegalPath } from "./features/legal/paths";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";
import CreditGuardModal, { BillingBlockModal, RunConfirmModal } from "@/components/CreditGuardModal";
import { RunRefusedModal } from "@/features/beta/BetaUI";
import { RouteSeo } from "@/components/RouteSeo";
import { OnboardingHost } from "@/features/onboarding/OnboardingHost";
import { ExplainLayer } from "@/features/help/ExplainMode";
import HelpPage from "@/features/help/HelpPage";
import Login from "./pages/auth/Login";
import AuthCallback from "./pages/auth/AuthCallback";
import Signup from "./pages/auth/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";

import { ReferralClaimer } from "./features/rewards/ReferralClaimer";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";

// Signed-in workspace pages load on demand, so public pages do not download the research tools.
const Docs = lazy(() => import("./pages/Docs"));
const HomeV2Page = lazy(() => import("./features/marketing2/v2/HomeV2Page"));
const RunLog = lazy(() => import("./pages/RunLog"));
const Account = lazy(() => import("./pages/Account"));
const LabelingOptimizerTechnical = lazy(() => import("./pages/products/LabelingOptimizerTechnical"));
const LabelingOptimizerRun = lazy(() => import("./pages/products/LabelingOptimizerRun"));
const LabelingOptimizerResults = lazy(() => import("./pages/products/LabelingOptimizerResults"));
const TrainerAdvancedVisuals = lazy(() => import("./pages/products/TrainerAdvancedVisuals"));
const Generator = lazy(() => import("./pages/Generator"));
const GeneratorResults = lazy(() => import("./pages/GeneratorResults"));
const Trainer = lazy(() => import("./pages/Trainer"));
const AnalysisTechnical = lazy(() => import("./pages/AnalysisTechnical"));
const LabPage = lazy(() => import("./features/lab/LabPage"));
const TrainingSessionPage = lazy(() => import("./features/trainer/TrainingSessionPage"));
const ImprovePage = lazy(() => import("./features/improve/ImprovePage"));
const LegacyTrainerAnalysisRedirect = lazy(() =>
  import("./features/trainer/TrainingSessionPage").then((m) => ({ default: m.LegacyTrainerAnalysisRedirect })),
);
const Backtester = lazy(() => import("./pages/Backtester"));
const BacktesterResults = lazy(() => import("./pages/BacktesterResults"));
const Deploy = lazy(() => import("./pages/tools/Deploy"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DashboardDemo = lazy(() => import("./pages/DashboardDemo"));
const DashboardBotsDirectory = lazy(() => import("./pages/DashboardBotsDirectory"));
const DashboardPortfolio = lazy(() => import("./pages/DashboardPortfolio"));
const DashboardTradeHistory = lazy(() => import("./pages/DashboardTradeHistory"));
const DashboardCommunityRanking = lazy(() => import("./pages/DashboardCommunityRanking"));
const FeedbackPage = lazy(() => import("./features/feedback/FeedbackPage"));
const CitationReviewPage = lazy(() => import("./features/rewards/CitationReviewPage"));
const FeedbackReviewPage = lazy(() => import("./features/feedback/FeedbackReviewPage"));
const AdminPage = lazy(() => import("./features/admin/AdminPage"));
const LiveBotDetail = lazy(() => import("./pages/LiveBotDetail"));

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
    pathname === "/homepage-v2" ||
    pathname === "/about" ||
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
    document.body.classList.toggle("marketing-interactive", isMarketing2 || isHomeLanding);
    return () => document.body.classList.remove("marketing-interactive");
  }, [isMarketing2, isHomeLanding]);

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
        <Suspense fallback={<div className="min-h-[60vh] flex-1 bg-black" aria-busy="true" />}>
        <Routes>
          {/* Main pages */}
          <Route path="/" element={<PageWrapper><Home2Page /></PageWrapper>} />
          <Route path="/homepage-v2" element={<PageWrapper><HomeV2Page /></PageWrapper>} />
          <Route path="/vision" element={<PageWrapper><VisionHome2 /></PageWrapper>} />
          <Route path="/home2" element={<KeepHashRedirect to="/" />} />
          <Route path="/home3" element={<PageWrapper><VisionHome3 /></PageWrapper>} />
          <Route path="/founder" element={<Navigate to="/about" replace />} />
          <Route path="/about" element={<PageWrapper><About2Page /></PageWrapper>} />
          <Route path="/about2" element={<KeepHashRedirect to="/about" />} />
          <Route path="/pricing" element={<Navigate to="/products#pricing" replace />} />
          <Route path="/products2" element={<KeepHashRedirect to="/products" />} />
          <Route path="/contact" element={<PageWrapper><Contact /></PageWrapper>} />
          <Route path="/help" element={<PageWrapper><HelpPage /></PageWrapper>} />
          <Route path="/privacy" element={<PageWrapper><PrivacyPage /></PageWrapper>} />
          <Route path="/datenschutz" element={<Navigate to="/privacy" replace />} />
          <Route path="/terms" element={<PageWrapper><TermsPage /></PageWrapper>} />
          <Route path="/subscription-terms" element={<PageWrapper><SubscriptionTermsPage /></PageWrapper>} />
          <Route path="/refunds" element={<PageWrapper><RefundPolicyPage /></PageWrapper>} />
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
          {/* Legacy plural /runs/ 404'd — rewrite to singular /run/ */}
          <Route path="/products/labeling-optimizer/runs/:runId" element={<LegacyLabelingOptimizerRunsRedirect />} />
          <Route path="/tools/trainer/runs/:runId/analysis" element={<LegacyTrainerAnalysisRedirect />} />
          <Route path="/tools/optimizer" element={<Navigate to="/products/labeling-optimizer/technical" replace />} />
          <Route path="/tools/search-hub" element={<Navigate to="/tools/run-log" replace />} />
          <Route path="/credits" element={<Navigate to="/account?tab=usage" replace />} />

          {/* Stable workspace chrome (sidebar stays mounted across tool hops) */}
          <Route
            element={
              <PageWrapper>
                <WorkspaceShell />
              </PageWrapper>
            }
          >
            <Route path="/products/labeling-optimizer/technical" element={<LabelingOptimizerTechnical />} />
            <Route path="/products/labeling-optimizer/run/:runId" element={<LabelingOptimizerRun />} />
            <Route path="/products/labeling-optimizer/results/:runId" element={<LabelingOptimizerResults />} />
            <Route path="/products/trainer/analysis/:runId/:analysisId" element={<TrainerAdvancedVisuals />} />
            <Route path="/tools/generator" element={<Generator />} />
            <Route path="/tools/generator/runs/:runId" element={<GeneratorResults />} />
            <Route path="/tools/trainer" element={<Trainer />} />
            <Route path="/tools/trainer/runs/:runId" element={<TrainingSessionPage />} />
            <Route path="/tools/improve" element={<ImprovePage />} />
            <Route path="/tools/analysis" element={<LabPage />} />
            <Route path="/tools/analysis/legacy" element={<AnalysisTechnical />} />
            <Route path="/tools/backtester" element={<Backtester />} />
            <Route path="/tools/backtester/runs/:runId" element={<BacktesterResults />} />
            <Route path="/tools/run-log/:toolFamily" element={<RunLog />} />
            <Route path="/tools/run-log" element={<RunLog />} />
            <Route path="/tools/deploy" element={<Deploy />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/demo" element={<DashboardDemo />} />
            <Route path="/dashboard/bots" element={<DashboardBotsDirectory />} />
            <Route path="/dashboard/portfolio" element={<DashboardPortfolio />} />
            <Route path="/dashboard/trade-history" element={<DashboardTradeHistory />} />
            <Route path="/dashboard/feedback" element={<FeedbackPage />} />
            <Route path="/dashboard/admin/citations" element={<CitationReviewPage />} />
            <Route path="/dashboard/admin" element={<AdminPage />} />
            <Route path="/dashboard/admin/feedback" element={<FeedbackReviewPage />} />
            <Route path="/dashboard/community-ranking" element={<DashboardCommunityRanking />} />
            <Route path="/dashboard/bots/:botId" element={<LiveBotDetail />} />
            <Route path="/account" element={<Account />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
        </Routes>
        </Suspense>
      </main>
      {showFooter ? <Footer /> : null}
      <CreditGuardModal />
      <RunConfirmModal />
      <BillingBlockModal />
      <RunRefusedModal />
      <RouteSeo />
      <ReferralClaimer />
      <OnboardingHost active={isProtectedAppPath(pathname)} />
      <ExplainLayer />
    </div>
  );
}

const AppRoutes = () => (
  <HeaderRevealProvider>
    <AuthProvider>
      <AccentProvider>
        <AppShell />
      </AccentProvider>
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
