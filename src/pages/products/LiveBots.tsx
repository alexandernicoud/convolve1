import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function LiveBots() {
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
            Access live trading bots
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-8">
            Connect to automated trading systems running in real-time. Monitor performance, 
            manage positions, and observe your models making decisions in live market conditions.
          </p>
          
          {/* Coming Soon State */}
          <button
            disabled
            className="btn-primary opacity-50 cursor-not-allowed inline-flex items-center gap-2"
          >
            Coming soon
          </button>
        </div>

        {/* Placeholder content */}
        <div className="bg-card/50 border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground">
            Live trading bot access is currently in development. Check back soon.
          </p>
        </div>
      </div>
    </div>
  );
}
