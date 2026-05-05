import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import trainBotVisual from "@/assets/train-bot-visual.png";

export default function TrainBot() {
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
                Train Your Own Bot
              </h1>
              <p
                className="text-lg text-muted-foreground leading-relaxed mb-8 opacity-0 animate-fade-up max-w-xl"
                style={{ animationDelay: "100ms" }}
              >
                Build custom convolutional neural networks using your labeled
                datasets. Configure architecture, training parameters, and monitor
                the learning process with real-time metrics and visualizations.
              </p>

              <div
                className="opacity-0 animate-fade-up mb-12"
                style={{ animationDelay: "200ms" }}
              >
                <Link
                  to="/tools/trainer"
                  className="px-6 py-2.5 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 inline-flex items-center gap-2"
                >
                  Try now
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Image below on mobile, hidden on lg */}
              <div className="lg:hidden aspect-[4/3] bg-secondary/30 rounded-xl border border-border/50 overflow-hidden mb-8">
                <img
                  src={trainBotVisual}
                  alt="Train your own bot visualization"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Right side - Image (desktop) + 2x2 grid */}
            <div className="lg:w-1/2 flex flex-col gap-8">
              {/* Image - visible on lg */}
              <div className="hidden lg:block aspect-[4/3] bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                <img
                  src={trainBotVisual}
                  alt="Train your own bot visualization"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Features - 2x2 grid */}
              <div
                className="grid grid-cols-2 gap-4 opacity-0 animate-fade-up"
                style={{ animationDelay: "300ms" }}
              >
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Upload Datasets</h3>
                  <p className="text-sm text-muted-foreground">
                    Drag and drop your generated ZIP datasets to begin training.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Configure Training</h3>
                  <p className="text-sm text-muted-foreground">
                    Set batch size, epochs, validation split, and other hyperparameters.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Monitor Progress</h3>
                  <p className="text-sm text-muted-foreground">
                    Track training metrics in real-time with live accuracy and loss curves.
                  </p>
                </div>
                <div className="bg-card/50 border border-border rounded-xl p-5">
                  <h3 className="text-foreground font-medium mb-2">Analyze Results</h3>
                  <p className="text-sm text-muted-foreground">
                    View accuracy curves, loss metrics, and model behavior analysis.
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
