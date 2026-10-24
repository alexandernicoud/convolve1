import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { HelpCircle, X } from "lucide-react";
import { create } from "zustand";
import { placePopover } from "@/features/onboarding/model";
import { HELP_SELECTOR, annotationIdOf, getAnnotation, pageHelpFor, type Annotation, type AnnotationVisual } from "./annotations";

type Selected = { annotation: Annotation | null; rect: { top: number; left: number; width: number; height: number } };

type ExplainStore = {
  on: boolean;
  selected: Selected | null;
  toggle: () => void;
  close: () => void;
  select: (s: Selected | null) => void;
};

export const useExplainStore = create<ExplainStore>((set, get) => ({
  on: false,
  selected: null,
  toggle: () => set({ on: !get().on, selected: null }),
  close: () => set({ on: false, selected: null }),
  select: (selected) => set({ selected }),
}));

/** Elements inside explain-mode UI keep working; everything else is inert while the mode is on. */
const EXEMPT = "[data-explain-ui]";
const PASS_KEYS = new Set(["Tab", "Shift", "Alt", "Meta", "Control", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

/** Resolve the explanation for an event target: the nearest annotated ancestor. */
export function resolveTarget(start: Element | null): { el: Element; annotation: Annotation | null } | null {
  let el = start?.closest(HELP_SELECTOR) ?? null;
  while (el) {
    const annotation = getAnnotation(annotationIdOf(el));
    if (annotation) return { el, annotation };
    el = el.parentElement?.closest(HELP_SELECTOR) ?? null;
  }
  return null;
}

function Visual({ kind }: { kind: AnnotationVisual }) {
  const axis = "stroke-white/15";
  const frame = "mt-3 h-20 w-full rounded-lg border border-white/[0.07] bg-white/[0.02]";
  if (kind === "threshold") {
    const probs = [0.22, 0.41, 0.58, 0.35, 0.67, 0.49, 0.72, 0.3, 0.55, 0.81, 0.44, 0.62];
    const t = 0.55;
    const y = (p: number) => 74 - p * 56;
    return (
      <svg viewBox="0 0 240 80" className={frame} role="img" aria-label="Probabilities at or above the threshold line become BUY signals">
        <text x="232" y="11" textAnchor="end" className="fill-white/50 text-[8px]">threshold {t} · white bars are BUY signals</text>
        {probs.map((p, i) => (
          <rect key={i} x={14 + i * 18} y={y(p)} width="10" height={p * 56} rx="2" className={p >= t ? "fill-white/80" : "fill-white/15"} />
        ))}
        <line x1="8" x2="232" y1={y(t)} y2={y(t)} className="stroke-white/60" strokeDasharray="4 3" />
      </svg>
    );
  }
  if (kind === "accuracy") {
    return (
      <svg viewBox="0 0 240 80" className={frame} role="img" aria-label="Training images and held-out validation images">
        {Array.from({ length: 40 }, (_, i) => (
          <rect key={i} x={10 + (i % 20) * 11} y={i < 20 ? 14 : 30} width="8" height="12" rx="1.5" className={i % 20 >= 16 ? "fill-white/70" : "fill-white/15"} />
        ))}
        <text x="10" y="62" className="fill-white/45 text-[8px]">trained on</text>
        <text x="186" y="62" className="fill-white/70 text-[8px]">held out</text>
        <text x="10" y="74" className="fill-white/35 text-[7px]">accuracy is measured only on the held-out images</text>
      </svg>
    );
  }
  if (kind === "drawdown") {
    const pts = [60, 48, 52, 36, 30, 42, 50, 58, 54, 40, 34, 26];
    const d = pts.map((y, i) => `${i ? "L" : "M"}${12 + i * 20},${y}`).join(" ");
    return (
      <svg viewBox="0 0 240 80" className={frame} role="img" aria-label="Equity curve with the fall from a peak to a later low marked">
        <path d={d} className="fill-none stroke-white/70" strokeWidth="1.5" />
        <line x1="92" x2="92" y1="30" y2="58" className="stroke-white" strokeDasharray="3 2" />
        <text x="98" y="48" className="fill-white/60 text-[8px]">drawdown: peak → low</text>
        <line x1="8" x2="232" y1="74" y2="74" className={axis} />
      </svg>
    );
  }
  // takeProfit and labeling: entry, take-profit and stop-loss levels over the horizon.
  return (
    <svg viewBox="0 0 240 80" className={frame} role="img" aria-label="Entry price with take-profit above and stop-loss below">
      <line x1="10" x2="230" y1="16" y2="16" className="stroke-white/70" strokeDasharray="4 3" />
      <text x="230" y="12" textAnchor="end" className="fill-white/70 text-[8px]">take profit (+)</text>
      <line x1="10" x2="230" y1="44" y2="44" className="stroke-white/25" />
      <text x="14" y="40" className="fill-white/45 text-[8px]">entry</text>
      <line x1="10" x2="230" y1="64" y2="64" className="stroke-white/35" strokeDasharray="2 3" />
      <text x="230" y="75" textAnchor="end" className="fill-white/45 text-[8px]">stop loss (−)</text>
      <path d="M110,44 L130,50 L150,36 L170,30 L190,22 L205,16" className="fill-none stroke-white" strokeWidth="1.5" />
      {kind === "labeling" ? <text x="110" y="75" className="fill-white/40 text-[7px]">horizon →</text> : null}
    </svg>
  );
}

function ExplainPopover({ selected }: { selected: Selected }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 180 });
  const [showMore, setShowMore] = useState(false);
  const select = useExplainStore((s) => s.select);
  const a = selected.annotation;

  useLayoutEffect(() => {
    setShowMore(false);
  }, [a?.id]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [a?.id, showMore]);

  const place = placePopover(selected.rect, { width: window.innerWidth, height: window.innerHeight }, size);
  return (
    <div
      ref={ref}
      data-explain-ui
      role="dialog"
      aria-labelledby="explain-title"
      className="fixed z-[260] w-[min(340px,calc(100vw-24px))] rounded-2xl border border-white/15 bg-[#0c0c0c] p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      style={{ top: place.top, left: place.left }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="explain-title" className="text-[14px] font-semibold text-white">
          {a ? a.title : "No explanation here"}
        </h3>
        <button type="button" onClick={() => select(null)} className="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Close explanation">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/70">
        {a ? a.body : "This element has no explanation yet. Outlined controls do; the help center covers the rest."}
      </p>
      {a?.visual ? <Visual kind={a.visual} /> : null}
      {a?.more ? (
        showMore ? (
          <p className="mt-2 text-[12px] leading-relaxed text-white/55">{a.more}</p>
        ) : (
          <button type="button" onClick={() => setShowMore(true)} className="mt-2 text-[11.5px] font-medium text-white/60 underline-offset-2 hover:text-white hover:underline">
            More detail
          </button>
        )
      ) : null}
      <div className="mt-3 border-t border-white/[0.07] pt-2">
        <Link to={a?.href ?? "/help"} className="text-[11.5px] text-white/50 hover:text-white">
          Open help center →
        </Link>
      </div>
    </div>
  );
}

/** Mounted once in the workspace shell. */
export function ExplainLayer() {
  const { pathname } = useLocation();
  const on = useExplainStore((s) => s.on);
  const selected = useExplainStore((s) => s.selected);
  const { close, select } = useExplainStore.getState();
  const page = pageHelpFor(pathname);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!on) return;
    document.body.classList.add("explain-mode");
    const exempt = (t: EventTarget | null) => t instanceof Element && t.closest(EXEMPT) != null;
    const show = (target: Element | null) => {
      const hit = resolveTarget(target);
      const el = hit?.el ?? target;
      if (!el) return;
      const r = el.getBoundingClientRect();
      select({ annotation: hit?.annotation ?? null, rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
    };
    const block = (e: Event) => {
      if (exempt(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (exempt(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      show(e.target as Element);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (useExplainStore.getState().selected) select(null);
        else close();
        return;
      }
      if (exempt(e.target) || PASS_KEYS.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter" || e.key === " ") show(document.activeElement);
    };
    const opts = { capture: true } as const;
    window.addEventListener("click", onClick, opts);
    window.addEventListener("dblclick", block, opts);
    window.addEventListener("pointerdown", block, opts);
    window.addEventListener("mousedown", block, opts);
    window.addEventListener("pointerup", block, opts);
    window.addEventListener("mouseup", block, opts);
    window.addEventListener("submit", block, opts);
    window.addEventListener("keydown", onKey, opts);
    window.addEventListener("contextmenu", block, opts);
    return () => {
      document.body.classList.remove("explain-mode");
      window.removeEventListener("click", onClick, opts);
      window.removeEventListener("dblclick", block, opts);
      window.removeEventListener("pointerdown", block, opts);
      window.removeEventListener("mousedown", block, opts);
      window.removeEventListener("pointerup", block, opts);
      window.removeEventListener("mouseup", block, opts);
      window.removeEventListener("submit", block, opts);
      window.removeEventListener("keydown", onKey, opts);
      window.removeEventListener("contextmenu", block, opts);
    };
  }, [on, close, select]);

  if (!on) return null;
  return (
    <>
      <div
        data-explain-ui
        role="status"
        className="fixed bottom-4 left-1/2 z-[255] flex w-[min(640px,calc(100vw-24px))] -translate-x-1/2 items-start gap-3 rounded-2xl border border-white/15 bg-[#0c0c0c]/95 px-4 py-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
      >
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-white/60" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-white">
            Explain mode{page ? ` · ${page.title}` : ""}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/55">
            {page ? `${page.summary} ` : ""}Click any outlined control to see what it does. Controls do nothing while this is on.
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/75 hover:bg-white/10"
        >
          Done <span className="text-white/35">Esc</span>
        </button>
      </div>
      {selected ? <ExplainPopover selected={selected} /> : null}
    </>
  );
}

export function ExplainToggle({ className = "" }: { className?: string }) {
  const on = useExplainStore((s) => s.on);
  const toggle = useExplainStore((s) => s.toggle);
  return (
    <button
      type="button"
      data-explain-ui
      data-tour="explain-toggle"
      onClick={toggle}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
        on ? "border-white/60 bg-white text-[#0a0a0a]" : "border-white/12 text-white/70 hover:bg-white/[0.06] hover:text-white"
      } ${className}`}
    >
      <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      {on ? "Explaining" : "Explain"}
    </button>
  );
}
