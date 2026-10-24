import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { asset, trace } from "@/features/marketing2/data";
import { placePopover } from "./model";
import { TOUR_STEPS, type TourSpot } from "./steps";
import { useOnboardingStore } from "./store";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Real chart from the MSFT research chain, the three conv stages and the model's output. */
export function PipelineVisual() {
  const convs = trace.layers.filter((l) => /conv/i.test(l.name)).slice(0, 3);
  const stage = "flex flex-col items-center gap-1.5 text-center";
  const label = "text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40";
  const arrow = <span className="mt-[-14px] text-white/25" aria-hidden>→</span>;
  return (
    <figure className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2 overflow-x-auto">
        <div className={stage}>
          <img src={asset(trace.input)} alt="Candlestick chart image used as model input" className="h-16 w-16 rounded-md border border-white/10 bg-black object-cover" />
          <span className={label}>Chart</span>
        </div>
        {arrow}
        {convs.map((l) => (
          <div key={l.name} className={stage}>
            <div
              className="rounded-md border border-white/15 bg-white/[0.04]"
              style={{ width: Math.max(18, 56 - l.channels / 4), height: Math.max(18, 56 - l.channels / 4) }}
              aria-hidden
            />
            <span className={label}>
              {l.h}×{l.w}×{l.channels}
            </span>
          </div>
        ))}
        {arrow}
        <div className={stage}>
          <img src={asset(trace.gradcam)} alt="Grad-CAM attention map for the same chart" className="h-16 w-16 rounded-md border border-white/10 object-cover" />
          <span className={label}>Grad-CAM</span>
        </div>
        {arrow}
        <div className={stage}>
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-white/15 font-digits text-lg tabular-nums text-white">
            {trace.p_label1.toFixed(2)}
          </div>
          <span className={label}>P(take-profit)</span>
        </div>
      </div>
      <figcaption className="mt-3 text-[10.5px] leading-relaxed text-white/40">
        Real example: a CNN trained in Convolve on MSFT daily charts, chart ending {trace.sample.date}. Label rule: +2% take-profit before
        −1% stop-loss within 7 bars. Actual outcome for this chart:{" "}
        {trace.sample.label === 1 ? "take-profit reached first" : "stop-loss reached first"}. A probability is not a guarantee.
      </figcaption>
    </figure>
  );
}

function WelcomeOverlay() {
  const start = useOnboardingStore((s) => s.start);
  const skip = useOnboardingStore((s) => s.skip);
  const navigate = useNavigate();
  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-2xl rounded-3xl border border-white/12 bg-[#0a0a0a] p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.95)] sm:p-8 motion-safe:animate-fade-in">
        <button type="button" onClick={skip} className="absolute right-4 top-4 rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Welcome to Convolve</p>
        <h2 id="welcome-title" className="mt-3 text-[clamp(1.6rem,3.6vw,2.3rem)] font-semibold leading-tight tracking-tight text-white">
          Your research starts here.
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/65">
          Generate datasets, train neural networks, analyze predictions, backtest strategies and deploy paper-trading bots — all without
          writing code.
        </p>
        <div className="mt-6">
          <PipelineVisual />
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            autoFocus
            onClick={() => start(0)}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90 sm:flex-[1.4]"
          >
            Start guided research <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={skip}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Explore workspace
          </button>
          <button
            type="button"
            onClick={() => {
              skip();
              navigate("/help#how-it-works");
            }}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            How Convolve works
          </button>
        </div>
        <p className="mt-4 text-[11px] text-white/35">The tour only points at controls; it never starts a run. Reopen it any time from Help.</p>
      </div>
    </div>
  );
}

type Rect = { top: number; left: number; width: number; height: number };

function useTargetRect(selector: string | null, reduced: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector(selector);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      if (!scrolled) {
        scrolled = true;
        if (r.top < 60 || r.bottom > window.innerHeight - 40) {
          el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        }
      }
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    measure();
    const id = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [selector, reduced]);
  return rect;
}

function TourOverlay() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const pos = useOnboardingStore((s) => s.pos);
  const { next, prev, exit, arrived, left } = useOnboardingStore.getState();
  const step = TOUR_STEPS[pos.step];
  const onRoute = pathname === step.route || pathname.startsWith(`${step.route}/`);
  const spot: TourSpot = pos.spot === 0 ? step.nav : step.spots[pos.spot - 1];
  const rect = useTargetRect(spot.target, reduced);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 340, height: 220 });
  const lastPath = useRef(pathname);

  useEffect(() => {
    const changed = lastPath.current !== pathname;
    lastPath.current = pathname;
    if (pos.spot === 0 && onRoute && changed) arrived();
    else if (pos.spot > 0 && !onRoute) left();
  }, [pathname, onRoute, pos.spot, arrived, left]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el) setCardSize({ width: el.offsetWidth, height: el.offsetHeight });
    el?.focus({ preventScroll: true });
  }, [pos.step, pos.spot, rect == null]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    },
    [exit, next, prev],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const pad = 6;
  const hole = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  const place = hole ? placePopover(hole, { width: vw, height: vh }, cardSize) : null;
  // Only the sidebar item is clickable through the dim layer, so the user can navigate.
  const passThrough = pos.spot === 0;
  const dim = "pointer-events-auto absolute bg-black/65";
  const isLastSpot = pos.spot === step.spots.length;
  const isLast = isLastSpot && pos.step === TOUR_STEPS.length - 1;

  return (
    <div className="pointer-events-none fixed inset-0 z-[240]" aria-live="polite">
      {hole ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className={dim} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className={dim} style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className={dim} style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          {!passThrough ? <div className="pointer-events-auto absolute" style={hole} /> : null}
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-white/80 shadow-[0_0_0_4px_rgba(255,255,255,0.12),0_0_40px_rgba(255,255,255,0.18)] motion-safe:transition-all motion-safe:duration-300"
            style={hole}
          />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-black/65" />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className={`pointer-events-auto absolute w-[min(360px,calc(100vw-24px))] rounded-2xl border border-white/15 bg-[#0c0c0c] p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] outline-none motion-safe:transition-[top,left] motion-safe:duration-300 ${
          place?.sheet ? "w-[calc(100vw-24px)]" : ""
        }`}
        style={place ? { top: place.top, left: place.left } : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <ol className="flex items-center gap-1" aria-label={`Step ${pos.step + 1} of ${TOUR_STEPS.length}`}>
            {TOUR_STEPS.map((s, i) => (
              <li key={s.id} className={`h-1 w-5 rounded-full ${i < pos.step ? "bg-white/60" : i === pos.step ? "bg-white" : "bg-white/15"}`} />
            ))}
          </ol>
          <button type="button" onClick={exit} className="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Exit tour">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">{step.label}</p>
        <h3 id="tour-title" className="mt-1 text-[15px] font-semibold text-white">
          {spot.title}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{rect || !spot.fallback ? spot.body : spot.fallback}</p>
        {pos.spot === 0 && step.example === "gradcam" ? (
          <div className="mt-3 flex items-center gap-2">
            <img src={asset(trace.input)} alt="Chart" className="h-16 w-16 rounded-md border border-white/10 bg-black object-cover" />
            <img src={asset(trace.gradcam)} alt="Grad-CAM map for the same chart" className="h-16 w-16 rounded-md border border-white/10 object-cover" />
            <p className="text-[10.5px] leading-snug text-white/40">Real Grad-CAM map: brighter areas contributed more to the prediction.</p>
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={prev}
            disabled={pos.step === 0 && pos.spot === 0}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-white/55 hover:text-white disabled:opacity-30"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="flex items-center gap-2">
            {pos.spot === 0 && !onRoute ? (
              <button
                type="button"
                onClick={() => navigate(step.route)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-white/90"
              >
                Open {step.page} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-white/90"
              >
                {isLast ? "Finish" : isLastSpot ? `Next: ${TOUR_STEPS[pos.step + 1].label}` : "Next"} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-[10px] text-white/30">Esc to exit · ← → to move · the tour never starts a run</p>
      </div>
    </div>
  );
}

function CompleteCard() {
  const close = useOnboardingStore((s) => s.closeComplete);
  const start = useOnboardingStore((s) => s.start);
  const navigate = useNavigate();
  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="tour-done-title">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/12 bg-[#0c0c0c] p-6">
        <h2 id="tour-done-title" className="text-lg font-semibold text-white">
          Tour complete
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/65">
          That is the full pipeline: generate, train, analyze, backtest, deploy on paper, monitor. Start with a dataset; every run shows
          its estimated computation before it starts.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          Use <span className="text-white/70">Explain</span> in the top bar on any page to see what each control does.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            autoFocus
            onClick={() => {
              close();
              navigate("/tools/generator");
            }}
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] hover:bg-white/90"
          >
            Open Generator
          </button>
          <button
            type="button"
            onClick={() => start(0)}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 hover:bg-white/10"
          >
            Restart tour
          </button>
        </div>
      </div>
    </div>
  );
}

/** Whether the workspace sidebar is on screen (not while the Terms gate or a loading state shows). */
function useWorkspaceShown(enabled: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setShown(false);
      return;
    }
    const check = () => setShown(document.querySelector('[data-tour="nav-generate"]') != null);
    check();
    const id = window.setInterval(check, 300);
    return () => window.clearInterval(id);
  }, [enabled]);
  return shown;
}

/** Mounted once in the app shell; shows only inside the workspace for signed-in users. */
export function OnboardingHost({ active }: { active: boolean }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const loaded = useOnboardingStore((s) => s.loaded);
  const view = useOnboardingStore((s) => s.view);
  const load = useOnboardingStore((s) => s.load);
  const reset = useOnboardingStore((s) => s.reset);
  const lastUser = useRef<string | null>(null);
  const shown = useWorkspaceShown(active && userId != null);

  useEffect(() => {
    if (lastUser.current && lastUser.current !== userId) reset();
    lastUser.current = userId;
  }, [userId, reset]);

  useEffect(() => {
    if (shown && userId && !loaded) void load();
  }, [shown, userId, loaded, load]);

  if (!active || !userId || !shown) return null;
  if (view === "welcome") return <WelcomeOverlay />;
  if (view === "tour") return <TourOverlay />;
  if (view === "complete") return <CompleteCard />;
  return null;
}
