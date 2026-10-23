import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import { VIZ } from "@/lib/viz/tokens";
import { cn } from "@/lib/utils";

/** Measured content box of an element; updates on resize (layout tiers, chart widths, row counts). */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Panel({ title, aside, link, children, className, bodyClassName, id }: { title: ReactNode; aside?: ReactNode; link?: { to: string; label: string }; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section data-panel={id} className={cn(dashboardCard, "flex min-h-0 min-w-0 flex-col overflow-hidden px-2.5 pb-2 pt-1.5", className)}>
      <header className="flex h-[24px] shrink-0 items-center justify-between gap-2">
        <h2 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/60">{title}</h2>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {aside}
          {link ? (
            <Link to={link.to} className="whitespace-nowrap text-[11px] font-medium text-white/45 transition hover:text-white">
              {link.label} →
            </Link>
          ) : null}
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-hidden", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-[22px] items-center rounded-md border border-white/[0.1] p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-full whitespace-nowrap rounded-[4px] px-2 text-[11px] font-medium tabular-nums transition",
            value === o.value ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/80",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TooltipBox({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none min-w-[170px] rounded-[10px] border px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
      style={{ background: VIZ.tooltip.background, borderColor: VIZ.tooltip.border, fontSize: 12 }}
    >
      {children}
    </div>
  );
}

export function TipRow({ label, value, color }: { label: ReactNode; value: ReactNode; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 leading-[1.55]">
      <span className="flex items-center gap-1.5 text-white/55">
        {color ? <span className="h-0.5 w-3 rounded-full" style={{ background: color }} /> : null}
        {label}
      </span>
      <span className="font-digits tabular-nums text-white">{value}</span>
    </div>
  );
}

export function Unavailable({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[40px] items-center justify-center px-3 text-center text-[12px] leading-snug text-white/40">{children}</div>;
}

/** Annotation laid over an empty chart frame; the frame itself (axes, grid, baseline) stays visible underneath. */
export function FrameNote({ title, sub, className }: { title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 z-[2] flex items-center justify-center px-3", className)}>
      <div className="max-w-[92%] rounded-md border border-[#8FB3E0]/20 bg-black/80 px-2.5 py-1 text-center">
        <p className="truncate text-[11px] font-medium leading-[15px] text-[#C9DBF1]/85">{title}</p>
        {sub ? <p className="truncate text-[10.5px] leading-[14px] text-white/40">{sub}</p> : null}
      </div>
    </div>
  );
}

export const BASELINE_STROKE = "rgba(143,179,224,0.55)";

export function Dot({ tone }: { tone: "ok" | "warn" | "error" | "muted" }) {
  const c = tone === "ok" ? "bg-[#8FB3E0]" : tone === "warn" ? "bg-[#FCD34D]" : tone === "error" ? "bg-[#F87171]" : "bg-white/30";
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", c)} aria-hidden />;
}
