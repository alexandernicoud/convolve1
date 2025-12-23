import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function LiveBots() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/20 to-background" />
        <div className="absolute top-1/3 right-1/4 w-[500px] h-[300px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative pt-32 pb-24">
        <div className="container-wide">
          {/* Back link */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-12"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>

          {/* Hero - Right Shifted */}
          <div className="max-w-2xl ml-auto mr-0 md:mr-12 lg:mr-24 mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6 opacity-0 animate-fade-up">
              Access live trading bots
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-8 opacity-0 animate-fade-up"
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
                className="btn-primary opacity-50 cursor-not-allowed inline-flex items-center gap-2"
              >
                Coming soon
              </button>
            </div>
          </div>

          {/* Placeholder content */}
          <div
            className="max-w-2xl ml-auto mr-0 md:mr-12 lg:mr-24 bg-card/50 border border-border rounded-xl p-12 text-center opacity-0 animate-fade-up"
            style={{ animationDelay: "300ms" }}
          >
            <p className="text-muted-foreground">
              Live trading bot access is currently in development. Check back soon.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
