import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Plus, FlaskConical, Gift, User } from "lucide-react";
import { ExplainToggle } from "@/features/help/ExplainMode";
import { EARN_HREF } from "@/features/beta/model";
import { ConvolveMark } from "@/components/brand/ConvolveMark";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { HEADER_HEIGHT, headerMetrics, setHeaderHeight, useWorkspaceSize } from "@/components/layout/workspaceSize";
import { cn } from "@/lib/utils";

type Props = {
  /** Pipeline / workspace title (defaults to dashboard overview) */
  title?: string;
  /** Extra class on the outer shell (e.g. dashboard spacing) */
  className?: string;
};

export function DashboardTopBar({ title = "Overview", className }: Props) {
  const { headerHeight, desktop } = useWorkspaceSize();
  const m = headerMetrics(headerHeight);
  const [resizing, setResizing] = useState(false);
  const btn: CSSProperties = { height: m.button, fontSize: m.buttonFont };
  const icon: CSSProperties = { width: m.icon, height: m.icon };

  return (
    <header
      className={cn(
        "relative flex shrink-0 items-center justify-between rounded-2xl border border-white/25",
        "bg-black/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md",
        !resizing && "transition-[height] duration-150 ease-out",
        className
      )}
      style={{ height: m.height, paddingLeft: m.padX, paddingRight: m.padX, gap: m.gap + 6 }}
    >
      <div className="flex min-w-0 items-center" style={{ gap: m.gap + 2 }}>
        <a
          href="/"
          className="convolve-btn-glow accent-ring shrink-0 rounded-lg ring-offset-2 ring-offset-black transition hover:opacity-90 focus-visible:outline-none"
          aria-label="Convolve home"
          onClick={(e) => {
            e.preventDefault();
            window.location.assign("/");
          }}
        >
          <ConvolveMark className="block" style={{ width: m.logo, height: m.logo }} title="Convolve" />
        </a>
        <h1
          className="truncate font-sans font-semibold tracking-tight text-white"
          style={{ fontSize: m.title, lineHeight: 1.2 }}
        >
          {title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center" style={{ gap: m.gap }}>
        <ExplainToggle style={{ height: m.button, fontSize: Math.max(11, m.buttonFont - 2) }} iconSize={m.icon - 2} />
        <Link
          to="/account"
          title="Account and settings"
          aria-label="Account"
          style={btn}
          className="convolve-btn-glow inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/[0.04] px-3 font-sans font-semibold text-white transition hover:border-white/40 hover:bg-white/[0.08] sm:px-4"
        >
          <User style={icon} aria-hidden />
          <span className="hidden sm:inline">Account</span>
        </Link>
        <Link
          to={EARN_HREF}
          title="Earn bonus credits: answer the feedback questionnaire or cite Convolve"
          style={btn}
          className="convolve-btn-glow hidden lg:inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/[0.04] px-3 font-sans font-semibold text-white transition hover:border-white/40 hover:bg-white/[0.08] sm:px-4"
        >
          <Gift style={icon} aria-hidden />
          Earn
        </Link>
        <Link
          to="/tools/deploy"
          title="Create a paper-trading bot from one of your models (simulated trades, no real orders)"
          style={btn}
          className="convolve-btn-glow accent-btn hidden items-center gap-2 rounded-lg px-4 md:inline-flex font-sans font-semibold shadow-[0_0_24px_rgba(255,255,255,0.12)] transition sm:px-5"
        >
          <Plus style={icon} strokeWidth={2.5} aria-hidden />
          Launch Bot
        </Link>
        <Link
          to="/tools/generator"
          title="Start a research workflow: generate labelled training charts"
          aria-label="Start Research"
          style={btn}
          className="convolve-btn-glow accent-btn inline-flex items-center gap-2 rounded-lg px-3 font-sans font-semibold transition sm:px-4"
        >
          <FlaskConical style={icon} aria-hidden />
          <span className="hidden sm:inline">Start Research</span>
        </Link>
      </div>
      {desktop ? (
        <ResizeHandle
          axis="y"
          label="Resize header"
          value={headerHeight}
          min={HEADER_HEIGHT.min}
          max={HEADER_HEIGHT.max}
          defaultValue={HEADER_HEIGHT.default}
          step={HEADER_HEIGHT.step}
          onChange={setHeaderHeight}
          onDragChange={setResizing}
        />
      ) : null}
    </header>
  );
}
