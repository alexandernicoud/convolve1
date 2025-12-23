import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PinnedProduct {
  title: string;
  description: string;
  href: string;
  image?: string | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export default function PinnedProductCarousel({
  title,
  products,
}: {
  title: string;
  products: PinnedProduct[];
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const steps = Math.max(1, products.length);

  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  const [progress, setProgress] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const outerHeight = useMemo(() => `${steps * 100}vh`, [steps]);

  useEffect(() => {
    const handleResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let raf = 0;

    const handleScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const el = outerRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const scrollable = rect.height - viewportH;
        if (scrollable <= 0) {
          setProgress(0);
          setActiveIndex(0);
          return;
        }

        // 0 when section top hits viewport top, 1 when section bottom hits viewport bottom
        const raw = -rect.top / scrollable;
        const p = clamp01(raw);
        setProgress(p);

        // Map progress to 0..steps-1 with stable boundaries
        const idx = Math.min(
          steps - 1,
          Math.max(0, Math.floor(p * steps + 1e-6))
        );
        setActiveIndex(idx);
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [steps, viewportH]);

  return (
    <section
      ref={outerRef}
      className="relative"
      style={{ height: outerHeight }}
      aria-label="What we built pinned showcase"
    >
      {/* Sticky stage: stays in the viewport for the full scroll length */}
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* Background to cover content behind */}
        <div className="absolute inset-0 bg-background" />

        <div className="relative h-full container-aligned flex flex-col">
          {/* Pinned header (title + progress) */}
          <header className="pt-24 pb-8">
            <h2 className="text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>

            {/* Progress bar (5-step fill) */}
            <div className="mt-6 h-1 w-full max-w-xl bg-border/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            {/* Step indicators */}
            <div className="mt-3 flex gap-2" aria-label="Carousel steps">
              {products.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    i === activeIndex ? "bg-primary scale-125" : "bg-border/60"
                  }`}
                  aria-hidden="true"
                />
              ))}
            </div>
          </header>

          {/* Centered card viewport: only one visible at a time */}
          <main className="flex-1 flex items-center justify-center pb-16">
            <div className="w-full max-w-4xl relative h-[320px] md:h-[280px]">
              {products.map((product, index) => {
                const isActive = index === activeIndex;
                const entersFromRight = index % 2 === 0; // 1st,3rd,5th from right

                return (
                  <div
                    key={product.title}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      opacity: isActive ? 1 : 0,
                      transform: isActive
                        ? "translateX(0)"
                        : entersFromRight
                          ? "translateX(90px)"
                          : "translateX(-90px)",
                      transition:
                        "opacity 0.8s ease-out, transform 0.8s ease-out",
                      pointerEvents: isActive ? "auto" : "none",
                    }}
                    aria-hidden={!isActive}
                  >
                    <article className="w-full bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6 md:p-8 shadow-lg">
                      <div className="flex flex-col md:flex-row gap-6">
                        <div className="md:w-2/5 aspect-[4/3] bg-secondary/30 rounded-lg flex items-center justify-center border border-border/30 flex-shrink-0 overflow-hidden">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={`${product.title} visual`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground/50">
                              Visual
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col justify-center flex-grow">
                          <h3 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-foreground mb-3 leading-tight">
                            {product.title}
                          </h3>
                          <p className="text-muted-foreground mb-5 leading-relaxed text-sm md:text-base">
                            {product.description}
                          </p>
                          <Link
                            to={product.href}
                            className="btn-primary inline-flex items-center gap-2 w-fit"
                          >
                            Try now
                            <ArrowRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </div>
    </section>
  );
}
