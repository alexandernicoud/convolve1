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
        <div className="absolute inset-0 bg-gradient-to-br from-background via-[hsl(200,15%,6%)] to-[hsl(160,12%,7%)]" />

        {/* Mesh grid overlay */}
        <svg
          className="absolute inset-0 w-full h-full opacity-10"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
        >
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
          {/* Hero - Left Aligned */}
          <ScrollReveal>
            <div className="max-w-4xl mb-24">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-semibold text-foreground mb-8 tracking-tight">
                We Build Visual Intelligence for Markets
              </h1>
              <p className="text-xl md:text-2xl text-foreground/80 leading-relaxed">
                Infrastructure for discovering structure in price.
              </p>
            </div>
          </ScrollReveal>

          {/* The Idea */}
          <ScrollReveal delay={100}>
            <section className="max-w-3xl mb-24">
              <h2 className="text-lg font-medium tracking-wide text-primary mb-8">
                The Idea
              </h2>
              <div className="space-y-6 text-foreground/80 text-lg leading-relaxed">
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
            <section className="max-w-3xl mb-24">
              <h2 className="text-lg font-medium tracking-wide text-primary mb-8">
                Our Thesis
              </h2>
              <div className="bg-card/50 border border-border rounded-xl p-8">
                <p className="text-foreground/80 text-lg leading-relaxed">
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
            <section className="max-w-3xl">
              <h2 className="text-lg font-medium tracking-wide text-primary mb-8">
                The Method
              </h2>
              <div className="space-y-6 text-foreground/80 text-lg leading-relaxed">
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
