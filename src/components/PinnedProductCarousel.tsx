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
    // Tight scroll: each product gets ~70vh of scroll distance
    const per = 70;
    return `${products.length * per}vh`;
  }, [products.length]);

  useEffect(() => {
    const handleScroll = () => {
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const viewport = window.innerHeight;
      const total = rect.height - viewport;
      const raw = total <= 0 ? 0 : (-rect.top / total);
      const p = clamp01(raw);

      const scaled = p * products.length;
      const idx = Math.min(products.length - 1, Math.floor(scaled));

      setActiveIndex(idx);
      setProgress(p);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [products.length]);

  return (
    <div ref={containerRef} className="relative" style={{ height: heightVh }}>
      <div className="sticky top-24 h-[calc(100vh-6rem)]">
        <div className="h-full flex flex-col">
          <div className="pt-4">
            <h2 className="text-5xl md:text-6xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            <div className="mt-4 h-1 w-full bg-border/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-[width] duration-150 ease-linear"
                style={{ width: `${progress * 100}%` }}
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-4xl relative">
              {products.map((product, index) => {
                const isActive = index === activeIndex;
                const slideFromRight = index % 2 === 0;

                return (
                  <div
                    key={product.title}
                    className={
                      "absolute inset-0 transition-all duration-500 ease-out" +
                      (isActive
                        ? " opacity-100 translate-x-0"
                        : slideFromRight
                          ? " opacity-0 translate-x-16 pointer-events-none"
                          : " opacity-0 -translate-x-16 pointer-events-none")
                    }
                    aria-hidden={!isActive}
                  >
                    <article className="bg-card/60 backdrop-blur-sm border border-border rounded-xl p-5 md:p-6">
                      <div className="flex flex-col md:flex-row gap-6">
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
                          <h3 className="text-4xl md:text-5xl font-semibold text-foreground mb-4 leading-[1.02]">
                            {product.title}
                          </h3>
                          <p className="text-muted-foreground mb-6 leading-relaxed text-base md:text-lg">
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
        </div>
      </div>
    </div>
  );
}
