import { useRef, useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

const stroke = "rgba(139, 92, 246, 0.55)";
const strokeSoft = "rgba(139, 92, 246, 0.22)";
const glow = "rgba(139, 92, 246, 0.35)";

function useReveal(ref: React.RefObject<SVGElement>, reducedMotion: boolean) {
  useLayoutEffect(() => {
    if (reducedMotion || !ref.current) return;
    const paths = ref.current.querySelectorAll("path, line");
    const ctx = gsap.context(() => {
      gsap.set(paths, { opacity: 0 });
      ScrollTrigger.create({
        trigger: ref.current,
        start: "top 88%",
        once: true,
        onEnter: () => {
          gsap.to(paths, {
            opacity: 1,
            duration: 1.2,
            stagger: 0.05,
            ease: "power2.out",
          });
        },
      });
    }, ref);
    return () => ctx.revert();
  }, [ref, reducedMotion]);
}

function useRevealBars(ref: React.RefObject<SVGSVGElement>, reducedMotion: boolean) {
  useLayoutEffect(() => {
    if (reducedMotion || !ref.current) return;
    const root = ref.current;
    const rects = root.querySelectorAll("rect");
    const lines = root.querySelectorAll("line");
    const ctx = gsap.context(() => {
      gsap.set(rects, { opacity: 0 });
      gsap.set(lines, { opacity: 0 });
      ScrollTrigger.create({
        trigger: root,
        start: "top 88%",
        once: true,
        onEnter: () => {
          gsap.to(rects, {
            opacity: 0.38,
            duration: 0.9,
            stagger: 0.045,
            ease: "power2.out",
          });
          gsap.to(lines, { opacity: 1, duration: 0.6, ease: "power2.out", delay: 0.2 });
        },
      });
    }, root);
    return () => ctx.revert();
  }, [ref, reducedMotion]);
}

/** Abstract multi-series line chart, no real data. */
export function LineChartPlaceholder({
  className,
  reducedMotion,
}: {
  className?: string;
  reducedMotion: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  useReveal(svgRef, reducedMotion);

  return (
    <svg
      ref={svgRef}
      className={cn("h-full w-full max-h-[320px]", className)}
      viewBox="0 0 400 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="vglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={strokeSoft} />
          <stop offset="100%" stopColor={stroke} />
        </linearGradient>
      </defs>
      <path
        d="M 20 160 Q 80 140 120 150 T 200 120 T 280 90 T 380 70"
        stroke="url(#ln)"
        strokeWidth="1.25"
        filter="url(#vglow)"
        strokeLinecap="round"
        opacity={0}
      />
      <path
        d="M 20 180 L 100 175 L 160 185 L 240 150 L 320 160 L 380 140"
        stroke={stroke}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0}
      />
      <line x1="20" y1="195" x2="380" y2="195" stroke="rgba(255,255,255,0.06)" strokeWidth="1" opacity={0} />
    </svg>
  );
}

/** Minimal vertical bars. */
export function BarChartPlaceholder({
  className,
  reducedMotion,
}: {
  className?: string;
  reducedMotion: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  useRevealBars(svgRef, reducedMotion);

  const heights = [40, 72, 55, 88, 48, 95, 62, 78, 52, 68, 45, 82];
  const gap = 6;
  const bw = 18;
  const base = 180;

  return (
    <svg
      ref={svgRef}
      className={cn("h-full w-full max-h-[200px]", className)}
      viewBox="0 0 320 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="bglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={20 + i * (bw + gap)}
          y={base - h}
          width={bw}
          height={h}
          rx={2}
          fill={glow}
          opacity={0}
          filter="url(#bglow)"
        />
      ))}
      <line x1="12" y1={base} x2="308" y2={base} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
    </svg>
  );
}

/** Small sparkline for cards. */
export function SparklinePlaceholder({
  className,
  reducedMotion,
}: {
  className?: string;
  reducedMotion: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  useReveal(svgRef, reducedMotion);

  return (
    <svg
      ref={svgRef}
      className={cn("h-12 w-full", className)}
      viewBox="0 0 200 48"
      fill="none"
    >
      <path
        d="M 4 36 L 32 28 L 58 32 L 90 18 L 118 22 L 150 10 L 178 14 L 196 8"
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0}
        style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.15))" }}
      />
    </svg>
  );
}
