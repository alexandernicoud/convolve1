import { useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { contours } from "./TopoMap";

/** Faint About-terrain contours behind the home hero, with one marked minimum. */
export function HeroContours() {
  const reduce = !!useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(contours, []);
  const { scrollYProgress } = useScroll({ target: wrap, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 90]);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const draw = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = r.width;
      const h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const minor = new Path2D();
      const major = new Path2D();
      const segs = data.segs;
      for (let s = 0; s < segs.length; s += 5) {
        const path = segs[s + 4] % 5 === 0 ? major : minor;
        path.moveTo(segs[s] * w, segs[s + 1] * h);
        path.lineTo(segs[s + 2] * w, segs[s + 3] * h);
      }
      ctx.strokeStyle = "rgba(214,226,245,1)";
      ctx.globalAlpha = 0.09;
      ctx.lineWidth = 0.7;
      ctx.stroke(minor);
      ctx.globalAlpha = 0.17;
      ctx.lineWidth = 1;
      ctx.stroke(major);
    };
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [data]);

  const mask = "radial-gradient(ellipse 75% 85% at 72% 30%, #000 25%, transparent 75%)";
  return (
    <div ref={wrap} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute inset-x-0 -top-10 bottom-0"
        style={{ y, WebkitMaskImage: mask, maskImage: mask }}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2.4, ease: "easeOut" }}
      >
        <canvas ref={ref} className="absolute inset-0 h-full w-full" />
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
          {[0.2, 0.4, 0.6, 0.8].map((f) => (
            <g key={f}>
              <line x1={`${f * 100}%`} x2={`${f * 100}%`} y1="0" y2="10" stroke="rgba(255,255,255,0.28)" />
              <line x1="99.4%" x2="100%" y1={`${f * 100}%`} y2={`${f * 100}%`} stroke="rgba(255,255,255,0.28)" />
            </g>
          ))}
        </svg>
        <div className="absolute left-[83%] top-[17%] hidden -translate-x-1/2 -translate-y-1/2 md:block">
          <span className="absolute left-1/2 top-1/2 h-px w-10 -translate-x-1/2 bg-white/25" />
          <span className="absolute left-1/2 top-1/2 h-10 w-px -translate-y-1/2 bg-white/25" />
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#a6ecc8]" />
          <span className="absolute left-4 top-3 whitespace-nowrap font-mono text-[10.5px] tracking-[0.12em] text-white/40">
            ∇L = 0
          </span>
        </div>
      </motion.div>
    </div>
  );
}
