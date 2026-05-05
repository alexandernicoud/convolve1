import { useRef, useLayoutEffect, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

type SectionWrapperProps = {
  children: ReactNode;
  className?: string;
  /** Extra delay for staggered scenes */
  delay?: number;
  reducedMotion: boolean;
};

/**
 * Fade + slide-up on enter; respects reduced motion.
 */
export function SectionWrapper({
  children,
  className,
  delay = 0,
  reducedMotion,
}: SectionWrapperProps) {
  const ref = useRef<HTMLSectionElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, y: 56 },
        {
          opacity: 1,
          y: 0,
          duration: 1.05,
          delay,
          ease: "power2.out",
          scrollTrigger: {
            trigger: el,
            start: "top 88%",
            end: "top 40%",
            toggleActions: "play none none none",
          },
        }
      );
    }, el);

    return () => ctx.revert();
  }, [delay, reducedMotion]);

  return (
    <section ref={ref} className={cn(className)}>
      {children}
    </section>
  );
}
