import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function GenerateData() {
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
              Generate training data
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-8 opacity-0 animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              Create labeled candlestick chart datasets at scale. Configure
              symbols, timeframes, labeling parameters, and generate thousands of
              training samples ready for CNN training.
            </p>

            <div
              className="opacity-0 animate-fade-up"
              style={{ animationDelay: "200ms" }}
            >
              <Link
                to="/tools/generator"
                className="btn-primary inline-flex items-center gap-2"
              >
                Try now
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Features preview */}
          <div
            className="max-w-3xl ml-auto mr-0 md:mr-12 lg:mr-24 grid md:grid-cols-3 gap-6 opacity-0 animate-fade-up"
            style={{ animationDelay: "300ms" }}
          >
            <div className="bg-card/50 border border-border rounded-xl p-6">
              <h3 className="text-foreground font-medium mb-2">
                Multi-symbol support
              </h3>
              <p className="text-sm text-muted-foreground">
                Generate data across multiple trading pairs and assets.
              </p>
            </div>
            <div className="bg-card/50 border border-border rounded-xl p-6">
              <h3 className="text-foreground font-medium mb-2">
                Configurable labeling
              </h3>
              <p className="text-sm text-muted-foreground">
                Set take-profit, stop-loss, and horizon parameters.
              </p>
            </div>
            <div className="bg-card/50 border border-border rounded-xl p-6">
              <h3 className="text-foreground font-medium mb-2">Batch export</h3>
              <p className="text-sm text-muted-foreground">
                Download complete datasets as organized ZIP archives.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
