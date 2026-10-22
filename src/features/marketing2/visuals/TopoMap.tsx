import { useEffect, useMemo, useRef } from "react";

/** A topographic sheet that is only drawn where it has been surveyed. Terrain is a hand-written function. */

type Survey = { x: number; y: number; q?: string };

export const SURVEY: Survey[] = [
  { x: 0.17, y: 0.7, q: "Can a CNN learn anything from a chart?" },
  { x: 0.29, y: 0.53 },
  { x: 0.22, y: 0.34 },
  { x: 0.41, y: 0.27, q: "Which labelling rule is worth learning?" },
  { x: 0.51, y: 0.45 },
  { x: 0.45, y: 0.66 },
  { x: 0.61, y: 0.74, q: "What does the model actually look at?" },
  { x: 0.69, y: 0.53 },
  { x: 0.63, y: 0.29, q: "Does it beat buy-and-hold after costs?" },
  { x: 0.79, y: 0.21 },
  { x: 0.84, y: 0.45 },
  { x: 0.83, y: 0.7, q: "Does it hold out of sample?" },
];

const PEAKS: [number, number, number, number][] = [
  [0.24, 0.3, 1.0, 0.02],
  [0.6, 0.55, 0.85, 0.035],
  [0.8, 0.24, 0.7, 0.014],
  [0.4, 0.76, 0.6, 0.025],
  [0.88, 0.78, -0.5, 0.03],
  [0.13, 0.82, 0.55, 0.01],
  [0.53, 0.18, -0.45, 0.02],
  [0.07, 0.14, 0.4, 0.012],
];

function terrain(x: number, y: number) {
  let v = 0.08 * Math.sin(9 * x + 3 * y) + 0.05 * Math.cos(7 * y - 4 * x);
  for (const [cx, cy, a, s] of PEAKS) v += a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s);
  return v;
}

const GW = 150;
const GH = 110;
const LEVELS = 24;

/** Marching squares over the unit square. Segments are [x1, y1, x2, y2, level]. */
function contours() {
  const W = GW + 1;
  const z = new Float32Array(W * (GH + 1));
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= GH; j++)
    for (let i = 0; i <= GW; i++) {
      const v = terrain(i / GW, j / GH);
      z[j * W + i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const out: number[] = [];
  for (let l = 1; l < LEVELS; l++) {
    const v = lo + ((hi - lo) * l) / LEVELS;
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const a = z[j * W + i];
        const b = z[j * W + i + 1];
        const c = z[(j + 1) * W + i + 1];
        const d = z[(j + 1) * W + i];
        const idx = (a > v ? 8 : 0) | (b > v ? 4 : 0) | (c > v ? 2 : 0) | (d > v ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const T = [i + (v - a) / (b - a), j];
        const R = [i + 1, j + (v - b) / (c - b)];
        const B = [i + (v - d) / (c - d), j + 1];
        const L = [i, j + (v - a) / (d - a)];
        const pairs: number[][][] =
          idx === 1 || idx === 14 ? [[L, B]]
          : idx === 2 || idx === 13 ? [[B, R]]
          : idx === 3 || idx === 12 ? [[L, R]]
          : idx === 4 || idx === 11 ? [[T, R]]
          : idx === 6 || idx === 9 ? [[T, B]]
          : idx === 7 || idx === 8 ? [[L, T]]
          : idx === 5 ? [[T, R], [L, B]]
          : [[L, T], [B, R]];
        for (const [p, q] of pairs) out.push(p[0] / GW, p[1] / GH, q[0] / GW, q[1] / GH, l);
      }
  }
  return { segs: new Float32Array(out), lo, hi };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function TopoMap({ progress, className = "" }: { progress: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progRef = useRef(progress);
  const redraw = useRef<() => void>(() => {});
  const data = useMemo(contours, []);

  const n = progress * SURVEY.length;
  const rev = SURVEY.map((_, k) => Math.min(1, Math.max(0, n - k)));
  const surveyed = rev.filter((r) => r >= 1).length;
  const last = Math.max(0, Math.ceil(n) - 1);
  const cur = SURVEY[Math.min(last, SURVEY.length - 1)];
  const elev = (terrain(cur.x, cur.y) - data.lo) / (data.hi - data.lo);

  useEffect(() => {
    progRef.current = progress;
    redraw.current();
  }, [progress]);

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
      const p = progRef.current * SURVEY.length;
      const r = SURVEY.map((_, k) => Math.min(1, Math.max(0, p - k)));
      const asp = h / w;
      const RAD = 0.15;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (let y = 11; y < h; y += 22) for (let x = 11; x < w; x += 22) ctx.fillRect(x, y, 1, 1);

      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = 1; t < 10; t++) {
        const x = Math.round((w * t) / 10) + 0.5;
        const y = Math.round((h * t) / 10) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 6);
        ctx.moveTo(x, h);
        ctx.lineTo(x, h - 6);
        ctx.moveTo(0, y);
        ctx.lineTo(6, y);
        ctx.moveTo(w, y);
        ctx.lineTo(w - 6, y);
        if (t % 2 === 0) {
          ctx.fillText(`${t / 10}`.replace(/^0/, ""), x + 3, 15);
          ctx.fillText(`${t / 10}`.replace(/^0/, ""), 9, y - 3);
        }
      }
      ctx.stroke();

      for (let k = 0; k < SURVEY.length; k++) {
        if (r[k] <= 0) continue;
        const s = SURVEY[k];
        const g = ctx.createRadialGradient(s.x * w, s.y * h, 0, s.x * w, s.y * h, RAD * w * 1.1);
        g.addColorStop(0, `rgba(185,211,255,${0.07 * r[k]})`);
        g.addColorStop(1, "rgba(185,211,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      const rad = r.map((v) => RAD * (0.35 + 0.65 * (1 - (1 - v) ** 3)));
      const mask = (x: number, y: number) => {
        let m = 0;
        for (let k = 0; k < SURVEY.length; k++) {
          if (r[k] <= 0) continue;
          const dx = x - SURVEY[k].x;
          const dy = (y - SURVEY[k].y) * asp;
          const v = r[k] * smooth(rad[k], rad[k] * 0.35, Math.hypot(dx, dy));
          if (v > m) m = v;
        }
        return m;
      };
      const BUCKETS = 5;
      const paths = Array.from({ length: BUCKETS * 2 }, () => new Path2D());
      const segs = data.segs;
      for (let s = 0; s < segs.length; s += 5) {
        const m = mask((segs[s] + segs[s + 2]) / 2, (segs[s + 1] + segs[s + 3]) / 2);
        if (m < 0.04) continue;
        const b = Math.min(BUCKETS - 1, Math.floor(m * BUCKETS));
        const major = segs[s + 4] % 5 === 0 ? 1 : 0;
        const path = paths[b * 2 + major];
        path.moveTo(segs[s] * w, segs[s + 1] * h);
        path.lineTo(segs[s + 2] * w, segs[s + 3] * h);
      }
      for (let b = 0; b < BUCKETS; b++) {
        const a = (b + 1) / BUCKETS;
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = `rgba(214,226,245,${0.3 * a})`;
        ctx.stroke(paths[b * 2]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(214,226,245,${0.62 * a})`;
        ctx.stroke(paths[b * 2 + 1]);
      }

      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(185,211,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < SURVEY.length && r[k] > 0; k++) {
        const s = SURVEY[k];
        if (k === 0) ctx.moveTo(s.x * w, s.y * h);
        else {
          const q = SURVEY[k - 1];
          const t = Math.min(1, r[k] * 2);
          ctx.lineTo((q.x + (s.x - q.x) * t) * w, (q.y + (s.y - q.y) * t) * h);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      for (let k = 0; k < SURVEY.length; k++) {
        if (r[k] <= 0) continue;
        const x = SURVEY[k].x * w;
        const y = SURVEY[k].y * h;
        ctx.globalAlpha = Math.min(1, r[k] * 1.5);
        ctx.strokeStyle = "#b9d3ff";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x + 6, y);
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y + 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#050506";
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillText(`S-${String(k + 1).padStart(2, "0")}`, x + 8, y + 12);
        ctx.globalAlpha = 1;
      }
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

  return (
    <figure className={`flex flex-col ${className}`}>
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
        <span>Sheet 01 · Hypothesis space</span>
        <span className="hidden sm:inline">Illustrative terrain</span>
      </div>
      <div className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-[6px] border border-white/[0.1] bg-[#060708]">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        {SURVEY.map((s, k) =>
          s.q ? (
            <div
              key={k}
              aria-hidden
              className="pointer-events-none absolute hidden max-w-[11.5rem] sm:block -translate-y-full pb-3 pl-3 transition-opacity duration-500"
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, opacity: rev[k] >= 0.6 ? 1 : 0 }}
            >
              <div className="rounded-[4px] border border-white/[0.12] bg-[#050506]/85 px-2.5 py-1.5 text-[11.5px] leading-snug text-white/80 backdrop-blur-sm">
                {s.q}
              </div>
            </div>
          ) : null,
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 font-mono text-[10.5px] text-white/40">
        <span className="tabular-nums">
          {n > 0
            ? `S-${String(last + 1).padStart(2, "0")} · x ${cur.x.toFixed(2)} · y ${cur.y.toFixed(2)} · z ${elev.toFixed(2)}`
            : "No survey points yet"}
        </span>
        <span className="tabular-nums">
          surveyed {surveyed}/{SURVEY.length} · the rest stays blank until it is tested
        </span>
      </figcaption>
    </figure>
  );
}
