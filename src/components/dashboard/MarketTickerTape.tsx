import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const TV_SCRIPT = "https://widgets.tradingview-widget.com/w/en/tv-ticker-tape.js";
const SYMBOLS =
  "FOREXCOM:SPXUSD,FOREXCOM:NSXUSD,FOREXCOM:DJI,FX:EURUSD,BITSTAMP:BTCUSD,BITSTAMP:ETHUSD,CMCMARKETS:GOLD";

let tvTickerScriptPromise: Promise<void> | null = null;

function loadTradingViewTickerScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (tvTickerScriptPromise) return tvTickerScriptPromise;
  tvTickerScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TV_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("TradingView script failed")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.type = "module";
    s.src = TV_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("TradingView script failed"));
    document.head.appendChild(s);
  });
  return tvTickerScriptPromise;
}

export type MarketTickerTapeProps = {
  /** Smaller embed for tight sidebars (e.g. demo Operations column). */
  compact?: boolean;
  /** Clip bottom area so the TradingView “ticker tape” attribution line is not visible. */
  hideAttribution?: boolean;
  className?: string;
};

/**
 * TradingView ticker tape — dark container so the embed reads as part of the product chrome.
 */
export function MarketTickerTape({ compact = false, hideAttribution = false, className }: MarketTickerTapeProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let tapeEl: HTMLElement | null = null;

    void loadTradingViewTickerScript()
      .then(() => {
        if (cancelled || !host.isConnected) return;
        tapeEl = document.createElement("tv-ticker-tape");
        tapeEl.setAttribute("symbols", SYMBOLS);
        tapeEl.className = compact
          ? "block w-full min-h-[52px] scale-[1] origin-top"
          : "block w-full min-h-[42px]";
        host.appendChild(tapeEl);
      })
      .catch(() => {
        if (cancelled || !host.isConnected) return;
        host.innerHTML =
          '<p class="px-2 py-3 text-center text-[11px] text-white/70">Market data widget unavailable.</p>';
      });

    return () => {
      cancelled = true;
      tapeEl?.remove();
      host.innerHTML = "";
    };
  }, [compact]);

  if (hideAttribution && compact) {
    return (
      <div
        className={cn(
          "relative h-[60px] w-full min-h-[56px] overflow-hidden rounded-md border border-white/[0.1] bg-black",
          className
        )}
        style={{ colorScheme: "dark" }}
      >
        <div
          ref={hostRef}
          className="absolute inset-x-0 top-0 min-h-[72px] w-full overflow-hidden bg-black"
          style={{ colorScheme: "dark" }}
        />
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative w-full overflow-hidden rounded-md border border-white/[0.1] bg-black",
        compact ? "min-h-[64px]" : "min-h-[46px]",
        className
      )}
      style={{ colorScheme: "dark" }}
    />
  );
}
