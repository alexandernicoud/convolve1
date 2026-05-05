import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function scrollToHowItWorks(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function ProductLandingHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const glowARef = useRef<HTMLDivElement>(null);
  const glowBRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches || !innerRef.current) {
      innerRef.current?.querySelectorAll<HTMLElement>(".hero-fade").forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return;
    }

    const ctx = gsap.context(() => {
      const els = innerRef.current?.querySelectorAll<HTMLElement>(".hero-fade");
      if (els?.length) {
        gsap.from(els, {
          opacity: 0,
          y: 32,
          duration: 1.05,
          stagger: 0.1,
          ease: "power3.out",
          delay: 0.08,
        });
      }

      if (sectionRef.current && glowARef.current) {
        gsap.to(glowARef.current, {
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top top",
            end: "bottom top",
            scrub: 1.2,
          },
          y: 64,
          x: 24,
          scale: 1.08,
          ease: "none",
        });
      }
      if (sectionRef.current && glowBRef.current) {
        gsap.to(glowBRef.current, {
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top top",
            end: "bottom top",
            scrub: 1.4,
          },
          y: -48,
          x: -20,
          opacity: 0.55,
          ease: "none",
        });
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-black px-6 pt-28 md:px-10 md:pt-32"
    >
      <div
        ref={glowARef}
        className="pointer-events-none absolute left-[-10%] top-[15%] h-[min(70vw,560px)] w-[min(70vw,560px)] rounded-full bg-[radial-gradient(circle_at_40%_40%,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.15)_42%,transparent_72%)] opacity-90 blur-3xl will-change-transform"
        aria-hidden
      />
      <div
        ref={glowBRef}
        className="pointer-events-none absolute bottom-[-5%] right-[-8%] h-[min(55vw,480px)] w-[min(55vw,480px)] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.35)_0%,rgba(46,107,255,0.12)_45%,transparent_70%)] opacity-70 blur-3xl will-change-transform"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,7,10,0)_0%,rgba(5,7,10,0.5)_100%)]" aria-hidden />

      <div ref={innerRef} className="container-aligned relative z-[1] w-full max-w-[100rem] text-left md:text-left">
        <p className="hero-fade marketing-section-label">Product hub</p>
        <h1 className="hero-fade mt-5 max-w-[18ch] text-[clamp(2.75rem,9vw,5.75rem)] font-extralight leading-[0.98] tracking-[-0.045em] text-white">
          Build trading systems visually.
        </h1>
        <p className="hero-fade mt-8 max-w-2xl text-justify text-[clamp(1.05rem,2vw,1.35rem)] font-normal leading-snug text-white/90 hyphens-auto">
          One pipeline from chart data to deployment — no boilerplate, no guesswork.
        </p>
        <div className="hero-fade mt-12 flex flex-wrap items-center gap-4">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white px-8 py-3.5 text-sm font-medium text-[#0a0a0a] shadow-[0_0_40px_rgba(255,255,255,0.1)] transition hover:bg-white/90"
          >
            Start building
          </Link>
          <a
            href="#how-it-works"
            onClick={scrollToHowItWorks}
            className="inline-flex items-center justify-center rounded-full border border-white/25 px-8 py-3.5 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/[0.08]"
          >
            How it works
          </a>
        </div>
      </div>
    </section>
  );
}
