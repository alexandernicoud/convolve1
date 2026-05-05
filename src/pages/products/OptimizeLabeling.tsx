import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import labelingOptimizerVisual from "@/assets/3D-CUBE.png";

export default function OptimizeLabeling() {
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
                Optimize Labeling Systems
              </h1>
              <p
                className="text-lg text-muted-foreground leading-relaxed mb-8 opacity-0 animate-fade-up max-w-xl"
                style={{ animationDelay: "100ms" }}
              >
                Fine-tune your labeling parameters to maximize model accuracy. Run
                optimization routines that search for optimal take-profit, stop-loss,
                and horizon configurations based on historical data.
              </p>

              <div
                className="opacity-0 animate-fade-up"
                style={{ animationDelay: "200ms" }}
              >
                <Link
                  to="/products/labeling-optimizer/technical"
                  className="px-6 py-2.5 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 inline-flex items-center gap-2"
                >
                  Try now
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Right side - preview + 2x2 grid */}
            <div className="lg:w-1/2 flex flex-col justify-center gap-6">
              <div className="rounded-2xl border border-border bg-card/40 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                <img
                  src={labelingOptimizerVisual}
                  alt="Labeling optimizer search space"
                  className="w-full rounded-xl border border-border/60"
                  loading="lazy"
                />
              </div>
              <div
                className="grid grid-cols-2 gap-4 opacity-0 animate-fade-up"
                style={{ animationDelay: "300ms" }}
              >
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Parameter Search</h3>
                  <p className="text-sm text-muted-foreground">
                    Grid or random search across labeling parameter space.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Objective Metrics</h3>
                  <p className="text-sm text-muted-foreground">
                    Optimize for accuracy, class balance, or custom objectives.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Export Configs</h3>
                  <p className="text-sm text-muted-foreground">
                    Save optimal parameter sets for use in data generation.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Visual Reports</h3>
                  <p className="text-sm text-muted-foreground">
                    View optimization results with interactive heatmaps and charts.
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
