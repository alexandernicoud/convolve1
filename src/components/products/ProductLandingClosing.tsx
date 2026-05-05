import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import mockupSideNobg from "@/assets/mockup-side-nobg.png";

export default function ProductLandingClosing() {
  return (
    <section className="relative border-t border-white/[0.07] bg-black text-white">
      {/* Transition band — soft fade from walkthrough */}
      <div
        className="pointer-events-none h-px w-full bg-gradient-to-r from-transparent via-[#a3a3a3]/40 to-transparent"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#a3a3a3]/[0.07] to-transparent" aria-hidden />

      <motion.div
        className="container-aligned relative z-[1] max-w-[100rem] py-20 md:py-28"
        initial={{ opacity: 0, y: 36 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <div>
            <p className="text-[15px] font-semibold uppercase tracking-[0.2em] text-[#a3a3a3]">Workspace</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,2.85rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-white">
              Your control room for the full pipeline.
            </h2>
            <p className="mt-5 text-[1.25rem] leading-relaxed text-white/90 md:text-[1.35rem]">
              Jump into the dashboard to monitor bots, runs, and performance — the same visual system you just walked through.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                to="/dashboard"
                className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white px-8 py-3.5 text-sm font-medium text-[#0a0a0a] shadow-[0_0_40px_rgba(255,255,255,0.1)] transition hover:bg-white/90"
              >
                Open dashboard
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-full border border-white/25 px-8 py-3.5 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/[0.08]"
              >
                Get early access
              </Link>
            </div>
          </div>

          <motion.div
            className="relative"
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.75, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="pointer-events-none absolute -inset-4 rounded-3xl bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.15)_0%,transparent_55%)] blur-2xl md:-inset-8" />
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0A0C14] p-3 shadow-[0_24px_90px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] md:p-4">
              <img
                src={mockupSideNobg}
                alt="Convolve dashboard — overview sidebar and metrics"
                className="h-auto w-full object-contain object-left"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p className="mt-4 text-center text-sm font-medium text-white/55 md:text-left">
              Overview · metrics · live bots · activity
            </p>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
