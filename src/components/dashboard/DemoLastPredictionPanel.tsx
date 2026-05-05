import heatmapImg from "@/assets/heatmap.png";
import { cn } from "@/lib/utils";

const HEAT = 130;
const DEMO = {
  symbol: "NVDA",
  model: "convolve_xl_v3.pt",
  tp: "+4.2%",
  sl: "−2.1%",
  confidence: "64%",
} as const;

export function DemoLastPredictionPanel() {
  return (
    <div className="border-t border-white/[0.06] pt-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">Last prediction</p>
      <div className="mt-1.5 flex flex-row items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2.5 text-[15px] leading-snug">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">Symbol</span>
            <span className="font-digits text-[18px] font-semibold text-white">{DEMO.symbol}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 text-[14px] text-white/40">Model</span>
            <span className="truncate text-right font-mono text-[13px] text-white/85">{DEMO.model}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">TP</span>
            <span className="font-digits text-[16px] text-white/85">{DEMO.tp}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">SL</span>
            <span className="font-digits text-[16px] text-white/70">{DEMO.sl}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/40">Confidence</span>
            <span className="font-digits text-[18px] text-white">{DEMO.confidence}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-white/35">Heatmap</p>
          <img
            src={heatmapImg}
            alt=""
            width={HEAT}
            height={HEAT}
            className={cn(
              "rounded border border-white/[0.14] object-cover",
              "bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
            )}
            style={{ width: HEAT, height: HEAT }}
          />
        </div>
      </div>
    </div>
  );
}
