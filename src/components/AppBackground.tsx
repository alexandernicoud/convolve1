import { useEffect, useRef, useState } from "react";

export default function GlobalBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollMorph, setScrollMorph] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
      setScrollMorph(window.scrollY / maxScroll);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const p = scrollMorph;

  const primaryLeft = 72 - p * 48;
  const primaryTop = 12 + p * 58;
  const primaryScale = 1 + p * 0.4;

  const secondaryLeft = 18 + p * 52;
  const secondaryTop = 65 - p * 45;
  const secondaryScale = 1.15 - p * 0.35;

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundColor: "#000000" }} />

      {/* Main white / cool glow — position morphs with scroll */}
      <div
        className="absolute rounded-full blur-[110px] will-change-transform transition-[left,top,transform,opacity] duration-[900ms] ease-[cubic-bezier(0.33,1,0.68,1)]"
        style={{
          width: "min(92vw, 560px)",
          height: "min(92vw, 560px)",
          left: `${primaryLeft}%`,
          top: `${primaryTop}%`,
          transform: `translate(-50%, -50%) scale(${primaryScale})`,
          opacity: 0.55 + p * 0.35,
          background:
            "radial-gradient(circle, rgba(255,255,255,0.2) 0%, rgba(245,245,245,0.08) 32%, rgba(180,180,180,0.04) 48%, transparent 70%)",
        }}
      />

      {/* Counter-glow for depth — drifts opposite */}
      <div
        className="absolute rounded-full blur-[90px] will-change-transform transition-[left,top,transform,opacity] duration-[900ms] ease-[cubic-bezier(0.33,1,0.68,1)]"
        style={{
          width: "min(55vw, 360px)",
          height: "min(55vw, 360px)",
          left: `${secondaryLeft}%`,
          top: `${secondaryTop}%`,
          transform: `translate(-50%, -50%) scale(${secondaryScale})`,
          opacity: 0.35 + (1 - p) * 0.2,
          background:
            "radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 40%, transparent 68%)",
        }}
      />

      {/* Soft brand tint (no stripes) */}
      <div
        className="absolute w-[min(80vw,420px)] h-[min(80vw,420px)] rounded-full blur-3xl opacity-[0.12] animate-pulse"
        style={{
          left: `${28 + p * 22}%`,
          top: `${40 + p * 15}%`,
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)",
          animationDuration: "10s",
        }}
      />
    </div>
  );
}
