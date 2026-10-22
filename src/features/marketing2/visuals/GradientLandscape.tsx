import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { linePath, scale } from "../ui";

/*
 * Conceptual loss landscape. The function below is an illustrative two-parameter surface, not a
 * Convolve model: a real CNN's loss lives over millions of weights. Both trajectories are exact runs
 * of their update rule on this toy function, using its numerical gradient.
 */
const DOMAIN = 3;
function loss(x: number, y: number) {
  return (
    0.09 * (x * x + y * y) -
    1.25 * Math.exp(-((x - 1.3) ** 2 + (y + 0.9) ** 2) / 0.9) -
    0.8 * Math.exp(-((x + 1.5) ** 2 + (y - 1.2) ** 2) / 0.7) -
    0.45 * Math.exp(-((x + 0.6) ** 2 + (y + 1.8) ** 2) / 0.5) +
    0.18 * Math.sin(1.7 * x) * Math.cos(1.5 * y)
  );
}
function grad(x: number, y: number): [number, number] {
  const h = 1e-4;
  return [(loss(x + h, y) - loss(x - h, y)) / (2 * h), (loss(x, y + h) - loss(x, y - h)) / (2 * h)];
}

const LR = 0.05;
const BETA = 0.9;
const STEPS = 160;
const N = 46;
const PRESETS: { label: string; p: [number, number] }[] = [
  { label: "Ridge", p: [2.6, 2.5] },
  { label: "Plateau", p: [-2.6, -0.4] },
  { label: "Slope", p: [0.2, 2.7] },
];

type Step = { x: number; y: number; l: number };

function descend(start: [number, number], beta: number): Step[] {
  let [x, y] = start;
  let vx = 0;
  let vy = 0;
  const out: Step[] = [];
  for (let k = 0; k <= STEPS; k++) {
    out.push({ x, y, l: loss(x, y) });
    const [gx, gy] = grad(x, y);
    vx = beta * vx - LR * gx;
    vy = beta * vy - LR * gy;
    x = Math.max(-DOMAIN, Math.min(DOMAIN, x + vx));
    y = Math.max(-DOMAIN, Math.min(DOMAIN, y + vy));
  }
  return out;
}

function buildGrid() {
  const z: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const v = loss(-DOMAIN + (2 * DOMAIN * i) / N, -DOMAIN + (2 * DOMAIN * j) / N);
      z.push(v);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return { z, lo, hi };
}

/** Marching-squares segments for a set of iso-levels, in world coordinates. */
function contours(grid: { z: number[] }, levels: number[]) {
  const segs: { level: number; a: [number, number]; b: [number, number] }[] = [];
  const at = (i: number, j: number) => grid.z[j * (N + 1) + i];
  const wx = (i: number) => -DOMAIN + (2 * DOMAIN * i) / N;
  for (const lv of levels)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const p = [
          [wx(i), wx(j)],
          [wx(i + 1), wx(j)],
          [wx(i + 1), wx(j + 1)],
          [wx(i), wx(j + 1)],
        ];
        const hits: [number, number][] = [];
        for (let e = 0; e < 4; e++) {
          const a = c[e];
          const b = c[(e + 1) % 4];
          if ((a < lv) !== (b < lv)) {
            const t = (lv - a) / (b - a);
            const pa = p[e];
            const pb = p[(e + 1) % 4];
            hits.push([pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]);
          }
        }
        if (hits.length >= 2) segs.push({ level: lv, a: hits[0], b: hits[1] });
        if (hits.length === 4) segs.push({ level: lv, a: hits[2], b: hits[3] });
      }
  return segs;
}

const STOPS: [number, [number, number, number]][] = [
  [0, [226, 236, 255]],
  [0.12, [140, 176, 238]],
  [0.32, [58, 86, 140]],
  [0.58, [26, 34, 54]],
  [1, [12, 14, 19]],
];
function ramp(t: number): [number, number, number] {
  const v = Math.min(1, Math.max(0, t));
  for (let k = 1; k < STOPS.length; k++) {
    const [p1, c1] = STOPS[k];
    if (v <= p1) {
      const [p0, c0] = STOPS[k - 1];
      const u = (v - p0) / (p1 - p0);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const MOM = "#ffffff";
const GD = "#f2b366";

function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const paint = useCallback(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
    draw(ctx, size.current.w, size.current.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height };
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      paint();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [paint]);
  useEffect(() => {
    paint();
  }, [paint]);
  return ref;
}

export function GradientLandscape() {
  const reduce = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useMemo(buildGrid, []);
  const levels = useMemo(() => Array.from({ length: 14 }, (_, k) => grid.lo + ((grid.hi - grid.lo) * (k + 0.5)) / 14), [grid]);
  const segs = useMemo(() => contours(grid, levels), [grid, levels]);

  const [start, setStart] = useState<[number, number]>(PRESETS[0].p);
  const paths = useMemo(() => ({ gd: descend(start, 0), mom: descend(start, BETA) }), [start]);
  const [step, setStep] = useState(reduce ? STEPS : 0);
  const [yaw, setYaw] = useState(-0.62);
  const replay = useRef<number | null>(null);
  const drag = useRef<{ x: number; yaw: number } | null>(null);

  const { scrollYProgress } = useScroll({ target: wrap, offset: ["start 0.8", "end 0.55"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (reduce || replay.current != null) return;
    setStep(Math.round(Math.min(1, Math.max(0, v)) * STEPS));
  });
  useEffect(() => {
    if (reduce) setStep(STEPS);
  }, [reduce]);

  const runReplay = useCallback(() => {
    if (replay.current != null) cancelAnimationFrame(replay.current);
    if (reduce) {
      setStep(STEPS);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const f = Math.min(1, (now - t0) / 2600);
      setStep(Math.round(f * STEPS));
      replay.current = f < 1 ? requestAnimationFrame(tick) : null;
    };
    replay.current = requestAnimationFrame(tick);
  }, [reduce]);
  useEffect(() => () => {
    if (replay.current != null) cancelAnimationFrame(replay.current);
  }, []);

  const pick = (p: [number, number]) => {
    setStart(p);
    runReplay();
  };

  const range = grid.hi - grid.lo;

  const surface = useCanvas(
    (ctx, w, h) => {
      const PITCH = 0.98;
      const sinP = Math.sin(PITCH);
      const cosP = Math.cos(PITCH);
      const ZH = 1.25;
      const S = Math.min(w / 8, h / 5);
      const cx = w / 2;
      const cy = h * 0.74;
      const ca = Math.cos(yaw);
      const sa = Math.sin(yaw);
      const proj = (x: number, y: number, v: number) => {
        const xr = x * ca - y * sa;
        const yr = x * sa + y * ca;
        const z = Math.sqrt(Math.max(0, (v - grid.lo) / range)) * ZH;
        return { sx: cx + xr * S, sy: cy - yr * S * cosP - z * S * sinP * 1.15, d: yr };
      };
      ctx.clearRect(0, 0, w, h);
      const P = new Array((N + 1) * (N + 1));
      for (let j = 0; j <= N; j++)
        for (let i = 0; i <= N; i++) {
          const k = j * (N + 1) + i;
          P[k] = proj(-DOMAIN + (2 * DOMAIN * i) / N, -DOMAIN + (2 * DOMAIN * j) / N, grid.z[k]);
        }
      type Item = { d: number; quad?: number; seg?: [number, number]; path?: "gd" | "mom" };
      const items: Item[] = [];
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const k = j * (N + 1) + i;
          items.push({ d: (P[k].d + P[k + 1].d + P[k + N + 1].d + P[k + N + 2].d) / 4, quad: k });
        }
      const shown = Math.min(step, STEPS);
      const tp = {
        gd: paths.gd.slice(0, shown + 1).map((s) => proj(s.x, s.y, s.l + range * 0.012)),
        mom: paths.mom.slice(0, shown + 1).map((s) => proj(s.x, s.y, s.l + range * 0.012)),
      };
      for (const key of ["gd", "mom"] as const)
        for (let s = 0; s < tp[key].length - 1; s++) items.push({ d: (tp[key][s].d + tp[key][s + 1].d) / 2 - 0.06, seg: [s, s + 1], path: key });
      items.sort((a, b) => b.d - a.d);
      const lx = -0.45;
      const ly = 0.35;
      const lz = 0.82;
      ctx.lineJoin = "round";
      for (const it of items) {
        if (it.quad != null) {
          const k = it.quad;
          const a = P[k];
          const b = P[k + 1];
          const c = P[k + N + 2];
          const e = P[k + N + 1];
          const z00 = grid.z[k];
          const dzx = (grid.z[k + 1] - z00) / range;
          const dzy = (grid.z[k + N + 1] - z00) / range;
          const nl = Math.hypot(dzx * 9, dzy * 9, 1);
          const shade = Math.max(0.25, (-dzx * 9 * lx - dzy * 9 * ly + lz) / nl);
          const [r, g, bl] = ramp((z00 - grid.lo) / range);
          const m = 0.55 + 0.6 * shade;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.lineTo(c.sx, c.sy);
          ctx.lineTo(e.sx, e.sy);
          ctx.closePath();
          ctx.fillStyle = `rgb(${Math.min(255, r * m) | 0},${Math.min(255, g * m) | 0},${Math.min(255, bl * m) | 0})`;
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.055)";
          ctx.lineWidth = 0.6;
          ctx.stroke();
        } else if (it.seg && it.path) {
          const pts = tp[it.path];
          ctx.beginPath();
          ctx.moveTo(pts[it.seg[0]].sx, pts[it.seg[0]].sy);
          ctx.lineTo(pts[it.seg[1]].sx, pts[it.seg[1]].sy);
          ctx.strokeStyle = it.path === "mom" ? MOM : GD;
          ctx.globalAlpha = 0.45 + 0.55 * (it.seg[0] / Math.max(1, pts.length));
          ctx.lineWidth = it.path === "mom" ? 1.7 : 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      const st = proj(start[0], start[1], loss(start[0], start[1]) + range * 0.012);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(st.sx, st.sy, 3, 0, Math.PI * 2);
      ctx.fill();
      for (const key of ["gd", "mom"] as const) {
        const head = tp[key][tp[key].length - 1];
        const col = key === "mom" ? "255,255,255" : "242,179,102";
        const glow = ctx.createRadialGradient(head.sx, head.sy, 0, head.sx, head.sy, 14);
        glow.addColorStop(0, `rgba(${col},0.55)`);
        glow.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(head.sx, head.sy, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgb(${col})`;
        ctx.beginPath();
        ctx.arc(head.sx, head.sy, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      const ax = proj(DOMAIN, -DOMAIN, grid.lo);
      const ay = proj(-DOMAIN, DOMAIN, grid.lo);
      const o = proj(-DOMAIN, -DOMAIN, grid.lo);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(o.sx, o.sy);
      ctx.lineTo(ax.sx, ax.sy);
      ctx.moveTo(o.sx, o.sy);
      ctx.lineTo(ay.sx, ay.sy);
      ctx.stroke();
      ctx.fillText("θ₁", ax.sx + 6, ax.sy + 4);
      ctx.fillText("θ₂", ay.sx - 16, ay.sy - 4);
    },
    [grid, paths, step, yaw, start, range]
  );

  const contour = useCanvas(
    (ctx, W, H) => {
      const X = (x: number) => ((x + DOMAIN) / (2 * DOMAIN)) * W;
      const Y = (y: number) => H - ((y + DOMAIN) / (2 * DOMAIN)) * H;
      ctx.clearRect(0, 0, W, H);
      for (const s of segs) {
        const t = (s.level - grid.lo) / range;
        ctx.strokeStyle = t < 0.3 ? `rgba(185,211,255,${0.75 - t})` : `rgba(255,255,255,${0.3 - t * 0.2})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(X(s.a[0]), Y(s.a[1]));
        ctx.lineTo(X(s.b[0]), Y(s.b[1]));
        ctx.stroke();
      }
      const shown = Math.min(step, STEPS);
      for (const key of ["gd", "mom"] as const) {
        const pts = paths[key].slice(0, shown + 1);
        ctx.strokeStyle = key === "mom" ? MOM : GD;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.stroke();
        const hd = pts[pts.length - 1];
        ctx.fillStyle = key === "mom" ? MOM : GD;
        ctx.beginPath();
        ctx.arc(X(hd.x), Y(hd.y), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(X(start[0]), Y(start[1]), 5, 0, Math.PI * 2);
      ctx.stroke();
    },
    [segs, grid, paths, step, start, range]
  );

  const onContour = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 * DOMAIN - DOMAIN;
    const y = DOMAIN - ((e.clientY - r.top) / r.height) * 2 * DOMAIN;
    pick([Math.max(-2.9, Math.min(2.9, x)), Math.max(-2.9, Math.min(2.9, y))]);
  };

  const onDown = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, yaw };
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag.current) return;
    setYaw(drag.current.yaw + (e.clientX - drag.current.x) * 0.006);
  };
  const onUp = () => {
    drag.current = null;
  };

  const chart = useMemo(() => {
    const W = 240;
    const H = 90;
    const all = [...paths.gd, ...paths.mom].map((s) => s.l);
    const x = scale(0, STEPS, 4, W - 4);
    const y = scale(Math.min(...all), Math.max(...all), H - 6, 6);
    const shown = Math.min(step, STEPS);
    const line = (p: Step[]) => linePath(p.slice(0, shown + 1).map((s, i) => [x(i), y(s.l)]));
    return { W, H, gd: line(paths.gd), mom: line(paths.mom), cursor: x(shown) };
  }, [paths, step]);

  const s = Math.min(step, STEPS);
  const lg = paths.gd[s];
  const lm = paths.mom[s];

  return (
    <div ref={wrap} className="grid gap-5 lg:grid-cols-12 lg:gap-6">
      <div className="relative min-w-0 overflow-hidden rounded-[18px] border border-white/[0.08] bg-[radial-gradient(ellipse_at_50%_35%,#0d1220_0%,#06070a_70%)] lg:col-span-8">
        <canvas
          ref={surface}
          className="block h-[min(58vh,540px)] min-h-[320px] w-full cursor-grab touch-pan-y active:cursor-grabbing"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          role="img"
          aria-label="Illustrative loss surface over two parameters with plain gradient descent and momentum trajectories from the same start."
        />
        <div className="pointer-events-none absolute left-4 top-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45 sm:left-5 sm:top-5">
          Illustrative loss surface
        </div>
        <div className="pointer-events-none absolute right-4 top-4 hidden font-mono text-[10px] text-white/30 sm:right-5 sm:top-5 sm:block">Drag to turn · scroll to descend</div>
        <div className="pointer-events-none absolute bottom-4 left-4 flex gap-4 rounded-lg border border-white/[0.08] bg-black/55 px-3 py-2 font-mono text-[11px] tabular-nums text-white/70 backdrop-blur-sm sm:bottom-5 sm:left-5">
          <span>
            <span className="text-white/35">step </span>
            {String(s).padStart(3, "0")}
          </span>
          <span style={{ color: GD }}>
            <span className="opacity-60">GD </span>L {lg.l.toFixed(3)}
          </span>
          <span>
            <span className="text-white/45">momentum </span>L {lm.l.toFixed(3)}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
        <div className="rounded-[14px] border border-white/[0.08] bg-[#08090b] p-3.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
            <span>Contours · click to start</span>
            <button type="button" onClick={runReplay} className="inline-flex items-center gap-1 normal-case tracking-normal text-white/55 hover:text-white">
              <RotateCcw className="h-3 w-3" aria-hidden /> Replay
            </button>
          </div>
          <canvas ref={contour} onPointerDown={onContour} className="mt-2.5 block aspect-square w-full cursor-crosshair rounded-[8px] bg-black/40" aria-label="Contour map. Click to choose a starting point." />
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => pick(p.p)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                  start[0] === p.p[0] && start[1] === p.p[1] ? "border-white/60 text-white" : "border-white/[0.1] text-white/55 hover:text-white"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[14px] border border-white/[0.08] bg-[#08090b] p-3.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
            <span>Loss per step</span>
            <span className="flex gap-3 normal-case tracking-normal">
              <span style={{ color: GD }}>— gradient descent</span>
              <span className="text-white">— momentum</span>
            </span>
          </div>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="mt-2 block h-auto w-full" role="img" aria-label="Loss against step for both optimisers">
            <line x1={chart.cursor} x2={chart.cursor} y1="0" y2={chart.H} stroke="rgba(255,255,255,0.15)" />
            <path d={chart.gd} fill="none" stroke={GD} strokeWidth="1.4" />
            <path d={chart.mom} fill="none" stroke={MOM} strokeWidth="1.5" />
          </svg>
          <p className="mt-2 text-[12px] leading-snug text-white/45">
            Momentum carries velocity, so it overshoots and oscillates before settling. Plain descent creeps. Different starts reach different minima.
          </p>
        </div>
        <p className="font-mono text-[10.5px] leading-relaxed text-white/30">
          Hand-written two-parameter function. Learning rate {LR}, β = {BETA}. Not Convolve training data.
        </p>
      </div>
    </div>
  );
}
