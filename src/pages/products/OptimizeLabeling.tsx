import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function OptimizeLabeling() {
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
            Optimize labeling systems
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-8">
            Fine-tune your labeling parameters to maximize model accuracy. 
            Run optimization routines that search for optimal take-profit, 
            stop-loss, and horizon configurations based on historical data.
          </p>
          
          <Link
            to="/tools/optimizer"
            className="btn-primary inline-flex items-center gap-2"
          >
            Try now
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Features preview */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Parameter search</h3>
            <p className="text-sm text-muted-foreground">
              Grid or random search across labeling parameter space.
            </p>
          </div>
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Objective metrics</h3>
            <p className="text-sm text-muted-foreground">
              Optimize for accuracy, class balance, or custom objectives.
            </p>
          </div>
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Export configs</h3>
            <p className="text-sm text-muted-foreground">
              Save optimal parameter sets for use in data generation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
