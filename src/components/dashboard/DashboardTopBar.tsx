import { Link } from "react-router-dom";
import { Plus, FlaskConical, Gift } from "lucide-react";
import { ExplainToggle } from "@/features/help/ExplainMode";
import { EARN_HREF } from "@/features/beta/model";
import logoMark from "@/assets/convolve-mark.png";
import { cn } from "@/lib/utils";

type Props = {
  /** Pipeline / workspace title (defaults to dashboard overview) */
  title?: string;
  /** Extra class on the outer shell (e.g. dashboard spacing) */
  className?: string;
};

export function DashboardTopBar({ title = "Overview", className }: Props) {
  return (
    <header
      className={cn(
        "flex h-[52px] shrink-0 items-center justify-between gap-4 rounded-2xl border border-white/[0.1]",
        "bg-black/90 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:px-5",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <a
          href="/"
          className="convolve-btn-glow shrink-0 rounded-lg ring-offset-2 ring-offset-black transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          aria-label="Convolve home"
          onClick={(e) => {
            e.preventDefault();
            window.location.assign("/");
          }}
        >
          <img
            src={logoMark}
            alt=""
            className="h-8 w-8 object-contain"
            width={32}
            height={32}
          />
        </a>
        <h1 className="truncate font-sans text-lg font-semibold tracking-tight text-white md:text-xl">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <ExplainToggle className="h-10" />
        <Link
          to={EARN_HREF}
          title="Earn bonus credits: answer the feedback questionnaire or cite Convolve"
          className="convolve-btn-glow hidden h-10 lg:inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/[0.04] px-3 font-sans text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/[0.08] sm:px-4"
        >
          <Gift className="h-4 w-4" aria-hidden />
          Earn
        </Link>
        <Link
          to="/tools/deploy"
          title="Create a paper-trading bot from one of your models (simulated trades, no real orders)"
          className="convolve-btn-glow hidden h-10 items-center gap-2 rounded-lg bg-white px-4 md:inline-flex font-sans text-sm font-semibold text-[#0a0a0a] shadow-[0_0_24px_rgba(255,255,255,0.12)] transition hover:bg-white/90 sm:px-5"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          Launch Bot
        </Link>
        <Link
          to="/tools/generator"
          title="Start a research workflow: generate labelled training charts"
          aria-label="Start Research"
          className="convolve-btn-glow inline-flex h-10 items-center gap-2 rounded-lg border border-white/25 bg-white/[0.04] px-3 font-sans text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/[0.08] sm:px-4"
        >
          <FlaskConical className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Start Research</span>
        </Link>
      </div>
    </header>
  );
}
