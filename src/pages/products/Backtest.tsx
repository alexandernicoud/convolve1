import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function Backtest() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="relative pt-32 pb-24">
        <div className="container-aligned">
          {/* Back link */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-12"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>

          <div className="flex flex-col lg:flex-row gap-12">
            {/* Left side - Title, description, CTA */}
            <div className="lg:w-1/2 flex flex-col">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground mb-8 opacity-0 animate-fade-up">
                Backtest Your Bot
              </h1>
              <p
                className="text-lg text-muted-foreground leading-relaxed mb-8 opacity-0 animate-fade-up max-w-xl"
                style={{ animationDelay: "100ms" }}
              >
                Validate your trained models against historical market data. Analyze
                returns, drawdowns, risk-adjusted metrics, and understand how your
                strategy would have performed in real conditions.
              </p>

              <div
                className="opacity-0 animate-fade-up"
                style={{ animationDelay: "200ms" }}
              >
                <Link
                  to="/tools/backtester"
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Try now
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Right side - 2x2 grid */}
            <div className="lg:w-1/2 flex flex-col justify-center">
              <div
                className="grid grid-cols-2 gap-4 opacity-0 animate-fade-up"
                style={{ animationDelay: "300ms" }}
              >
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Load Models</h3>
                  <p className="text-sm text-muted-foreground">
                    Upload your trained .keras or .h5 model files for testing.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Run Simulations</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure capital, position sizing, and slippage parameters.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Review Metrics</h3>
                  <p className="text-sm text-muted-foreground">
                    CAGR, Sharpe ratio, max drawdown, win rate, and more.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Compare Variants</h3>
                  <p className="text-sm text-muted-foreground">
                    Test multiple model versions side-by-side under identical conditions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
