import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  Brain,
  Microscope,
  Tags,
  LineChart,
  Rocket,
  BarChart3,
  Settings,
  User,
  HelpCircle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Overview", tag: "Manage", icon: LayoutDashboard },
  { to: "/tools/generator", label: "Datasets", tag: "Generate", icon: Database },
  { to: "/tools/trainer", label: "Models", tag: "Train", icon: Brain },
  { to: "/tools/analysis", label: "Analysis", tag: "Analyse", icon: Microscope },
  { to: "/tools/backtester", label: "Backtesting", tag: "Test", icon: LineChart },
  { to: "/products/labeling-optimizer/technical", label: "Labeling", tag: "Optimize", icon: Tags },
  { to: "/tools/deploy", label: "Deploy", tag: "Deploy", icon: Rocket },
  { to: "/tools/run-log", label: "Analytics", tag: "Review", icon: BarChart3 },
] as const;

export function DashboardSidebar() {
  const { pathname } = useLocation();

  const linkActive = (to: string) => {
    if (to === "/dashboard") return pathname === "/dashboard";
    if (to === "/products/labeling-optimizer/technical") {
      return pathname.startsWith("/products/labeling-optimizer/");
    }
    if (to === "/tools/trainer") {
      if (pathname.startsWith("/products/trainer/analysis/")) return false;
      return pathname === "/tools/trainer" || pathname.startsWith("/products/trainer/");
    }
    if (to === "/tools/analysis") {
      return pathname.startsWith("/tools/analysis") || pathname.startsWith("/products/trainer/analysis/");
    }
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  const accountActive = pathname === "/account";

  return (
    <div className="box-border flex h-full min-h-0 shrink-0 flex-col pt-0">
      <aside
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.08]",
          "bg-black/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl",
          "w-[92px]"
        )}
      >
      <nav className="flex flex-1 flex-col items-center gap-0.5 px-1.5 py-3">
        {nav.map(({ to, label, tag, icon: Icon }) => {
          const active = linkActive(to);
          return (
            <Tooltip key={to} delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  to={to}
                  className={`flex w-full flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-all duration-200 ${
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
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <div className="w-full cursor-default px-1 py-1">
              <p className="text-center font-digits text-[11px] font-bold tabular-nums text-white">12k</p>
              <p className="mb-1 text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/45">
                Credits
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full w-[60%] rounded-full bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.25)]" />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="border-white/10 bg-black text-white">
            Credits balance (60% of monthly allocation)
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Link
              to="/account"
              className={`flex w-full flex-col items-center gap-0.5 rounded-xl py-1 transition-colors ${
                accountActive
                  ? "bg-white/12 text-white shadow-[0_0_16px_rgba(255,255,255,0.1)] ring-1 ring-white/30"
                  : "text-white/70 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <Settings className="h-[20px] w-[20px] shrink-0" aria-hidden />
              <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">
                Settings
              </span>
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
              to="/contact"
              className="flex w-full flex-col items-center gap-0.5 rounded-xl py-1 text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <HelpCircle className="h-[20px] w-[20px] shrink-0" aria-hidden />
              <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">
                Help
              </span>
              <span className="sr-only">Help and questions</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[220px] border-white/10 bg-[#0a0a0a] text-neutral-200">
            Questions? Reach us here — we’re happy to help.
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Link
              to="/account"
              className={`flex w-full flex-col items-center gap-0.5 rounded-xl py-1 transition-colors ${
                accountActive
                  ? "bg-white/12 text-white shadow-[0_0_16px_rgba(255,255,255,0.1)] ring-1 ring-white/30"
                  : "text-white/70 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <User className="h-[20px] w-[20px] shrink-0" aria-hidden />
              <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">
                Account
              </span>
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
  );
}
