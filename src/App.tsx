import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "@/components/Header";
import Index from "./pages/Index";
import Vision from "./pages/Vision";
import Generator from "./pages/Generator";
import Trainer from "./pages/Trainer";
import Backtester from "./pages/Backtester";
import ProductPlaceholder from "./pages/ProductPlaceholder";
import Contact from "./pages/Contact";
import Docs from "./pages/Docs";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/vision" element={<Vision />} />
          <Route path="/products/generator" element={<Generator />} />
          <Route path="/products/trainer" element={<Trainer />} />
          <Route path="/products/backtester" element={<Backtester />} />
          <Route path="/products/:id" element={<ProductPlaceholder />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
