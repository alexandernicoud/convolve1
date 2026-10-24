import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { ChevronDown } from "lucide-react";
import logoMark from "@/assets/convolve-mark.png";
import { Container, EASE } from "../ui";
import { contours } from "./TopoMap";

const REVEAL_MS = 2600;

/** Contour lines of the About terrain, drawn outward from the centre. */
function ContourField({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(contours, []);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let w = 0;
    let h = 0;
    let raf = 0;
    let t0 = 0;
    const draw = (now: number) => {
      if (!t0) t0 = now;
      const f = reduce ? 1 : Math.min(1, (now - t0) / REVEAL_MS);
      const ease = 1 - (1 - f) ** 3;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy);
      const R = ease * maxR * 1.05;
      const segs = data.segs;
      const minor = new Path2D();
      const major = new Path2D();
      for (let s = 0; s < segs.length; s += 5) {
        const x1 = segs[s] * w;
        const y1 = segs[s + 1] * h;
        const d = Math.hypot((x1 - cx) * 0.8, y1 - cy);
        if (d > R || d < Math.min(w, h) * 0.17) continue;
        const path = segs[s + 4] % 5 === 0 ? major : minor;
        path.moveTo(x1, y1);
        path.lineTo(segs[s + 2] * w, segs[s + 3] * h);
      }
      const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.15, cx, cy, maxR);
      g.addColorStop(0, "rgba(214,226,245,0.55)");
      g.addColorStop(0.55, "rgba(214,226,245,0.28)");
      g.addColorStop(1, "rgba(214,226,245,0.04)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.7;
      ctx.globalAlpha = 0.55;
      ctx.stroke(minor);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.15;
      ctx.stroke(major);
      if (f < 1) raf = requestAnimationFrame(draw);
    };
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(cv);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [data, reduce]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

/** Survey rings around the mark: graduated outer ring, inner circles and a slow-turning bearing arc. */
function Rings({ reduce }: { reduce: boolean }) {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  const draw = (delay: number) =>
    reduce ? {} : { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1.8, ease: EASE, delay } };
  return (
    <svg viewBox="-400 -400 800 800" className="absolute left-1/2 top-1/2 h-[min(92vh,118vw)] w-[min(92vh,118vw)] -translate-x-1/2 -translate-y-1/2" aria-hidden>
      <defs>
        <linearGradient id="m2-al-arc" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#7fa8ff" />
          <stop offset="100%" stopColor="#a6ecc8" />
        </linearGradient>
        <radialGradient id="m2-al-clear">
          <stop offset="0%" stopColor="#050506" stopOpacity="1" />
          <stop offset="70%" stopColor="#050506" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#050506" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="190" fill="url(#m2-al-clear)" />
      <motion.circle r="150" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" {...draw(0.2)} />
      <motion.circle r="236" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="2 6" {...draw(0.35)} />
      <motion.g
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1, rotate: reduce ? 0 : 360 }}
        transition={{ opacity: { duration: 1.4, delay: 0.5 }, rotate: { duration: 240, ease: "linear", repeat: Infinity } }}
      >
        <circle r="330" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {ticks.map((a) => {
          const long = a % 30 === 0;
          const r1 = 330;
          const r2 = long ? 312 : 322;
          const rad = (a * Math.PI) / 180;
          return (
            <line
              key={a}
              x1={Math.cos(rad) * r1}
              y1={Math.sin(rad) * r1}
              x2={Math.cos(rad) * r2}
              y2={Math.sin(rad) * r2}
              stroke={long ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.18)"}
              strokeWidth="1"
            />
          );
        })}
        {[0, 90, 180, 270].map((a) => (
          <text
            key={a}
            x={Math.cos(((a - 90) * Math.PI) / 180) * 352}
            y={Math.sin(((a - 90) * Math.PI) / 180) * 352 + 3}
            textAnchor="middle"
            className="fill-white/35 font-mono text-[9px]"
          >
            {String(a).padStart(3, "0")}
          </text>
        ))}
      </motion.g>
      <motion.g
        animate={reduce ? undefined : { rotate: -360 }}
        transition={{ duration: 90, ease: "linear", repeat: Infinity }}
      >
        <circle r="236" fill="none" />
        <motion.path d="M 0 -236 A 236 236 0 0 1 204.4 -118" fill="none" stroke="url(#m2-al-arc)" strokeWidth="1.6" strokeLinecap="round" {...draw(0.9)} />
        <circle cx="204.4" cy="-118" r="3" fill="#a6ecc8" />
      </motion.g>
      <g stroke="rgba(255,255,255,0.14)" strokeWidth="1">
        <line x1="-400" x2="-200" y1="0" y2="0" />
        <line x1="200" x2="400" y1="0" y2="0" />
        <line x1="0" x2="0" y1="-400" y2="-200" />
        <line x1="0" x2="0" y1="200" y2="400" />
      </g>
    </svg>
  );
}

/** About landing: the mark at the centre of a surveyed field, "about." in the corner. */
export function AboutLanding() {
  const reduce = !!useReducedMotion();
  const px = useSpring(0, { stiffness: 40, damping: 20 });
  const py = useSpring(0, { stiffness: 40, damping: 20 });
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width - 0.5) * -18);
    py.set(((e.clientY - r.top) / r.height - 0.5) * -18);
  };
  return (
    <section className="relative isolate overflow-hidden bg-[#050506]" style={{ minHeight: "calc(100svh - 80px)" }} onPointerMove={onMove} aria-label="About — landing">
      <motion.div className="absolute -inset-6" style={{ x: px, y: py }}>
        <ContourField reduce={reduce} />
      </motion.div>
      <Rings reduce={reduce} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_65%_at_50%_50%,transparent_55%,#050506_100%)]" />

      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <motion.img
          src={logoMark}
          alt="Convolve"
          draggable={false}
          className="relative select-none"
          style={{ width: "min(34vw, 220px)", height: "auto", filter: "drop-shadow(0 0 40px rgba(185,211,255,0.16))" }}
          initial={reduce ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.1, ease: EASE }}
        />
      </div>

      <Container className="pointer-events-none relative flex min-h-[calc(100svh-80px)] flex-col justify-between py-8 md:py-10">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
          <span>About Convolve</span>
          <span className="hidden sm:inline">Sheet 00 · Survey origin</span>
        </div>
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <motion.h1
            className="font-extralight leading-[0.86] tracking-[-0.06em] text-white"
            style={{ fontSize: "clamp(72px, 13vw, 220px)" }}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.35, ease: EASE }}
          >
            about<span className="text-[#a6ecc8]">.</span>
          </motion.h1>
          <motion.div
            className="max-w-xs pb-3 md:text-right"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.8 }}
          >
            <p className="text-[15.5px] leading-relaxed text-white/60">A quantitative research laboratory for traders who would rather engineer an idea than trust one.</p>
            <a href="#chapters" className="pointer-events-auto mt-5 inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-white/45 transition-colors hover:text-white">
              Scroll
              <ChevronDown className="h-3.5 w-3.5 motion-safe:animate-bounce" aria-hidden />
            </a>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
