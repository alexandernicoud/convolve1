import { useEffect, useRef, useState } from "react";

export interface MetricCardItem {
  value: string;
  subtitle: string;
}

function AnimatedCounter({
  value,
  duration = 1000,
  isVisible = false
}: {
  value: string;
  duration?: number;
  isVisible?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState("0");

  useEffect(() => {
    if (!isVisible) {
      setDisplayValue("0");
      return;
    }

    // Extract numeric part and suffix
    const match = value.match(/^([\d,]+)(.*)$/);
    if (!match) {
      setDisplayValue(value);
      return;
    }

    const numericValue = parseInt(match[1].replace(/,/g, ''));
    const suffix = match[2];

    let startTime: number;
    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.floor(easedProgress * numericValue);

      setDisplayValue(currentValue.toLocaleString() + suffix);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [isVisible, value, duration]);

  return <span>{displayValue}</span>;
}

export default function MetricsCards({ 
  items,
  title = "By the Numbers"
}: { 
  items: MetricCardItem[];
  title?: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [animationKey, setAnimationKey] = useState(0);
  const [cardVisibility, setCardVisibility] = useState<boolean[]>(items.map(() => false));

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Trigger animation on every entry
          setAnimationKey(prev => prev + 1);
          setCardVisibility(items.map(() => false)); // Reset visibility

          // Stagger card reveals - faster timing
          items.forEach((_, index) => {
            setTimeout(() => {
              setCardVisibility(prev => {
                const newVisibility = [...prev];
                newVisibility[index] = true;
                return newVisibility;
              });
            }, index * 100);
          });
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [items.length]);

  return (
    <section ref={sectionRef} className="relative min-h-screen flex items-center py-24">
      <div className="container-aligned w-full">
        <h2 className="mb-12 text-4xl font-semibold tracking-tight text-white md:text-5xl lg:text-6xl">
          {title}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {items.map((item, index) => (
            <article
              key={`${item.value}-${animationKey}`}
              className={`p-8 md:p-10 bg-[#0a0a0a]/60 backdrop-blur-sm border border-white/8 rounded-xl transition-all duration-500 ${
                cardVisibility[index]
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-8"
              }`}
              style={{
                transitionDelay: cardVisibility[index] ? `${index * 100}ms` : "0ms"
              }}
            >
              <div className="text-5xl font-semibold tracking-tight text-white sm:text-6xl md:text-7xl">
                <AnimatedCounter
                  value={item.value}
                  isVisible={cardVisibility[index]}
                />
              </div>
              <div className="mt-4 text-base md:text-lg text-[#F5F5F5]/62 leading-relaxed">
                {item.subtitle}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
