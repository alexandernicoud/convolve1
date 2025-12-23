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
  const [progress, setProgress] = useState(0);
  const totalSteps = products.length;

  useEffect(() => {
    const handleScroll = () => {
      const section = sectionRef.current;
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const sectionHeight = section.offsetHeight;
      const viewportHeight = window.innerHeight;
      
      // Calculate how far we've scrolled through the section
      // When section top hits viewport top, scrolled = 0
      // When section bottom hits viewport bottom, scrolled = sectionHeight - viewportHeight
      const scrollableDistance = sectionHeight - viewportHeight;
      
      if (scrollableDistance <= 0) return;

      // How much of the section has scrolled past the top of viewport
      const scrolled = -rect.top;
      
      // Normalize to 0-1 range
      const rawProgress = scrolled / scrollableDistance;
      const clampedProgress = Math.max(0, Math.min(1, rawProgress));
      
      setProgress(clampedProgress);
      
      // Map progress to discrete index
      // progress 0 -> 0, progress 0.2 -> 1, etc.
      const newIndex = Math.min(
        totalSteps - 1,
        Math.max(0, Math.floor(clampedProgress * totalSteps))
      );
      
      setActiveIndex(newIndex);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Initial call
    
    return () => window.removeEventListener("scroll", handleScroll);
  }, [totalSteps]);

  return (
    <section
      ref={sectionRef}
      className="relative"
      style={{ height: `${totalSteps * 100}vh` }}
      aria-label="What we built pinned showcase"
    >
      {/* Sticky stage - stays in viewport while scrolling through section */}
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-background">
        <div className="h-full w-full flex flex-col">
          {/* Fixed header: title + progress */}
          <header className="pt-20 md:pt-24 pb-6 md:pb-8 px-6 md:px-12 lg:px-20">
            <h2 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>

            {/* Progress bar */}
            <div className="mt-4 md:mt-6 h-1 w-full max-w-md bg-border/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{
                  width: `${((activeIndex + 1) / totalSteps) * 100}%`,
                  transition: "width 0.4s ease-out",
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

          {/* Card viewport - centered, only one card visible */}
          <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20 pb-12">
            <div className="w-full max-w-5xl relative">
              {products.map((product, index) => {
                const isActive = index === activeIndex;
                // Alternating directions: even indices from right, odd from left
                const fromRight = index % 2 === 0;
                
                // Determine if this card is before or after active
                const isBefore = index < activeIndex;
                const isAfter = index > activeIndex;
                
                // Calculate horizontal offset for inactive cards
                let translateX = 0;
                if (!isActive) {
                  if (isBefore) {
                    translateX = fromRight ? -100 : 100;
                  } else if (isAfter) {
                    translateX = fromRight ? 100 : -100;
                  }
                }

                return (
                  <article
                    key={product.title}
                    className="absolute inset-0 w-full"
                    style={{
                      opacity: isActive ? 1 : 0,
                      transform: `translateX(${translateX}px)`,
                      transition: "opacity 0.7s ease-out, transform 0.7s ease-out",
                      pointerEvents: isActive ? "auto" : "none",
                      visibility: isActive ? "visible" : "hidden",
                    }}
                    aria-hidden={!isActive}
                  >
                    <div className="bg-card/80 backdrop-blur-sm border border-border/40 rounded-xl p-5 md:p-8 shadow-xl">
                      <div className="flex flex-col md:flex-row gap-5 md:gap-8">
                        {/* Image placeholder */}
                        <div className="md:w-2/5 aspect-[4/3] bg-secondary/20 rounded-lg flex items-center justify-center border border-border/20 flex-shrink-0 overflow-hidden">
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
    </section>
  );
}
