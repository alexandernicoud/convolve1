import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface PinnedProduct {
  title: string;
  description: string;
  href: string;
  image?: string | null;
}

function ProductCard({
  product,
  index,
}: {
  product: PinnedProduct;
  index: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const entersFromRight = index % 2 === 0;

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className="min-h-[85vh] flex items-center justify-center px-6 md:px-12 lg:px-20"
    >
      <article
        className="w-full max-w-5xl"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible
            ? "translateX(0)"
            : `translateX(${entersFromRight ? "80px" : "-80px"})`,
          transition: "opacity 0.7s ease-out, transform 0.7s ease-out",
        }}
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
                <span className="text-sm text-muted-foreground/40">Visual</span>
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
    </div>
  );
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

  useEffect(() => {
    const handleScroll = () => {
      const section = sectionRef.current;
      if (!section) return;

      const cards = section.querySelectorAll("[data-card-index]");
      let currentIndex = 0;

      cards.forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        const viewportCenter = window.innerHeight / 2;
        if (rect.top < viewportCenter && rect.bottom > viewportCenter) {
          currentIndex = i;
        }
      });

      setActiveIndex(currentIndex);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div ref={sectionRef} className="relative">
      {/* Sticky header */}
      <div className="sticky top-16 md:top-20 z-10 bg-background/95 backdrop-blur-sm pt-8 pb-6 px-6 md:px-12 lg:px-20">
        <h2 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>

        {/* Progress bar */}
        <div className="mt-4 md:mt-6 h-1 w-full max-w-md bg-border/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${((activeIndex + 1) / products.length) * 100}%`,
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
      </div>

      {/* Cards - normal scroll with slide-in animations */}
      <div className="mt-8">
        {products.map((product, index) => (
          <div key={product.title} data-card-index={index}>
            <ProductCard product={product} index={index} />
          </div>
        ))}
      </div>
    </div>
  );
}
