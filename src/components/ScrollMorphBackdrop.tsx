import { useRef, useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type Props = { reducedMotion: boolean };

/**
 * Soft, rounded morphing fields (neutral white / gray) — scroll-driven.
 */
export function ScrollMorphBackdrop({ reducedMotion }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);
  const cRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (reducedMotion || !rootRef.current || !aRef.current || !bRef.current || !cRef.current) return;

    const ctx = gsap.context(() => {
      gsap.set(aRef.current, { xPercent: -15, yPercent: -8, scale: 1 });
      gsap.set(bRef.current, { xPercent: 25, yPercent: 18, scale: 0.85 });
      gsap.set(cRef.current, { xPercent: 10, yPercent: 55, scale: 1.1 });

      ScrollTrigger.create({
        start: 0,
        end: "max",
        scrub: 1.15,
        onUpdate: (self) => {
          const p = self.progress;
          gsap.set(aRef.current, {
            xPercent: -15 + p * 42,
            yPercent: -8 + p * 22,
            scale: 1 + p * 0.15,
          });
          gsap.set(bRef.current, {
            xPercent: 25 - p * 48,
            yPercent: 18 + p * 28,
            scale: 0.85 + p * 0.25,
          });
          gsap.set(cRef.current, {
            xPercent: 10 + p * 20,
            yPercent: 55 - p * 35,
            scale: 1.1 - p * 0.12,
          });
        },
      });
    }, rootRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <div ref={rootRef} className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        ref={aRef}
        className="absolute left-[22%] top-[16%] h-[min(100vw,760px)] w-[min(100vw,760px)] -translate-x-1/2 -translate-y-1/2 rounded-[42%] blur-[100px] will-change-transform"
        style={{
          background:
            "radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.09) 0%, rgba(250,250,252,0.04) 48%, transparent 72%)",
        }}
      />
      <div
        ref={bRef}
        className="absolute right-[-8%] top-[38%] h-[min(90vw,600px)] w-[min(90vw,600px)] rounded-[46%] blur-[95px] will-change-transform"
        style={{
          background:
            "radial-gradient(ellipse at 55% 45%, rgba(255,255,255,0.075) 0%, rgba(240,240,245,0.035) 52%, transparent 74%)",
        }}
      />
      <div
        ref={cRef}
        className="absolute bottom-[4%] left-[8%] h-[min(75vw,500px)] w-[min(75vw,500px)] rounded-[50%] blur-[80px] will-change-transform"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 58%, transparent 78%)",
        }}
      />
    </div>
  );
}
