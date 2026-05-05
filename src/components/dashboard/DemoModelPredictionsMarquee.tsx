import { cn } from "@/lib/utils";

/** Previous 18px + 20px */
const BANNER_H = 38;
const SECTOR_W = 100;

/** One cell per model — 100px-wide sectors, duplicated for seamless loop (re-enters from the right). */
const SECTORS = [
  { model: "Convolve‑XL", line: "NVDA · L +62%" },
  { model: "Convolve‑S", line: "SPY · S 54%" },
  { model: "Ensemble‑A", line: "QQQ · L +58%" },
  { model: "Convolve‑XL", line: "EUR · S 51%" },
  { model: "Convolve‑S", line: "GLD · L 61%" },
  { model: "Ensemble‑B", line: "BTC · L +55%" },
  { model: "Convolve‑XL", line: "MSFT · S 49%" },
  { model: "Convolve‑S", line: "IWM · L 57%" },
] as const;

function Sector({ model, line }: { model: string; line: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center border-r border-white/[0.1] bg-black/[0.55] px-1 text-center leading-tight"
      )}
      style={{
        width: SECTOR_W,
        height: BANNER_H,
      }}
    >
      <span className="max-w-[92px] truncate font-sans text-[8px] font-semibold uppercase tracking-[0.06em] text-white/55">
        {model}
      </span>
      <span className="mt-0.5 max-w-[96px] truncate font-digits text-[11px] font-semibold tabular-nums text-white/92">
        {line}
      </span>
    </div>
  );
}

export function DemoModelPredictionsMarquee({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm border border-white/[0.13] bg-black/60",
        className
      )}
      style={{ height: BANNER_H }}
      role="region"
      aria-label="Live model predictions"
    >
      <div
        className={cn(
          "flex w-max will-change-transform animate-demo-marquee",
          "[backface-visibility:hidden]"
        )}
      >
        <div className="flex shrink-0">
          {SECTORS.map((s, i) => (
            <Sector key={`a-${i}`} model={s.model} line={s.line} />
          ))}
        </div>
        <div className="flex shrink-0" aria-hidden>
          {SECTORS.map((s, i) => (
            <Sector key={`b-${i}`} model={s.model} line={s.line} />
          ))}
        </div>
      </div>
    </div>
  );
}
