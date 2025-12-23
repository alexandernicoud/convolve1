import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface PinnedProduct {
  title: string;
  description: string;
  href: string;
  image?: string | null;
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

  // Total scroll distance: 500px per product
  const scrollPerCard = 500;
  const totalScrollHeight = products.length * scrollPerCard;

  useEffect(() => {
    const handleScroll = () => {
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // How far we've scrolled into this section
      // When rect.top = viewportHeight, we haven't entered yet (scrolled = 0)
      // When rect.top = 0, we're at the start of the pinned zone
      // When rect.bottom = viewportHeight, we're at the end
      const scrollableDistance = rect.height - viewportHeight;
      
      if (scrollableDistance <= 0) {
        setProgress(0);
        setActiveIndex(0);
        return;
      }

      // Calculate how far through the section we are
      const scrolled = -rect.top;
      const rawProgress = scrolled / scrollableDistance;
      const clampedProgress = Math.max(0, Math.min(1, rawProgress));

      setProgress(clampedProgress);

      // Determine which card is active
      const cardProgress = clampedProgress * products.length;
      const newIndex = Math.min(products.length - 1, Math.max(0, Math.floor(cardProgress)));
      setActiveIndex(newIndex);
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
    <div
      ref={containerRef}
      className="relative"
      style={{ height: `${totalScrollHeight + window.innerHeight}px` }}
    >
      {/* Sticky container - stays fixed in viewport while scrolling through section */}
      <div className="sticky top-0 left-0 w-full h-screen overflow-hidden">
        {/* Background to cover content behind */}
        <div className="absolute inset-0 bg-background" />

        <div className="relative h-full flex flex-col container-aligned">
          {/* Fixed title area */}
          <div className="pt-24 pb-8">
            <h2 className="text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            
            {/* Progress bar */}
            <div className="mt-6 h-1 w-full max-w-xl bg-border/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            
            {/* Step indicators */}
            <div className="mt-3 flex gap-2">
              {products.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    i === activeIndex ? "bg-primary scale-125" : "bg-border/60"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Card display area - centered vertically in remaining space */}
          <div className="flex-1 flex items-center justify-center pb-16">
            <div className="w-full max-w-4xl relative h-[320px] md:h-[280px]">
              {products.map((product, index) => {
                const isActive = index === activeIndex;
                // Alternate slide direction: even from right, odd from left
                const slideFromRight = index % 2 === 0;

                return (
                  <div
                    key={product.title}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      opacity: isActive ? 1 : 0,
                      transform: isActive
                        ? "translateX(0)"
                        : slideFromRight
                          ? "translateX(80px)"
                          : "translateX(-80px)",
                      transition: "opacity 0.7s ease-out, transform 0.7s ease-out",
                      pointerEvents: isActive ? "auto" : "none",
                    }}
                    aria-hidden={!isActive}
                  >
                    <article className="w-full bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6 md:p-8 shadow-lg">
                      <div className="flex flex-col md:flex-row gap-6">
                        {/* Image placeholder */}
                        <div className="md:w-2/5 aspect-[4/3] bg-secondary/30 rounded-lg flex items-center justify-center border border-border/30 flex-shrink-0 overflow-hidden">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={`${product.title} visual`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground/50">Visual</span>
                          )}
                        </div>

                        {/* Content */}
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
          </div>
        </div>
      </div>
    </div>
  );
}
