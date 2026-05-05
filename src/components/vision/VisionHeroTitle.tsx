import { useEffect, useState } from "react";

const LINE1 = "Trade";
const LINE2 = "convolutional.*";
const TOTAL_CHARS = LINE1.length + LINE2.length;

/** ~1s total for the full headline */
const TITLE_DURATION_MS = 1000;
const CHAR_MS = Math.max(28, Math.round(TITLE_DURATION_MS / TOTAL_CHARS));

function classForCharIndex(i: number): string {
  if (i < 5) return "font-extralight";
  if (i < 18) return "font-normal";
  return "font-extralight text-white/90";
}

const FULL_LABEL = `${LINE1} ${LINE2}`;

/**
 * Landing hero H1 — two lines: “Trade” / “convolutional.*”, letters in sequence (~1s total).
 */
export function VisionHeroTitle() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setVisibleCount(TOTAL_CHARS);
      return;
    }
    setVisibleCount(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= TOTAL_CHARS) window.clearInterval(id);
    }, CHAR_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const line1Shown = Math.min(visibleCount, LINE1.length);
  const line2Shown = Math.max(0, visibleCount - LINE1.length);

  return (
    <h1
      aria-label={FULL_LABEL}
      className="relative z-[9999] max-w-full text-balance text-[100px] font-extralight leading-[1.08] tracking-[-0.03em] text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]"
    >
      <span className="block">
        {Array.from({ length: line1Shown }, (_, i) => (
          <span key={i} className={classForCharIndex(i)}>
            {LINE1[i] === " " ? "\u00A0" : LINE1[i]}
          </span>
        ))}
      </span>
      <span className="mt-2 block md:mt-1">
        {Array.from({ length: line2Shown }, (_, j) => {
          const i = LINE1.length + j;
          return (
            <span key={i} className={classForCharIndex(i)}>
              {LINE2[j]}
            </span>
          );
        })}
      </span>
    </h1>
  );
}

export const HERO_TITLE_DURATION_MS = TITLE_DURATION_MS;
