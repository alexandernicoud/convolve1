import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";

type Props = {
  text: string;
  /** Second line — same h2, typed after the first line */
  line2?: string;
  /** Section in view — start / reset typing */
  active: boolean;
  className?: string;
};

const SECTION_TITLE_MS = 1000;

/**
 * Section h2: letters appear one after another (~1s total), same rhythm as hero title.
 */
export function VisionSectionTitle({ text, active, className = "", line2 }: Props) {
  const [n, setN] = useState(0);
  const reducedMotion = useReducedMotion();
  const totalLen = text.length + (line2?.length ?? 0);
  const charMs = useMemo(
    () => Math.max(20, Math.round(SECTION_TITLE_MS / Math.max(1, totalLen))),
    [totalLen]
  );

  useEffect(() => {
    if (!active) {
      setN(0);
      return;
    }
    if (reducedMotion) {
      setN(totalLen);
      return;
    }
    setN(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= totalLen) window.clearInterval(id);
    }, charMs);
    return () => window.clearInterval(id);
  }, [active, totalLen, charMs, reducedMotion]);

  const line1Shown = Math.min(n, text.length);
  const line2Shown = line2 ? Math.max(0, n - text.length) : 0;
  const ariaLabel = line2 ? `${text} ${line2}` : text;

  return (
    <h2 className={className} aria-label={ariaLabel}>
      <span className="block">
        {Array.from({ length: line1Shown }, (_, i) => (
          <span key={i} className="inline">
            {text[i] === " " ? "\u00A0" : text[i]}
          </span>
        ))}
      </span>
      {line2 ? (
        <span className="mt-2 block md:mt-1.5">
          {Array.from({ length: line2Shown }, (_, j) => {
            const i = text.length + j;
            return (
              <span key={i} className="inline">
                {line2[j] === " " ? "\u00A0" : line2[j]}
              </span>
            );
          })}
        </span>
      ) : null}
    </h2>
  );
}
