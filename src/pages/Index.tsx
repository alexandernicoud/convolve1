import { Link } from "react-router-dom";
import { Database, Cpu, LineChart, ArrowRight } from "lucide-react";
import ProductCard from "@/components/ProductCard";

export default function Index() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative pt-32 pb-24 overflow-hidden">
        {/* Subtle background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-card pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="container-narrow relative">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground mb-6 opacity-0 animate-fade-up tracking-tight">
              visual intelligence for markets.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 opacity-0 animate-fade-up max-w-xl mx-auto" style={{ animationDelay: '100ms' }}>
              infrastructure for data, training, backtesting — not promises.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 opacity-0 animate-fade-up" style={{ animationDelay: '200ms' }}>
              <Link to="/products/generator" className="btn-primary inline-flex items-center gap-2">
                launch tools
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/vision" className="btn-secondary">
                read the vision
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section className="py-24 bg-gradient-to-b from-card to-background">
        <div className="container-wide">
          <div className="text-center mb-16 opacity-0 animate-fade-up">
            <h2 className="text-2xl md:text-3xl font-semibold text-foreground mb-4">
              The toolkit
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              End-to-end infrastructure for building and testing visual market models.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <ProductCard
              title="Generator"
              description="Create labeled candlestick chart datasets at scale. Generate thousands of training samples with configurable parameters."
              href="/products/generator"
              icon={<Database className="w-6 h-6" />}
              delay={100}
            />
            <ProductCard
              title="Trainer"
              description="Train convolutional neural networks on your generated datasets. Monitor progress and analyze model behavior."
              href="/products/trainer"
              icon={<Cpu className="w-6 h-6" />}
              delay={200}
            />
            <ProductCard
              title="Backtester"
              description="Validate model performance with comprehensive backtesting. Analyze returns, drawdowns, and risk metrics."
              href="/products/backtester"
              icon={<LineChart className="w-6 h-6" />}
              delay={300}
            />
          </div>
        </div>
      </section>

      {/* Footer spacer */}
      <div className="h-24" />
    </div>
  );
}
