import { useRef, useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type GlowLayerProps = {
  /** When true, skip motion. */
  reducedMotion: boolean;
};

/**
 * Atmospheric radial glows (white → transparent) that drift with scroll.
 */
export function GlowLayer({ reducedMotion }: GlowLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (reducedMotion || !rootRef.current || !aRef.current || !bRef.current) return;

    const ctx = gsap.context(() => {
      gsap.set(aRef.current, { xPercent: -20, yPercent: -10, scale: 1 });
      gsap.set(bRef.current, { xPercent: 30, yPercent: 20, scale: 0.9 });

      ScrollTrigger.create({
        start: 0,
        end: "max",
        scrub: 1.2,
        onUpdate: (self) => {
          const p = self.progress;
          gsap.set(aRef.current, {
            xPercent: -20 + p * 35,
            yPercent: -10 + p * 25,
            scale: 1 + p * 0.12,
          });
          gsap.set(bRef.current, {
            xPercent: 30 - p * 40,
            yPercent: 20 + p * 15,
            scale: 0.9 + p * 0.2,
          });
        },
      });
    }, rootRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <div
        ref={aRef}
        className="absolute left-1/2 top-1/3 h-[min(140vw,900px)] w-[min(140vw,900px)] -translate-x-1/2 -translate-y-1/2 rounded-full will-change-transform"
        style={{
          background:
            "radial-gradient(circle closest-side, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.15) 38%, transparent 72%)",
        }}
      />
      <div
        ref={bRef}
        className="absolute right-0 top-[55%] h-[min(100vw,640px)] w-[min(100vw,640px)] will-change-transform"
        style={{
          background:
            "radial-gradient(circle closest-side, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.15) 45%, transparent 70%)",
        }}
      />
    </div>
  );
}
