import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const I = ({ children }: { children: ReactNode }) => <i>{children}</i>;

export function Sum({ sub, sup }: { sub: ReactNode; sup?: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle leading-none">
      {sup ? <span className="text-[0.55em] text-white/60">{sup}</span> : null}
      <span className="text-[1.25em]">Σ</span>
      <span className="text-[0.55em] text-white/60">{sub}</span>
    </span>
  );
}

export function Frac({ n, d }: { n: ReactNode; d: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle text-[0.8em] leading-tight">
      <span className="border-b border-white/50 px-0.5">{n}</span>
      <span className="px-0.5">{d}</span>
    </span>
  );
}

/** One-line equation that keeps its font size until it would overflow its column, then shrinks to fit. */
export function FitLine({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const b = box.current;
    const l = line.current;
    if (!b || !l) return;
    const fit = () => {
      const prev = l.style.fontSize;
      l.style.fontSize = "1em";
      const natural = l.scrollWidth;
      l.style.fontSize = prev;
      setK(Math.min(1, b.clientWidth / Math.max(1, natural)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="min-w-0">
      <div ref={line} className="inline-block whitespace-nowrap" style={{ fontSize: `${k}em` }}>
        {children}
      </div>
    </div>
  );
}

/** Colour-coded term, so an equation and its visual can point at the same quantity. */
export function Term({ c, children }: { c: "mint" | "ice"; children: ReactNode }) {
  return (
    <span className={c === "mint" ? "rounded-[4px] bg-[#a6ecc8]/[0.08] px-[0.12em] text-[#a6ecc8]" : "rounded-[4px] bg-[#b9d3ff]/[0.08] px-[0.12em] text-[#b9d3ff]"}>{children}</span>
  );
}
