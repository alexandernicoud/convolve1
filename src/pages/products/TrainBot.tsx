import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function TrainBot() {
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
            Train your own bot
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-8">
            Build custom convolutional neural networks using your labeled datasets. 
            Configure architecture, training parameters, and monitor the learning process 
            with real-time metrics and visualizations.
          </p>
          
          <Link
            to="/tools/trainer"
            className="btn-primary inline-flex items-center gap-2"
          >
            Try now
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Features preview */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Upload datasets</h3>
            <p className="text-sm text-muted-foreground">
              Drag and drop your generated ZIP datasets to begin training.
            </p>
          </div>
          <div className="bg-card/50 border border-border rounded-xl p-6">
            <h3 className="text-foreground font-medium mb-2">Configure training</h3>
            <p className="text-sm text-muted-foreground">
              Set batch size, epochs, validation split, and other hyperparameters.
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
  );
}
