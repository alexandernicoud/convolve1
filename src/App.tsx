import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "@/components/Header";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Header />
        <Routes>
          {/* Main pages */}
          <Route path="/" element={<Index />} />
          <Route path="/vision" element={<Vision />} />
          <Route path="/founder" element={<Founders />} />
          <Route path="/account" element={<Account />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/docs" element={<Docs />} />

          {/* Product landing pages */}
          <Route path="/products/live-bots" element={<LiveBots />} />
          <Route path="/products/train-bot" element={<TrainBot />} />
          <Route path="/products/backtest" element={<Backtest />} />
          <Route path="/products/generate-data" element={<GenerateData />} />
          <Route path="/products/optimize-labeling" element={<OptimizeLabeling />} />

          {/* Tool pages */}
          <Route path="/tools/generator" element={<Generator />} />
          <Route path="/tools/trainer" element={<Trainer />} />
          <Route path="/tools/backtester" element={<Backtester />} />
          <Route path="/tools/optimizer" element={<Optimizer />} />

          {/* Fallback */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
