import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  Brain,
  Microscope,
  Tags,
  LineChart,
  Rocket,
  Network,
  Settings,
  User,
  HelpCircle,
  Gift,
  ShieldCheck,
  FlaskConical,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useIsAdmin } from "@/features/admin/useIsAdmin";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useCreditsStore } from "@/state/creditsStore";
import { InstallSideLink } from "@/features/pwa/InstallUI";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./sidebarCollapse";

const formatCreditsCompact = (n: number): string => {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return n.toLocaleString();
};

export const nav = [
  { to: "/dashboard", label: "Overview", tag: "Manage", icon: LayoutDashboard, tour: "nav-monitor" },
  { to: "/tools/run-log", label: "Search Hub", tag: "Search", icon: Network, tour: "nav-review" },
  { to: "/tools/generator", label: "Datasets", tag: "Generate", icon: Database, tour: "nav-generate" },
  { to: "/tools/trainer", label: "Models", tag: "Train", icon: Brain, tour: "nav-train" },
  { to: "/tools/improve", label: "Improve", tag: "Improve", icon: FlaskConical, tour: "nav-improve" },
  { to: "/tools/analysis", label: "Analysis", tag: "Analyse", icon: Microscope, tour: "nav-analyze" },
  { to: "/tools/backtester", label: "Backtesting", tag: "Test", icon: LineChart, tour: "nav-backtest" },
  { to: "/products/labeling-optimizer/technical", label: "Labeling", tag: "Optimize", icon: Tags, tour: "nav-labeling" },
  { to: "/tools/deploy", label: "Deploy (paper)", tag: "Deploy", icon: Rocket, tour: "nav-deploy" },
] as const;

function SideLink({
  to,
  active,
  icon: Icon,
  label,
  tip,
  accent = false,
}: {
  to: string;
  active: boolean;
  icon: typeof Gift;
  label: string;
  tip: string;
  accent?: boolean;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Link
          to={to}
          className={`convolve-btn-glow flex w-full flex-col items-center gap-0.5 rounded-xl py-1 transition-colors ${
            active ? "bg-white/12 text-white ring-1 ring-white/30" : accent ? "text-[#a6ecc8] hover:bg-white/[0.06]" : "text-white/70 hover:bg-white/[0.06] hover:text-white"
          }`}
        >
          <Icon className="h-[20px] w-[20px] shrink-0" aria-hidden />
          <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">{label}</span>
          <span className="sr-only">{tip}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[220px] border-white/10 bg-[#0a0a0a] text-neutral-200">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

export function sidebarLinkActive(pathname: string, to: string): boolean {
  if (to === "/dashboard") return pathname === "/dashboard";
  if (to === "/products/labeling-optimizer/technical") return pathname.startsWith("/products/labeling-optimizer/");
  if (to === "/tools/trainer") {
    if (pathname.startsWith("/products/trainer/analysis/")) return false;
    return pathname === "/tools/trainer" || pathname.startsWith("/products/trainer/");
  }
  if (to === "/tools/analysis") return pathname.startsWith("/tools/analysis") || pathname.startsWith("/products/trainer/analysis/");
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function DashboardSidebar() {
  const { pathname, search } = useLocation();
  const balance = useCreditsStore((s) => s.balance);
  const mode = useCreditsStore((s) => s.mode);
  const loaded = useCreditsStore((s) => s.loaded);
  const costs = useCreditsStore((s) => s.costs);
  const refresh = useCreditsStore((s) => s.refresh);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [edgeHover, setEdgeHover] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    writeSidebarCollapsed(collapsed);
  }, [collapsed]);

  const enforced = mode === "enforce";
  const cheapest = Math.min(...Object.values(costs).filter((c) => c > 0), Infinity);
  const low = enforced && balance != null && balance < cheapest;
  const creditsLabel = !loaded ? "…" : enforced && balance != null ? formatCreditsCompact(balance) : "Beta";
  const usageActive = pathname === "/account" && /tab=usage/.test(search);

  const linkActive = (to: string) => sidebarLinkActive(pathname, to);

  const earnActive = pathname === "/account" && /tab=earn/.test(search);
  const accountActive = pathname === "/account" && !usageActive && !earnActive;
  const admin = useIsAdmin();

  const revealed = !collapsed || edgeHover;

  return (
    <>
      {/* Hot zones: left edge (toolbar side) and right edge of the viewport when collapsed. */}
      {collapsed ? (
        <>
          <div
            className="pointer-events-auto fixed bottom-0 left-0 top-0 z-[45] w-3 md:w-4"
            aria-hidden
            onMouseEnter={() => setEdgeHover(true)}
          />
          <div
            className="pointer-events-auto fixed bottom-0 right-0 top-0 z-[45] w-3 md:w-4"
            aria-hidden
            onMouseEnter={() => setEdgeHover(true)}
          />
        </>
      ) : null}

      <div
        className={cn(
          "box-border flex h-full min-h-0 shrink-0 flex-col pt-0 transition-[width,opacity,margin] duration-200 ease-out",
          revealed ? "w-[92px] opacity-100" : "pointer-events-none w-0 overflow-hidden opacity-0",
        )}
        onMouseLeave={() => {
          if (collapsed) setEdgeHover(false);
        }}
      >
        <aside
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.08]",
            "bg-black/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl",
            "w-[92px]",
          )}
        >
          <div className="flex justify-center border-b border-white/[0.07] px-1 py-1.5">
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="convolve-btn-glow rounded-lg p-1.5 text-white/55 transition hover:bg-white/[0.08] hover:text-white"
                  aria-label={collapsed ? "Keep toolbar open" : "Collapse toolbar"}
                  aria-pressed={collapsed}
                  onClick={() => {
                    setCollapsed((c) => !c);
                    setEdgeHover(false);
                  }}
                >
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="border-white/10 bg-[#0a0a0a] text-neutral-200">
                {collapsed ? "Pin toolbar open" : "Collapse toolbar (hover left or right screen edge to peek)"}
              </TooltipContent>
            </Tooltip>
          </div>
          <nav className="flex flex-1 flex-col items-center gap-0.5 px-1.5 py-2">
            {nav.map(({ to, label, tag, icon: Icon, tour }) => {
              const active = linkActive(to);
              return (
                <Tooltip key={to} delayDuration={200}>
                  <TooltipTrigger asChild>
                    <Link
                      to={to}
                      data-tour={tour}
                      className={`convolve-btn-glow flex w-full flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-all duration-200 ${
                        active
                          ? "bg-white/15 text-white shadow-[0_0_24px_rgba(255,255,255,0.12)] ring-2 ring-white/35 ring-offset-2 ring-offset-black"
                          : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      <Icon
                        className={`h-[20px] w-[20px] shrink-0 stroke-[1.75] ${active ? "drop-shadow-[0_0_8px_rgba(255,255,255,0.45)]" : ""}`}
                        aria-hidden
                      />
                      <span className="max-w-[5.5rem] text-center text-[8px] font-semibold uppercase leading-tight tracking-wide text-white/55">
                        {tag}
                      </span>
                      <span className="sr-only">
                        {label} · {tag}
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="border-white/10 bg-[#0a0a0a] text-neutral-200">
                    {label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
          <div className="flex flex-col items-center gap-1 border-t border-white/[0.07] px-1.5 py-3">
            {admin && (
              <SideLink to="/dashboard/admin" active={pathname.startsWith("/dashboard/admin")} icon={ShieldCheck} label="Admin" tip="Admin console" />
            )}
            <InstallSideLink />
            <SideLink to="/account?tab=earn" active={earnActive} icon={Gift} label="Earn" tip="Earn bonus credits: answer the feedback questionnaire or cite Convolve" accent />
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  to="/account?tab=usage"
                  className={`convolve-btn-glow w-full rounded-xl px-1 py-1.5 transition-colors hover:bg-white/[0.06] ${
                    usageActive ? "bg-white/[0.08] ring-1 ring-white/20" : ""
                  }`}
                >
                  <p className={`text-center font-digits text-[11px] font-bold tabular-nums ${low ? "text-red-300" : "text-white"}`}>
                    {creditsLabel}
                  </p>
                  <p className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/45">Credits</p>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px] border-white/10 bg-black text-white">
                {enforced ? `${(balance ?? 0).toLocaleString()} credits available. Open usage and credits.` : "Runs are not charged yet. Open usage and credits."}
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  to="/account"
                  className={`convolve-btn-glow flex w-full flex-col items-center gap-0.5 rounded-xl py-1 transition-colors ${
                    accountActive
                      ? "bg-white/12 text-white shadow-[0_0_16px_rgba(255,255,255,0.1)] ring-1 ring-white/30"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <Settings className="h-[20px] w-[20px] shrink-0" aria-hidden />
                  <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">Settings</span>
                  <span className="sr-only">Settings</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="border-white/10 bg-black text-white">
                Settings
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  to="/help"
                  data-tour="nav-help"
                  className={`convolve-btn-glow flex w-full flex-col items-center gap-0.5 rounded-xl py-1 transition-colors ${
                    pathname === "/help" ? "bg-white/12 text-white ring-1 ring-white/30" : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <HelpCircle className="h-[20px] w-[20px] shrink-0" aria-hidden />
                  <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">Help</span>
                  <span className="sr-only">Help center and guided tour</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px] border-white/10 bg-[#0a0a0a] text-neutral-200">
                Help center, guided tour and explanations
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  to="/account"
                  className={`convolve-btn-glow flex w-full flex-col items-center gap-0.5 rounded-xl py-1 transition-colors ${
                    accountActive
                      ? "bg-white/12 text-white shadow-[0_0_16px_rgba(255,255,255,0.1)] ring-1 ring-white/30"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <User className="h-[20px] w-[20px] shrink-0" aria-hidden />
                  <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">Account</span>
                  <span className="sr-only">Account</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="border-white/10 bg-black text-white">
                Account
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>
      </div>
    </>
  );
}
