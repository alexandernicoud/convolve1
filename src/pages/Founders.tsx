import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Founders() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/20 to-background" />
        <div className="absolute top-1/4 right-1/4 w-[600px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
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

          {/* Page Title */}
          <div className="max-w-3xl ml-auto mr-0 md:mr-12 lg:mr-24 mb-20">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground mb-6 opacity-0 animate-fade-up tracking-tight">
              Founders
            </h1>
            <p
              className="text-lg text-muted-foreground opacity-0 animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              The people building visual intelligence for markets.
            </p>
          </div>

          {/* Founder Card */}
          <div
            className="max-w-4xl ml-auto mr-0 md:mr-12 lg:mr-24 opacity-0 animate-fade-up"
            style={{ animationDelay: "200ms" }}
          >
            <div className="flex flex-col md:flex-row gap-8 p-8 bg-card/50 border border-border rounded-xl">
              {/* Portrait Placeholder */}
              <div className="w-full md:w-64 h-80 md:h-auto bg-secondary/30 rounded-lg flex items-center justify-center border border-border/50 flex-shrink-0">
                <span className="text-sm text-muted-foreground/50">Portrait</span>
              </div>

              {/* Bio */}
              <div className="flex flex-col justify-center">
                <h2 className="text-2xl font-semibold text-foreground mb-2">
                  Alexander Nicoud
                </h2>
                <p className="text-sm text-primary mb-4">Founder</p>
                <div className="space-y-4 text-muted-foreground leading-relaxed">
                  <p>
                    Alexander is a quantitative researcher and engineer with a background
                    in applied mathematics and machine learning. His work focuses on the
                    intersection of computer vision and financial markets.
                  </p>
                  <p>
                    Before founding convolve, he developed systematic trading strategies
                    and built infrastructure for algorithmic trading systems. He holds
                    degrees in mathematics and computer science.
                  </p>
                  <p>
                    Alexander believes that visual representations of market data contain
                    structure that traditional quantitative methods fail to capture, and
                    that convolutional neural networks are uniquely suited to extract
                    this information.
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
