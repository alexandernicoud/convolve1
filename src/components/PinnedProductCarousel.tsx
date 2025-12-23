import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PinnedProduct {
  title: string;
  description: string;
  href: string;
  image?: string | null;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export default function PinnedProductCarousel({
  title,
  products,
}: {
  title: string;
  products: PinnedProduct[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const heightVh = useMemo(() => {
    // This is the ONLY thing that scrolls: the section height.
    // The content is sticky, so it stays at the same screen position.
    const per = 90; // scroll distance per card
    return `${products.length * per}vh`;
  }, [products.length]);

  useEffect(() => {
    const handleScroll = () => {
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const viewport = window.innerHeight;
      const total = rect.height - viewport;
      const raw = total <= 0 ? 0 : -rect.top / total;
      const p = clamp01(raw);

      setProgress(p);

      const scaled = p * products.length;
      const idx = Math.min(products.length - 1, Math.floor(scaled));
      setActiveIndex(idx);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [products.length]);

  return (
    <div ref={containerRef} className="relative" style={{ height: heightVh }}>
      {/* Sticky = fixed in the viewer's screen while the section scrolls */}
      <div className="sticky top-0 h-screen">
        {/* Cover behind so it feels like nothing scrolls vertically */}
        <div className="absolute inset-0 bg-background/95" aria-hidden="true" />

        <div className="relative h-full flex flex-col">
          {/* Title stays in the exact same spot on screen */}
          <div className="pt-24 pb-6">
            <h2 className="text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            <div className="mt-6 h-1 w-full max-w-xl bg-border/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-[width] duration-150 ease-linear"
                style={{ width: `${progress * 100}%` }}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Card stays centered on screen; scrolling only swaps cards */}
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-4xl relative">
              {products.map((product, index) => {
                const isActive = index === activeIndex;
                const slideFromRight = index % 2 === 0;

                return (
                  <div
                    key={product.title}
                    className={
                      "absolute inset-0 transition-all duration-500 ease-out flex items-center" +
                      (isActive
                        ? " opacity-100 translate-x-0"
                        : slideFromRight
                          ? " opacity-0 translate-x-24 pointer-events-none"
                          : " opacity-0 -translate-x-24 pointer-events-none")
                    }
                    aria-hidden={!isActive}
                  >
                    <article className="w-full bg-card/60 backdrop-blur-sm border border-border rounded-xl p-5 md:p-6">
                      <div className="flex flex-col md:flex-row gap-5">
                        <div className="md:w-2/5 aspect-[4/3] bg-secondary/25 rounded-lg flex items-center justify-center border border-border/50 flex-shrink-0 overflow-hidden">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={`${product.title} product visual`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground/60">Visual</span>
                          )}
                        </div>

                        <div className="flex flex-col justify-center flex-grow">
                          <h3 className="text-3xl md:text-4xl font-semibold text-foreground mb-3 leading-[1.02]">
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
          </div>

          <div className="h-10" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
