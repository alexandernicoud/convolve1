import { AuthorizedImage } from "@/components/AuthorizedImage";
import heatmapImg from "@/assets/heatmap.png";
import { demoLinkClass } from "@/components/dashboard/demoPortfolioPalette";
import { cn } from "@/lib/utils";

const HEAT = 130;
const DEMO = {
  symbol: "NVDA",
  model: "convolve_xl_v3.pt",
  tp: "+4.2%",
  sl: "−2.1%",
  confidence: "64%",
} as const;

type LivePrediction = {
  symbol?: string | null;
  model?: string | null;
  tp?: string | null;
  sl?: string | null;
  confidence?: string | null;
  heatmapSrc?: string | null;
  botHref?: string | null;
};

export function DemoLastPredictionPanel({ live }: { live?: LivePrediction | null } = {}) {
  const symbol = live?.symbol ?? DEMO.symbol;
  const model = live?.model ?? DEMO.model;
  const tp = live?.tp ?? DEMO.tp;
  const sl = live?.sl ?? DEMO.sl;
  const confidence = live?.confidence ?? DEMO.confidence;
  const heatSrc = live?.heatmapSrc ?? heatmapImg;
  const botHref = live?.botHref;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">Latest analysis</p>
        {botHref ? (
          <Link to={botHref} className={cn("text-[11px] font-semibold", demoLinkClass)}>
            Open bot →
          </Link>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-row items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2.5 text-[15px] leading-snug">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">Symbol</span>
            <span className="font-digits text-[18px] font-semibold text-white">{symbol || "—"}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 text-[14px] text-white/40">Model</span>
            <span className="truncate text-right font-mono text-[13px] text-white/85">{model || "—"}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">TP</span>
            <span className="font-digits text-[16px] text-white/85">{tp || "—"}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">SL</span>
            <span className="font-digits text-[16px] text-white/70">{sl || "—"}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">Confidence</span>
            <span className="font-digits text-[18px] text-white">{confidence || "—"}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-white/35">Heatmap</p>
          {heatSrc ? (
            <AuthorizedImage
              key={heatSrc}
              src={heatSrc}
              alt=""
              width={HEAT}
              height={HEAT}
              className={cn(
                "rounded border border-white/[0.14] object-cover",
                "bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
              )}
              style={{ width: HEAT, height: HEAT }}
            />
          ) : (
            <div
              className="rounded border border-white/[0.14] bg-black"
              style={{ width: HEAT, height: HEAT }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
