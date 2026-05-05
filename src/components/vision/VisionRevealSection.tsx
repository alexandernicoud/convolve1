import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  id: string;
  sectionNumber: number;
  className?: string;
  children: (ctx: { revealed: boolean; reducedMotion: boolean }) => ReactNode;
};

/**
 * Scroll reveal: section fades/slides in when entering view; children can run typewriter when revealed.
 */
export function VisionRevealSection({ id, sectionNumber, className = "", children }: Props) {
  const ref = useRef<HTMLElement>(null);
  /** In view: drives reveal + typewriter replay each time the section is entered */
  const [revealed, setRevealed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (reducedMotion) {
      setRevealed(true);
      return;
    }

    /** Stricter viewport: more scroll before reveal / typewriter (cinematic pacing). */
    const io = new IntersectionObserver(
      ([entry]) => {
        setRevealed(entry.isIntersecting);
      },
      { threshold: 0.16, rootMargin: "0px 0px -35% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reducedMotion]);

  const num = String(sectionNumber).padStart(2, "0");

  return (
    <section
      ref={ref}
      id={id}
      className={`vision-snap-section relative z-[12] flex min-h-[100dvh] w-full flex-col scroll-mt-20 ${className}`}
    >
      <span
        className="pointer-events-none absolute right-4 top-20 z-[10] text-[clamp(2rem,7vw,4.5rem)] font-extralight leading-none tracking-[-0.06em] text-white/[0.18] md:right-8 md:top-24"
        aria-hidden
      >
        {num}
      </span>

      <div
        className={`vision-section-reveal-strong relative z-[3] flex min-h-0 flex-1 flex-col ${revealed ? "vision-section-reveal--in" : ""}`}
      >
        {children({ revealed, reducedMotion })}
      </div>
    </section>
  );
}
