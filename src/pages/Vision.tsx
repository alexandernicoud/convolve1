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
      {/* Content */}
      <div className="relative pt-32 pb-24">
        <div className="container-aligned">
          {/* Hero - Left Aligned */}
          <ScrollReveal>
            <div className="max-w-4xl mb-32">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-semibold text-foreground mb-10 tracking-tight">
                We Build Visual Intelligence for Markets
              </h1>
              <p className="text-2xl md:text-3xl text-foreground leading-relaxed">
                Infrastructure for discovering structure in price.
              </p>
            </div>
          </ScrollReveal>

          {/* The Idea */}
          <ScrollReveal delay={100}>
            <section className="max-w-4xl mb-32">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-primary mb-10">
                The Idea
              </h2>
              <div className="space-y-8 text-foreground text-xl md:text-2xl leading-relaxed">
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
            <section className="max-w-4xl mb-32">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-primary mb-10">
                Our Thesis
              </h2>
              <div className="bg-card/50 border border-border rounded-xl p-10">
                <p className="text-foreground text-xl md:text-2xl leading-relaxed">
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
            <section className="max-w-4xl">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-primary mb-10">
                The Method
              </h2>
              <div className="space-y-8 text-foreground text-xl md:text-2xl leading-relaxed">
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
                  This is research infrastructure — tools for exploration.
                </p>
              </div>
            </section>
          </ScrollReveal>
        </div>
      </div>
    </div>
  );
}
