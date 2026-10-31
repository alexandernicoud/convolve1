import { useEffect, useMemo, useRef, useState } from "react";
import { useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { SURVEY, contours, type Bounds } from "./TopoMap";

/**
 * The hypothesis-space sheet zoomed out: the route surveyed so far, routes other researchers could take,
 * and the planned work placed on ground nobody has surveyed yet.
 */

const VIEW: Bounds = { x0: -0.72, y0: -0.12, x1: 1.72, y1: 1.12 };
const vx = (x: number) => (x - VIEW.x0) / (VIEW.x1 - VIEW.x0);
const vy = (y: number) => (y - VIEW.y0) / (VIEW.y1 - VIEW.y0);

export type Planned = { x: number; y: number; title: string; body: string };

export const PLANNED: Planned[] = [
  { x: -0.4, y: 0.4, title: "Broader architectures", body: "Beyond CNNs: more model families and more kinds of input than a single chart." },
  { x: 1.42, y: 0.3, title: "Competitions", body: "Models ranked on the same held-out data nobody could tune on." },
  { x: 1.36, y: 0.92, title: "AI-assisted research", body: "An assistant that proposes experiments and argues with the results." },
];

/** Routes from surveyed ground outward. The first three end at planned work. */
const ROUTES: [number, number][][] = [
  [[0.22, 0.34], [0.02, 0.3], [-0.2, 0.44], [-0.4, 0.4]],
  [[0.79, 0.21], [1.0, 0.12], [1.22, 0.24], [1.42, 0.3]],
  [[0.83, 0.7], [1.05, 0.82], [1.2, 0.98], [1.36, 0.92]],
  [[0.17, 0.7], [-0.02, 0.86], [-0.24, 0.96], [-0.46, 0.9]],
  [[0.41, 0.27], [0.36, 0.08], [0.18, -0.02], [-0.06, 0.02]],
  [[0.61, 0.74], [0.68, 0.94], [0.9, 1.04], [1.12, 1.0]],
  [[0.63, 0.29], [0.82, 0.02], [1.08, -0.02], [1.3, 0.06]],
];

function at(route: [number, number][], t: number): [number, number] {
  const n = route.length - 1;
  const f = Math.min(n, Math.max(0, t * n));
  const i = Math.min(n - 1, Math.floor(f));
  const k = f - i;
  return [route[i][0] + (route[i + 1][0] - route[i][0]) * k, route[i][1] + (route[i + 1][1] - route[i][1]) * k];
}

export function FrontierMap({ className = "" }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const data = useMemo(() => contours(VIEW, 280, 150), []);
  const { scrollYProgress } = useScroll({ target: wrapRef, offset: ["start 0.9", "center 0.45"] });
  const [p, setP] = useState(reduce ? 1 : 0);
  useMotionValueEvent(scrollYProgress, "change", (v) => !reduce && setP(v));
  const progRef = useRef(p);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    progRef.current = p;
    redraw.current();
  }, [p]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let w = 0;
    let h = 0;
    let raf = 0;

    const draw = () => {
      raf = 0;
      if (!w || !h) return;
      const prog = progRef.current;
      const asp = h / w;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "rgba(255,255,255,0.07)";
      for (let y = 11; y < h; y += 22) for (let x = 11; x < w; x += 22) ctx.fillRect(x, y, 1, 1);

      const all = new Path2D();
      const segs = data.segs;
      for (let s = 0; s < segs.length; s += 5) {
        all.moveTo(segs[s] * w, segs[s + 1] * h);
        all.lineTo(segs[s + 2] * w, segs[s + 3] * h);
      }
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = "rgba(214,226,245,0.09)";
      ctx.stroke(all);

      ctx.save();
      ctx.beginPath();
      const r = 0.062 * w;
      for (const s of SURVEY) {
        ctx.moveTo(vx(s.x) * w + r, vy(s.y) * h);
        ctx.ellipse(vx(s.x) * w, vy(s.y) * h, r, r * Math.min(1.4, 1 / (asp * 1.6)), 0, 0, Math.PI * 2);
      }
      ctx.clip();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "rgba(214,226,245,0.42)";
      ctx.stroke(all);
      ctx.restore();

      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(185,211,255,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      SURVEY.forEach((s, k) => (k ? ctx.lineTo(vx(s.x) * w, vy(s.y) * h) : ctx.moveTo(vx(s.x) * w, vy(s.y) * h)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#b9d3ff";
      for (const s of SURVEY) {
        ctx.beginPath();
        ctx.arc(vx(s.x) * w, vy(s.y) * h, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ROUTES.forEach((route, i) => {
        const t = Math.min(1, Math.max(0, (prog - 0.08 * (i % 4)) / 0.62));
        if (t <= 0) return;
        const planned = i < PLANNED.length;
        ctx.setLineDash([1.5, 4]);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = planned ? "rgba(166,236,200,0.6)" : "rgba(255,255,255,0.32)";
        ctx.beginPath();
        const steps = 48;
        for (let k = 0; k <= steps; k++) {
          const [x, y] = at(route, (t * k) / steps);
          if (k) ctx.lineTo(vx(x) * w, vy(y) * h);
          else ctx.moveTo(vx(x) * w, vy(y) * h);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const [hx, hy] = at(route, t);
        if (!planned) {
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(vx(hx) * w - 4, vy(hy) * h);
          ctx.lineTo(vx(hx) * w + 4, vy(hy) * h);
          ctx.moveTo(vx(hx) * w, vy(hy) * h - 4);
          ctx.lineTo(vx(hx) * w, vy(hy) * h + 4);
          ctx.stroke();
        }
      });

      PLANNED.forEach((m, i) => {
        const a = Math.min(1, Math.max(0, (prog - 0.5 - 0.08 * i) / 0.2));
        if (a <= 0) return;
        const x = vx(m.x) * w;
        const y = vy(m.y) * h;
        ctx.globalAlpha = a;
        ctx.strokeStyle = "#a6ecc8";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        ctx.fillStyle = "#050506";
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    };
    redraw.current = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const ro = new ResizeObserver(() => {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw.current();
    });
    ro.observe(cv);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      redraw.current = () => {};
    };
  }, [data]);

  const cx = vx(0.5) * 100;
  return (
    <figure ref={wrapRef} className={`flex flex-col ${className}`}>
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
        <span>Sheet 02 · Unsurveyed ground</span>
        <span className="hidden sm:inline">Illustrative · community and roadmap are planned</span>
      </div>
      <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-[6px] border border-white/[0.1] bg-[#060708] sm:aspect-[2/1]">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none absolute -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#b9d3ff]/70"
          style={{ left: `${cx}%`, top: `${vy(0.5) * 100}%` }}
        >
          <span className="rounded-[3px] bg-[#060708]/80 px-1.5 py-0.5">Sheet 01 · surveyed</span>
        </div>
        {PLANNED.map((m, i) => (
          <div
            key={m.title}
            className="pointer-events-none absolute hidden w-[13.5rem] transition-opacity duration-500 md:block"
            style={{
              left: `${vx(m.x) * 100}%`,
              top: `${vy(m.y) * 100}%`,
              transform: `translate(${m.x < 0.5 ? "-18%" : "-82%"}, ${m.y > 0.6 ? "calc(-100% - 22px)" : "22px"})`,
              opacity: p > 0.55 + 0.08 * i || reduce ? 1 : 0,
            }}
          >
            <div className="rounded-[4px] border border-[#a6ecc8]/25 bg-[#050506]/90 px-2.5 py-2 backdrop-blur-sm">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[#a6ecc8]/80">Planned</div>
              <div className="mt-1 text-[13px] text-white">{m.title}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-white/55">{m.body}</div>
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 font-mono text-[10.5px] text-white/40">
        <span className="inline-flex items-center gap-2">
          <span className="h-px w-5 border-t border-dashed border-[#b9d3ff]/70" aria-hidden /> surveyed so far
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-px w-5 border-t border-dotted border-white/50" aria-hidden /> routes other researchers could take
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-px w-5 border-t border-dotted border-[#a6ecc8]/80" aria-hidden /> planned work
        </span>
      </figcaption>
      <ol className="mt-6 space-y-4 md:hidden">
        {PLANNED.map((m) => (
          <li key={m.title} className="border-t border-white/[0.08] pt-3">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[#a6ecc8]/80">Planned</div>
            <div className="mt-1 text-[15px] text-white">{m.title}</div>
            <div className="mt-0.5 text-[13.5px] leading-snug text-white/55">{m.body}</div>
          </li>
        ))}
      </ol>
    </figure>
  );
}
