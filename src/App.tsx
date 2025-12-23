import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Index from "./pages/Index";
import Vision from "./pages/Vision";
import Contact from "./pages/Contact";
import Docs from "./pages/Docs";
import NotFound from "./pages/NotFound";
import Founders from "./pages/Founders";
import Account from "./pages/Account";

// Product landing pages
import LiveBots from "./pages/products/LiveBots";
import TrainBot from "./pages/products/TrainBot";
import Backtest from "./pages/products/Backtest";
import GenerateData from "./pages/products/GenerateData";
import OptimizeLabeling from "./pages/products/OptimizeLabeling";

// Tool pages
import Generator from "./pages/Generator";
import Trainer from "./pages/Trainer";
import Backtester from "./pages/Backtester";
import Optimizer from "./pages/tools/Optimizer";

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
    <div className="animate-page-enter">
      {children}
    </div>
  );
}

const AppRoutes = () => {
  return (
    <>
      <ScrollToTop />
      <Header />
      <Routes>
        {/* Main pages */}
        <Route path="/" element={<PageWrapper><Index /></PageWrapper>} />
        <Route path="/vision" element={<PageWrapper><Vision /></PageWrapper>} />
        <Route path="/founder" element={<PageWrapper><Founders /></PageWrapper>} />
        <Route path="/account" element={<PageWrapper><Account /></PageWrapper>} />
        <Route path="/contact" element={<PageWrapper><Contact /></PageWrapper>} />
        <Route path="/docs" element={<PageWrapper><Docs /></PageWrapper>} />

        {/* Product landing pages */}
        <Route path="/products/live-bots" element={<PageWrapper><LiveBots /></PageWrapper>} />
        <Route path="/products/train-bot" element={<PageWrapper><TrainBot /></PageWrapper>} />
        <Route path="/products/backtest" element={<PageWrapper><Backtest /></PageWrapper>} />
        <Route path="/products/generate-data" element={<PageWrapper><GenerateData /></PageWrapper>} />
        <Route path="/products/optimize-labeling" element={<PageWrapper><OptimizeLabeling /></PageWrapper>} />

        {/* Tool pages */}
        <Route path="/tools/generator" element={<PageWrapper><Generator /></PageWrapper>} />
        <Route path="/tools/trainer" element={<PageWrapper><Trainer /></PageWrapper>} />
        <Route path="/tools/backtester" element={<PageWrapper><Backtester /></PageWrapper>} />
        <Route path="/tools/optimizer" element={<PageWrapper><Optimizer /></PageWrapper>} />

        {/* Fallback */}
        <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
      </Routes>
      <Footer />
    </>
  );
};

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
