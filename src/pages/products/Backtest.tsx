import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function Backtest() {
  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container-wide">
        {/* Back link */}
        <Link 
          to="/" 
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-12"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>

        {/* Hero */}
        <div className="max-w-2xl mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            Backtest your bot
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-8">
            Validate your trained models against historical market data. 
            Analyze returns, drawdowns, risk-adjusted metrics, and understand 
            how your strategy would have performed in real conditions.
          </p>
          
          <Link
            to="/tools/backtester"
            className="btn-primary inline-flex items-center gap-2"
          >
            Try now
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Features preview */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Load models</h3>
            <p className="text-sm text-muted-foreground">
              Upload your trained .keras or .h5 model files for testing.
            </p>
          </div>
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Run simulations</h3>
            <p className="text-sm text-muted-foreground">
              Configure capital, position sizing, and slippage parameters.
            </p>
          </div>
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Review metrics</h3>
            <p className="text-sm text-muted-foreground">
              CAGR, Sharpe ratio, max drawdown, win rate, and more.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
