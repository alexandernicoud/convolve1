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
  const sectionRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState(0);
  const totalSteps = products.length;

  useEffect(() => {
    const handleScroll = () => {
      const section = sectionRef.current;
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const sectionHeight = section.offsetHeight;
      const viewportHeight = window.innerHeight;
      
      // Calculate scrollable distance (total height minus one viewport)
      const scrollableDistance = sectionHeight - viewportHeight;
      if (scrollableDistance <= 0) return;

      // How much we've scrolled into the section
      const scrolled = -rect.top;
      
      // Normalize to 0-1 range
      const rawProgress = scrolled / scrollableDistance;
      const clampedProgress = Math.max(0, Math.min(1, rawProgress));
      
      // Map progress to discrete index using explicit ranges
      // 0-20% → 0, 20-40% → 1, 40-60% → 2, 60-80% → 3, 80-100% → 4
      let newIndex: number;
      if (clampedProgress < 0.2) {
        newIndex = 0;
      } else if (clampedProgress < 0.4) {
        newIndex = 1;
      } else if (clampedProgress < 0.6) {
        newIndex = 2;
      } else if (clampedProgress < 0.8) {
        newIndex = 3;
      } else {
        newIndex = 4;
      }
      
      // Clamp to valid range
      newIndex = Math.min(totalSteps - 1, Math.max(0, newIndex));
      
      if (newIndex !== activeIndex) {
        setPrevIndex(activeIndex);
        setActiveIndex(newIndex);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    
    return () => window.removeEventListener("scroll", handleScroll);
  }, [totalSteps, activeIndex]);

  return (
    <div
      ref={sectionRef}
      className="relative"
      style={{ height: `${totalSteps * 100}vh` }}
    >
      {/* Sticky stage - locks to viewport */}
      <div className="sticky top-0 left-0 right-0 h-screen w-full overflow-hidden bg-background">
        <div className="h-full w-full flex flex-col">
          {/* Fixed header: title + progress - uses container padding */}
          <header className="pt-20 md:pt-24 pb-6 md:pb-8 px-6 md:px-12 lg:px-20">
            <h2 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>

            {/* Progress bar */}
            <div className="mt-4 md:mt-6 h-1 w-full max-w-md bg-border/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${((activeIndex + 1) / totalSteps) * 100}%`,
                }}
              />
            </div>

            {/* Step dots */}
            <div className="mt-3 flex gap-2">
              {products.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    i === activeIndex
                      ? "bg-primary scale-125"
                      : i < activeIndex
                        ? "bg-primary/50"
                        : "bg-border/50"
                  }`}
                />
              ))}
            </div>
          </header>

          {/* Card viewport - centered, one card at a time */}
          <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20 pb-12">
            <div className="w-full max-w-5xl relative h-[400px] md:h-[350px]">
              {products.map((product, index) => {
                const isActive = index === activeIndex;
                // Direction: even from right, odd from left
                const entersFromRight = index % 2 === 0;
                
                // Calculate transform based on state
                let translateX = 0;
                let opacity = 0;
                
                if (isActive) {
                  translateX = 0;
                  opacity = 1;
                } else if (index < activeIndex) {
                  // Card has passed - exit in opposite direction
                  translateX = entersFromRight ? -80 : 80;
                  opacity = 0;
                } else {
                  // Card is upcoming - waiting in entry position
                  translateX = entersFromRight ? 80 : -80;
                  opacity = 0;
                }

                return (
                  <article
                    key={product.title}
                    className="absolute inset-0 w-full"
                    style={{
                      opacity,
                      transform: `translateX(${translateX}px)`,
                      transition: "opacity 0.7s ease-out, transform 0.7s ease-out",
                      pointerEvents: isActive ? "auto" : "none",
                      visibility: isActive ? "visible" : "hidden",
                    }}
                    aria-hidden={!isActive}
                  >
                    <div className="bg-card/80 backdrop-blur-sm border border-border/40 rounded-xl p-5 md:p-8 shadow-xl h-full">
                      <div className="flex flex-col md:flex-row gap-5 md:gap-8 h-full">
                        {/* Image placeholder */}
                        <div className="md:w-2/5 aspect-[4/3] md:aspect-auto md:h-full bg-secondary/20 rounded-lg flex items-center justify-center border border-border/20 flex-shrink-0 overflow-hidden">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={`${product.title} visual`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground/40">
                              Visual
                            </span>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex flex-col justify-center flex-grow">
                          <h3 className="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-semibold text-foreground mb-2 md:mb-3 leading-tight">
                            {product.title}
                          </h3>
                          <p className="text-muted-foreground mb-4 md:mb-5 leading-relaxed text-sm md:text-base">
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
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
