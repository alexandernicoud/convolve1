import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import founderPortrait from "@/assets/founder-portrait.png";

export default function Founders() {
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

          {/* Page Title - Top Left */}
          <div className="max-w-3xl mb-16">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-semibold text-foreground mb-6 opacity-0 animate-fade-up tracking-tight">
              Founder
            </h1>
            <p
              className="text-xl text-muted-foreground opacity-0 animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              The person building visual intelligence for markets.
            </p>
          </div>

          {/* Founder Card */}
          <div
            className="max-w-5xl opacity-0 animate-fade-up"
            style={{ animationDelay: "200ms" }}
          >
            <div className="flex flex-col md:flex-row gap-10 p-8 bg-card/50 border border-border rounded-xl">
              {/* Portrait */}
              <div className="w-full md:w-80 flex-shrink-0 overflow-hidden rounded-lg">
                <img 
                  src={founderPortrait} 
                  alt="Alexander Nicoud"
                  className="w-full h-auto object-cover"
                />
              </div>

              {/* Bio */}
              <div className="flex flex-col justify-center">
                <h2 className="text-3xl font-semibold text-foreground mb-2">
                  Alexander Nicoud
                </h2>
                <p className="text-lg text-primary mb-6">Founder</p>
                <div className="space-y-5 text-lg text-foreground/90 leading-relaxed">
                  <p>
                    I am a young entrepreneur focused on building AI-driven software products from first principles. My work centers on developing visual machine-learning systems, including convolutional neural networks for chart-based analysis, where I design complete pipelines from data generation and labeling to model training and evaluation.
                  </p>
                  <p>
                    What began as a technical experiment has grown into a long-term entrepreneurial initiative aimed at enabling others to build and scale visual-based AI systems using structured training data. In parallel, I founded and lead my high school's startup club, bringing together ambitious students to collaborate on real projects, develop products, and gain hands-on experience in technology and entrepreneurship.
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
