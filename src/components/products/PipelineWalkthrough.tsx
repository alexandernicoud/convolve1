import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ChartGeneratorVisual,
  LabelingOptimizerVisual,
  ModelTrainerVisual,
  BacktesterVisual,
  DeploymentVisual,
} from "./PipelineCardVisuals";

gsap.registerPlugin(ScrollTrigger);

export type WalkthroughCardData = {
  step: number;
  title: string;
  description: string;
  visual: ReactNode;
};

const CARDS: WalkthroughCardData[] = [
  {
    step: 1,
    title: "Chart Generator",
    description:
      "Generate structured chart datasets directly from market history. Control symbols, timeframe, window length, TP/SL logic, horizon, chart style, and output format — all visually.",
    visual: <ChartGeneratorVisual />,
  },
  {
    step: 2,
    title: "Labeling Optimizer",
    description:
      "Search across TP, SL, and holding horizon combinations to find parameter structures worth training on.",
    visual: <LabelingOptimizerVisual />,
  },
  {
    step: 3,
    title: "Model Trainer",
    description:
      "Train visual models directly on chart datasets with configurable settings and a live technical training console.",
    visual: <ModelTrainerVisual />,
  },
  {
    step: 4,
    title: "Backtester",
    description:
      "Test how model decisions would perform across historical samples and inspect the equity curve, trade outcomes, and risk metrics.",
    visual: <BacktesterVisual />,
  },
  {
    step: 5,
    title: "Deployment",
    description:
      "Move from experimentation to live systems. Track model behavior, surface signals, and build a continuous visual AI workflow.",
    visual: <DeploymentVisual />,
  },
];

function WalkthroughCard({ data, className = "" }: { data: WalkthroughCardData; className?: string }) {
  return (
    <div
      className={`tech-surface flex w-full max-w-[1100px] flex-col gap-8 p-8 md:p-10 lg:flex-row lg:items-stretch lg:gap-12 ${className}`}
    >
      <div className="flex min-w-0 flex-1 flex-col lg:max-w-[min(100%,28rem)]">
        <p className="marketing-section-label">Step {String(data.step).padStart(2, "0")}</p>
        <h3 className="mt-5 text-[clamp(1.85rem,4vw,2.85rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-white">
          {data.title}
        </h3>
        <p className="mt-6 text-[clamp(1.05rem,1.9vw,1.25rem)] font-normal leading-relaxed text-white/88">
          {data.description}
        </p>
      </div>
      <div className="min-h-[220px] w-full flex-1 lg:min-h-[280px] lg:max-w-[min(100%,28rem)]">{data.visual}</div>
    </div>
  );
}

function SectionIntro() {
  return (
    <div className="relative z-[1] mb-10 max-w-3xl text-center md:mb-14">
      <p className="marketing-section-label">How it works</p>
      <h2 className="mt-5 text-[clamp(1.75rem,3.5vw,2.35rem)] font-extralight tracking-[-0.03em] text-white">
        From raw history to live systems
      </h2>
      <p className="mt-4 text-[clamp(1rem,1.8vw,1.15rem)] text-white/65">Scroll to walk the pipeline.</p>
    </div>
  );
}

/** Stacked layout only on small screens — desktop always uses pinned walkthrough */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return narrow;
}

export function PipelineWalkthrough() {
  const sectionRef = useRef<HTMLElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isNarrow = useIsNarrow();

  useLayoutEffect(() => {
    if (isNarrow) return;

    const section = sectionRef.current;
    if (!section) return;

    let cancelled = false;
    let ctx: gsap.Context | null = null;

    const fromX = (i: number) => (i % 2 === 0 ? -1 : 1) * Math.min(window.innerWidth * 0.38, 440);

    const setup = () => {
      if (cancelled) return;

      const cards = cardRefs.current.filter(Boolean) as HTMLDivElement[];
      if (cards.length !== CARDS.length) return;

      ctx?.revert();
      ctx = null;

      // Card 1 (Chart Generator) visible at scrub 0 — avoids empty stack while pinned
      gsap.set(cards[0], { x: 0, opacity: 1, filter: "none", zIndex: 10 });
      for (let i = 1; i < cards.length; i++) {
        gsap.set(cards[i], {
          x: fromX(i),
          opacity: 0,
          filter: "blur(10px)",
          zIndex: 10 + i,
        });
      }

      ctx = gsap.context(() => {
        const segment = 1;
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: "+=4500",
            pin: true,
            pinSpacing: true,
            scrub: 1,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        for (let i = 1; i < cards.length; i++) {
          tl.fromTo(
            cards[i],
            { x: fromX(i), opacity: 0, filter: "blur(10px)" },
            {
              x: 0,
              opacity: 1,
              filter: "blur(0px)",
              ease: "power3.out",
              duration: segment,
            },
            (i - 1) * segment
          );
        }

        if (glowRef.current) {
          gsap.to(glowRef.current, {
            scrollTrigger: {
              trigger: section,
              start: "top bottom",
              end: "bottom top",
              scrub: 1.2,
            },
            rotate: 6,
            scale: 1.06,
            ease: "none",
          });
        }
      }, section);

      ScrollTrigger.refresh();
    };

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!cancelled) setup();
      });
    });

    const onResize = () => ScrollTrigger.refresh();
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("resize", onResize);
      ctx?.revert();
      ctx = null;
    };
  }, [isNarrow]);

  if (isNarrow) {
    return (
      <section id="how-it-works" className="scroll-mt-24 bg-[#0a0a0a] px-4 py-20 font-montserrat md:px-8">
        <div className="mx-auto max-w-[1100px]">
          <SectionIntro />
          <div className="flex flex-col gap-12">
            {CARDS.map((data) => (
              <WalkthroughCard key={data.step} data={data} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} id="how-it-works" className="relative scroll-mt-24 bg-black text-white">
      <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-4 py-16 md:min-h-screen md:px-8">
        <div
          ref={glowRef}
          className="pointer-events-none absolute left-1/2 top-1/2 h-[min(90vw,720px)] w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.15)_38%,transparent_68%)] opacity-45 blur-3xl will-change-transform"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-1/4 top-1/4 h-[min(40vw,420px)] w-[min(40vw,420px)] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.18)_0%,transparent_70%)] blur-2xl"
          aria-hidden
        />

        <SectionIntro />

        <div ref={stackRef} className="relative z-[2] flex w-full max-w-[1150px] flex-1 items-center justify-center pb-8">
          <div className="relative min-h-[min(70vh,600px)] w-full">
            {CARDS.map((data, i) => (
              <div
                key={data.step}
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
                className="absolute left-1/2 top-1/2 w-full max-w-[1100px] -translate-x-1/2 -translate-y-1/2"
                style={{ zIndex: 10 + i }}
              >
                <WalkthroughCard data={data} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
