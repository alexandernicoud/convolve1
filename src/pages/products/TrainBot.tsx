import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function TrainBot() {
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
              Train your own bot
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-8 opacity-0 animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              Build custom convolutional neural networks using your labeled
              datasets. Configure architecture, training parameters, and monitor
              the learning process with real-time metrics and visualizations.
            </p>

            <div
              className="opacity-0 animate-fade-up"
              style={{ animationDelay: "200ms" }}
            >
              <Link
                to="/tools/trainer"
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
              <h3 className="text-foreground font-medium mb-2">Upload datasets</h3>
              <p className="text-sm text-muted-foreground">
                Drag and drop your generated ZIP datasets to begin training.
              </p>
            </div>
            <div className="bg-card/50 border border-border rounded-xl p-6">
              <h3 className="text-foreground font-medium mb-2">
                Configure training
              </h3>
              <p className="text-sm text-muted-foreground">
                Set batch size, epochs, validation split, and other
                hyperparameters.
              </p>
            </div>
            <div className="bg-card/50 border border-border rounded-xl p-6">
              <h3 className="text-foreground font-medium mb-2">Analyze results</h3>
              <p className="text-sm text-muted-foreground">
                View accuracy curves, loss metrics, and model behavior analysis.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
