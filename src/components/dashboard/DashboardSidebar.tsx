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
} from "lucide-react";
import { useIsAdmin } from "@/features/admin/useIsAdmin";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useCreditsStore } from "@/state/creditsStore";
import { InstallSideLink } from "@/features/pwa/InstallUI";
import { readSidebarUnpinned, writeSidebarUnpinned } from "./sidebarCollapse";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import {
  SIDEBAR_WIDTH,
  resetWorkspaceSize,
  setSidebarWidth,
  sidebarDensity,
  useWorkspaceSize,
  type SidebarDensity,
} from "@/components/layout/workspaceSize";

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

/** Rail button chrome per density (selection is a shared sliding indicator). */
function railBtn(d: SidebarDensity): string {
  return d === "wide"
    ? "relative z-[1] flex w-full flex-row items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors"
    : "relative z-[1] flex w-full flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-colors";
}

const tagCls = "text-center text-[7px] font-semibold uppercase leading-tight tracking-wide";

/** Visible text under or beside a rail icon; hidden in compact mode (the sr-only label remains). */
function RailText({ d, tag, label, className }: { d: SidebarDensity; tag: string; label: string; className?: string }) {
  if (d === "compact") return null;
  if (d === "wide") return <span className={cn("min-w-0 truncate text-left text-[12.5px] font-medium leading-tight", className)}>{label}</span>;
  return <span className={cn(tagCls, className)}>{tag}</span>;
}

function SideLink({
  to,
  active,
  icon: Icon,
  label,
  tip,
  accent = false,
  density,
}: {
  to: string;
  active: boolean;
  icon: typeof Gift;
  label: string;
  tip: string;
  accent?: boolean;
  density: SidebarDensity;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Link
          to={to}
          className={cn(
            railBtn(density),
            active ? "bg-white/12 text-white ring-1 ring-white/30" : accent ? "text-[#a6ecc8] hover:bg-white/[0.06]" : "text-white/70 hover:bg-white/[0.06] hover:text-white",
          )}
        >
          <Icon className="h-[20px] w-[20px] shrink-0" aria-hidden />
          <RailText d={density} tag={label} label={label} className="text-white/55" />
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

type CtxMenu = { x: number; y: number } | null;

export function DashboardSidebar() {
  const { pathname, search } = useLocation();
  const balance = useCreditsStore((s) => s.balance);
  const mode = useCreditsStore((s) => s.mode);
  const loaded = useCreditsStore((s) => s.loaded);
  const costs = useCreditsStore((s) => s.costs);
  const refresh = useCreditsStore((s) => s.refresh);
  /** Unpinned = hidden until edge hover. Default pinned (visible on load). */
  const [unpinned, setUnpinned] = useState(readSidebarUnpinned);
  const [edgeHover, setEdgeHover] = useState(false);
  const [menu, setMenu] = useState<CtxMenu>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [indicator, setIndicator] = useState({ top: 0, height: 0, ready: false });
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { sidebarWidth } = useWorkspaceSize();
  const density = sidebarDensity(sidebarWidth);
  const navBtn = railBtn(density);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    writeSidebarUnpinned(unpinned);
  }, [unpinned]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const enforced = mode === "enforce";
  const cheapest = Math.min(...Object.values(costs).filter((c) => c > 0), Infinity);
  const low = enforced && balance != null && balance < cheapest;
  const creditsLabel = !loaded ? "…" : enforced && balance != null ? formatCreditsCompact(balance) : "Beta";
  const usageActive = pathname === "/account" && /tab=usage/.test(search);

  const linkActive = (to: string) => sidebarLinkActive(pathname, to);

  const earnActive = pathname === "/account" && /tab=earn/.test(search);
  const accountActive = pathname === "/account" && !usageActive && !earnActive;
  const admin = useIsAdmin();

  const revealed = !unpinned || edgeHover;

  const activeNavKey = nav.find((n) => linkActive(n.to))?.to ?? nav[0].to;
  const indicatorKey = hoverKey ?? activeNavKey;

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;
    const measure = () => {
      const el = itemRefs.current[indicatorKey];
      if (!el) return;
      const nr = navEl.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      setIndicator({ top: er.top - nr.top + navEl.scrollTop, height: er.height, ready: true });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(navEl);
    return () => ro.disconnect();
  }, [indicatorKey, pathname, revealed, density]);

  const setPinned = (pinned: boolean) => {
    setUnpinned(!pinned);
    setEdgeHover(false);
    setMenu(null);
  };

  return (
    <>
      {unpinned ? (
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
          "relative box-border flex h-full min-h-0 shrink-0 flex-col pt-0",
          !resizing && "transition-[width,opacity,margin] duration-200 ease-out",
          revealed ? "opacity-100" : "pointer-events-none overflow-hidden opacity-0",
        )}
        style={{ width: revealed ? sidebarWidth : 0 }}
        onMouseLeave={() => {
          if (unpinned) setEdgeHover(false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <aside
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/25",
            "bg-black/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl",
            "w-full",
          )}
          aria-label="Workspace toolbar. Right-click for pin options."
        >
          <nav
            ref={navRef}
            className={cn("relative flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-1.5 py-3", density === "wide" ? "items-stretch" : "items-center")}
            onMouseLeave={() => setHoverKey(null)}
          >
            {indicator.ready ? (
              <span
                aria-hidden
                className="pointer-events-none absolute left-1.5 right-1.5 z-0 rounded-xl bg-white/[0.1] ring-1 ring-white/25"
                style={{
                  top: indicator.top,
                  height: indicator.height,
                  transition: reduceMotion ? undefined : "top 220ms cubic-bezier(0.22, 1.4, 0.36, 1), height 180ms ease-out",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
                }}
              />
            ) : null}
            {nav.map(({ to, label, tag, icon: Icon, tour }) => {
              const active = linkActive(to);
              return (
                <Tooltip key={to} delayDuration={200}>
                  <TooltipTrigger asChild>
                    <Link
                      to={to}
                      data-tour={tour}
                      ref={(node) => {
                        itemRefs.current[to] = node;
                      }}
                      onMouseEnter={() => setHoverKey(to)}
                      onFocus={() => setHoverKey(to)}
                      onBlur={() => setHoverKey(null)}
                      className={cn(navBtn, active ? "accent-text text-white" : "text-white/70 hover:text-white")}
                    >
                      <Icon className="h-[20px] w-[20px] shrink-0 stroke-[1.75]" aria-hidden />
                      {density === "stacked" ? (
                        <span className={cn("max-w-[5.5rem] text-center text-[8px] font-semibold uppercase leading-tight tracking-wide", active ? "accent-text" : "text-white/55")}>
                          {tag}
                        </span>
                      ) : density === "wide" ? (
                        <span className="flex min-w-0 flex-col">
                          <span className={cn("truncate text-[12.5px] font-medium leading-tight", active ? "accent-text" : "text-white/85")}>{label}</span>
                          <span className={cn("truncate text-[9px] font-semibold uppercase tracking-wide", active ? "accent-text opacity-80" : "text-white/40")}>{tag}</span>
                        </span>
                      ) : null}
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
          <div className={cn("flex flex-col gap-1 border-t border-white/25 px-1.5 py-3", density === "wide" ? "items-stretch" : "items-center")}>
            {admin && (
              <SideLink to="/dashboard/admin" active={pathname.startsWith("/dashboard/admin")} icon={ShieldCheck} label="Admin" tip="Admin console" density={density} />
            )}
            <InstallSideLink
              variant={density === "wide" ? "row" : "rail"}
              hideLabel={density === "compact"}
              className={density === "wide" ? "gap-2.5 px-2.5 py-2 text-[12.5px] font-medium" : undefined}
            />
            <SideLink to="/account?tab=earn" active={earnActive} icon={Gift} label="Earn" tip="Earn bonus credits: answer the feedback questionnaire or cite Convolve" accent density={density} />
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  to="/account?tab=usage"
                  className={cn(navBtn, usageActive ? "bg-white/[0.08] ring-1 ring-white/20" : "hover:bg-white/[0.06]")}
                >
                  <p className={cn("font-digits text-[11px] font-bold tabular-nums", density === "wide" ? "w-5 shrink-0 text-center" : "text-center", low ? "text-red-300" : "text-white")}>
                    {creditsLabel}
                  </p>
                  <RailText d={density} tag="Credits" label="Credits" className="text-white/45" />
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
                  className={cn(
                    navBtn,
                    accountActive
                      ? "bg-white/12 text-white shadow-[0_0_16px_rgba(255,255,255,0.1)] ring-1 ring-white/30"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <Settings className="h-[20px] w-[20px] shrink-0" aria-hidden />
                  <RailText d={density} tag="Settings" label="Settings" className="text-white/55" />
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
                  className={cn(
                    navBtn,
                    pathname === "/help" ? "bg-white/12 text-white ring-1 ring-white/30" : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <HelpCircle className="h-[20px] w-[20px] shrink-0" aria-hidden />
                  <RailText d={density} tag="Help" label="Help" className="text-white/55" />
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
                  className={cn(
                    navBtn,
                    accountActive
                      ? "bg-white/12 text-white shadow-[0_0_16px_rgba(255,255,255,0.1)] ring-1 ring-white/30"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <User className="h-[20px] w-[20px] shrink-0" aria-hidden />
                  <RailText d={density} tag="Account" label="Account" className="text-white/55" />
                  <span className="sr-only">Account</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="border-white/10 bg-black text-white">
                Account
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>
        {revealed ? (
          <ResizeHandle
            axis="x"
            label="Resize sidebar"
            value={sidebarWidth}
            min={SIDEBAR_WIDTH.min}
            max={SIDEBAR_WIDTH.max}
            defaultValue={SIDEBAR_WIDTH.default}
            step={SIDEBAR_WIDTH.step}
            onChange={setSidebarWidth}
            onDragChange={setResizing}
          />
        ) : null}
      </div>

      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[80] min-w-[168px] rounded-lg border border-white/15 bg-[#0c0c0c] py-1 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.9)]"
          style={{
            left: Math.min(menu.x, typeof window !== "undefined" ? window.innerWidth - 180 : menu.x),
            top: Math.min(menu.y, typeof window !== "undefined" ? window.innerHeight - 56 : menu.y),
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-left text-[13px] font-medium text-white/90 hover:bg-white/[0.08]"
            onClick={() => setPinned(unpinned)}
          >
            {unpinned ? "Pin sidebar" : "Unpin sidebar"}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={sidebarWidth === SIDEBAR_WIDTH.default}
            className="flex w-full px-3 py-2 text-left text-[13px] font-medium text-white/90 hover:bg-white/[0.08] disabled:text-white/35 disabled:hover:bg-transparent"
            onClick={() => {
              resetWorkspaceSize("sidebar");
              setMenu(null);
            }}
          >
            Reset sidebar width
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-left text-[13px] font-medium text-white/90 hover:bg-white/[0.08]"
            onClick={() => {
              resetWorkspaceSize("header");
              setMenu(null);
            }}
          >
            Reset header height
          </button>
        </div>
      ) : null}
    </>
  );
}
