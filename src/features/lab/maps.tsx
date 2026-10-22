import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import type { EncodedMap } from "./api";

/**
 * Attribution rendering. Map values arrive as 8-bit grayscale PNGs whose 0–255 range maps to the
 * stated [min, max]; colouring happens here so the server never bakes a palette into the data.
 *
 * Palettes avoid the chart's own colours (green/red candles, near-black wicks on white):
 *  - sequential: transparent → light blue → blue → violet (attention, saliency)
 *  - diverging: blue (negative) ↔ transparent ↔ orange (positive) (occlusion Δp, group differences)
 *  - gray: black → white (feature maps, shown on their own)
 */
export type Palette = "sequential" | "diverging" | "gray";

const SEQ: [number, number, number, number][] = [
  [0, 147, 197, 253],
  [0.5, 59, 130, 246],
  [1, 91, 33, 182],
];
const NEG: [number, number, number] = [37, 99, 235];
const POS: [number, number, number] = [234, 88, 12];

function seqColor(t: number): [number, number, number] {
  for (let i = 1; i < SEQ.length; i++) {
    if (t <= SEQ[i][0]) {
      const [t0, r0, g0, b0] = SEQ[i - 1];
      const [t1, r1, g1, b1] = SEQ[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  return [SEQ[SEQ.length - 1][1], SEQ[SEQ.length - 1][2], SEQ[SEQ.length - 1][3]];
}

export const PALETTE_CSS: Record<Palette, string> = {
  sequential: "linear-gradient(90deg, rgba(147,197,253,0) 0%, rgb(147,197,253) 15%, rgb(59,130,246) 50%, rgb(91,33,182) 100%)",
  diverging: "linear-gradient(90deg, rgb(37,99,235) 0%, rgba(37,99,235,0) 50%, rgba(234,88,12,0) 50%, rgb(234,88,12) 100%)",
  gray: "linear-gradient(90deg, #000 0%, #fff 100%)",
};

const decoded = new Map<string, Promise<ImageData>>();

/** Decode a base64 grayscale PNG into ImageData (cached by content). */
export function decodeMap(png: string): Promise<ImageData> {
  const hit = decoded.get(png);
  if (hit) return hit;
  const p = new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("canvas unavailable"));
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => reject(new Error("map decode failed"));
    img.src = `data:image/png;base64,${png}`;
  });
  if (decoded.size > 400) decoded.clear();
  decoded.set(png, p);
  return p;
}

function colourize(src: ImageData, palette: Palette, opacity: number): ImageData {
  const out = new ImageData(src.width, src.height);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = src.data[i] / 255;
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    if (palette === "sequential") {
      [r, g, b] = seqColor(v);
      a = Math.min(1, v * 1.25) ** 0.85 * opacity;
    } else if (palette === "diverging") {
      const s = v * 2 - 1;
      [r, g, b] = s < 0 ? NEG : POS;
      a = Math.min(1, Math.abs(s) * 1.2) * opacity;
    } else {
      r = g = b = v * 255;
      a = 1;
    }
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
    out.data[i + 3] = Math.round(a * 255);
  }
  return out;
}

/** Fetch an authenticated asset and expose it as an object URL. */
export function useAuthedObjectUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchApi(path);
        if (!res.ok) throw new Error(String(res.status));
        objectUrl = URL.createObjectURL(await res.blob());
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url;
}

function useLoadedImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = src;
  }, [src]);
  return img;
}

export type Rect = [number, number, number, number];

/**
 * Base image with an aligned attribution overlay. The map is stretched over the full image extent
 * with bilinear smoothing (the same convention used when the server upsamples Grad-CAM).
 */
export function MapCanvas({
  base,
  map,
  palette = "sequential",
  opacity = 0.7,
  thirds = false,
  rect,
  background = "#ffffff",
  className,
  label,
}: {
  base?: string | null;
  map?: EncodedMap | null;
  palette?: Palette;
  opacity?: number;
  thirds?: boolean;
  rect?: Rect | null;
  background?: string;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const baseImg = useLoadedImage(base ?? null);
  const [mapData, setMapData] = useState<ImageData | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!map?.png) {
      setMapData(null);
      return;
    }
    decodeMap(map.png)
      .then((d) => alive && setMapData(d))
      .catch(() => alive && setMapData(null));
    return () => {
      alive = false;
    };
  }, [map?.png]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(width * dpr);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, px, px);
    if (baseImg) ctx.drawImage(baseImg, 0, 0, px, px);
    if (mapData) {
      const layer = document.createElement("canvas");
      layer.width = mapData.width;
      layer.height = mapData.height;
      layer.getContext("2d")?.putImageData(colourize(mapData, palette, palette === "gray" ? 1 : opacity), 0, 0);
      ctx.drawImage(layer, 0, 0, px, px);
    }
    if (thirds) {
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.lineWidth = dpr;
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(f * px, 0);
        ctx.lineTo(f * px, px);
        ctx.moveTo(0, f * px);
        ctx.lineTo(px, f * px);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (rect) {
      const [x0, y0, x1, y1] = rect;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 3 * dpr]);
      ctx.strokeRect(x0 * px, y0 * px, (x1 - x0) * px, (y1 - y0) * px);
      ctx.setLineDash([]);
    }
  }, [width, baseImg, mapData, palette, opacity, thirds, rect, background]);

  return (
    <div ref={wrap} className={className}>
      <canvas ref={ref} role="img" aria-label={label ?? "Attribution map"} className="block aspect-square w-full rounded-lg" style={{ width: "100%", height: width || undefined }} />
    </div>
  );
}

/** Colour scale with the numeric range it encodes and the normalization used. */
export function MapScale({ palette, min, max, format, lowLabel, highLabel, note }: { palette: Palette; min: number; max: number; format: (v: number) => string; lowLabel?: string; highLabel?: string; note?: string }) {
  return (
    <div className="space-y-1">
      <div className="h-2 w-full rounded-full border border-white/10" style={{ background: PALETTE_CSS[palette] }} />
      <div className="flex justify-between font-digits text-[11.5px] tabular-nums text-white/50">
        <span>
          {format(min)}
          {lowLabel ? <span className="ml-1 font-sans text-white/35">{lowLabel}</span> : null}
        </span>
        <span>
          {highLabel ? <span className="mr-1 font-sans text-white/35">{highLabel}</span> : null}
          {format(max)}
        </span>
      </div>
      {note ? <p className="text-[12px] leading-snug text-white/40">{note}</p> : null}
    </div>
  );
}
