import { useEffect, useRef, useState } from "react";

function ScrollReveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function Vision() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Animated Background with Green Gradient */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Base gradient - blue to green wash */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-[hsl(200,15%,6%)] to-[hsl(160,12%,7%)]" />

        {/* Layered wave fields */}
        <svg
          className="absolute inset-0 w-full h-full opacity-15"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient
              id="wave-gradient-1"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="hsl(152, 60%, 52%)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="hsl(152, 60%, 52%)" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id="wave-gradient-2"
              x1="100%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor="hsl(200, 50%, 50%)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="hsl(152, 60%, 52%)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Wave layer 1 */}
          <g className="animate-drift" style={{ animationDuration: "40s" }}>
            <path
              d="M0,450 Q360,350 720,450 T1440,450 L1440,900 L0,900 Z"
              fill="url(#wave-gradient-1)"
            />
          </g>

          {/* Wave layer 2 */}
          <g
            className="animate-drift"
            style={{ animationDuration: "35s", animationDelay: "-10s" }}
          >
            <path
              d="M0,500 Q360,400 720,500 T1440,500 L1440,900 L0,900 Z"
              fill="url(#wave-gradient-2)"
            />
          </g>

          {/* Mesh grid overlay */}
          <g opacity="0.08" stroke="hsl(152, 60%, 52%)" strokeWidth="0.5" fill="none">
            {Array.from({ length: 15 }).map((_, i) => (
              <line key={`h-${i}`} x1="0" y1={i * 60} x2="1440" y2={i * 60} />
            ))}
            {Array.from({ length: 25 }).map((_, i) => (
              <line key={`v-${i}`} x1={i * 60} y1="0" x2={i * 60} y2="900" />
            ))}
          </g>
        </svg>

        {/* Radial accent */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative pt-32 pb-24">
        <div className="container-wide">
          {/* Hero - Right Shifted */}
          <ScrollReveal>
            <div className="max-w-3xl ml-auto mr-0 md:mr-12 lg:mr-24 text-right mb-32">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground mb-6 tracking-tight">
                we build visual intelligence for markets.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground">
                infrastructure for discovering structure in price — not signals, not
                promises.
              </p>
            </div>
          </ScrollReveal>

          {/* The Idea */}
          <ScrollReveal delay={100}>
            <section className="max-w-2xl ml-auto mr-0 md:mr-12 lg:mr-24 mb-32">
              <h2 className="text-sm uppercase tracking-wider text-primary mb-8 text-right">
                The idea
              </h2>
              <div className="space-y-6 text-muted-foreground leading-relaxed text-right">
                <p>
                  Markets encode information visually. Price, time, and volume form
                  patterns that repeat across instruments and timeframes.
                </p>
                <p>
                  Traditional quant approaches reduce charts to numbers. We take the
                  opposite path: we train models that see markets the way traders do.
                </p>
                <p>
                  This is not about prediction. It is about perception — teaching
                  machines to recognize the visual fingerprints of market structure.
                </p>
              </div>
            </section>
          </ScrollReveal>

          {/* Our Thesis */}
          <ScrollReveal delay={200}>
            <section className="max-w-2xl ml-auto mr-0 md:mr-12 lg:mr-24 mb-32">
              <h2 className="text-sm uppercase tracking-wider text-primary mb-8 text-right">
                Our thesis
              </h2>
              <div className="bg-card/50 border border-border rounded-xl p-8">
                <p className="text-muted-foreground leading-relaxed text-right">
                  The future of systematic trading lies at the intersection of
                  computer vision and market microstructure. We believe that visual
                  representations of price action contain exploitable alpha that
                  cannot be captured by purely numerical methods. By treating
                  candlestick charts as images and applying modern deep learning
                  techniques, we can extract features that traditional quantitative
                  analysis overlooks.
                </p>
              </div>
            </section>
          </ScrollReveal>

          {/* The Method */}
          <ScrollReveal delay={300}>
            <section className="max-w-2xl ml-auto mr-0 md:mr-12 lg:mr-24">
              <h2 className="text-sm uppercase tracking-wider text-primary mb-8 text-right">
                The method
              </h2>
              <div className="space-y-6 text-muted-foreground leading-relaxed text-right">
                <p>
                  We generate labeled datasets from historical candlestick data.
                  Each image captures a window of price action, labeled by what
                  happened next.
                </p>
                <p>
                  Convolutional neural networks learn to recognize visual patterns
                  associated with specific outcomes. The models see what the numbers
                  miss.
                </p>
                <p>
                  This is research infrastructure — tools for exploration, not
                  promises of profit.
                </p>
              </div>
            </section>
          </ScrollReveal>
        </div>
      </div>
    </div>
  );
}
