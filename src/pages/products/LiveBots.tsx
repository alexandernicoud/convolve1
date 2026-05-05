import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function LiveBots() {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-4 pt-2">
        <div className="container-aligned flex min-h-0 flex-1 flex-col overflow-hidden">
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
                Access Live Trading Bots
              </h1>
              <p
                className="text-lg text-muted-foreground leading-relaxed mb-8 opacity-0 animate-fade-up max-w-xl"
                style={{ animationDelay: "100ms" }}
              >
                Connect to automated trading systems running in real-time. Monitor
                performance, manage positions, and observe your models making
                decisions in live market conditions.
              </p>

              {/* Coming Soon State */}
              <div
                className="opacity-0 animate-fade-up"
                style={{ animationDelay: "200ms" }}
              >
                <button
                  disabled
                  className="px-6 py-2.5 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 opacity-50 cursor-not-allowed inline-flex items-center gap-2"
                >
                  Coming soon
                </button>
              </div>
            </div>

            {/* Right side - 2x2 grid */}
            <div className="lg:w-1/2 flex flex-col justify-center">
              <div
                className="grid grid-cols-2 gap-4 opacity-0 animate-fade-up"
                style={{ animationDelay: "300ms" }}
              >
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Live Dashboard</h3>
                  <p className="text-sm text-muted-foreground">
                    Real-time performance monitoring with detailed execution logs.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Position Tracking</h3>
                  <p className="text-sm text-muted-foreground">
                    View open positions, P&L, and exposure across all assets.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Regime Awareness</h3>
                  <p className="text-sm text-muted-foreground">
                    Monitor how your bot adapts to changing market conditions.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Execution Quality</h3>
                  <p className="text-sm text-muted-foreground">
                    Track slippage, fill rates, and order execution metrics.
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
