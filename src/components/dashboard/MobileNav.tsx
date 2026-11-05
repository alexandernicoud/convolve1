import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FlaskConical, Gift, HelpCircle, LayoutDashboard, Menu, Network, ShieldCheck, User, Brain, Wallet } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsAdmin } from "@/features/admin/useIsAdmin";
import { InstallSideLink } from "@/features/pwa/InstallUI";
import { cn } from "@/lib/utils";
import { nav, sidebarLinkActive } from "./DashboardSidebar";

const TABS = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/tools/run-log", label: "Search Hub", icon: Network },
  { to: "/tools/generator", label: "Research", icon: FlaskConical, primary: true },
  { to: "/tools/trainer", label: "Models", icon: Brain },
] as const;

/** Phone layout: a bottom tab bar replaces the icon rail; everything else lives in "More". */
export function MobileNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const admin = useIsAdmin();
  const extra = [
    ...(admin ? [{ to: "/dashboard/admin", label: "Admin console", icon: ShieldCheck }] : []),
    { to: "/account?tab=earn", label: "Earn credits", icon: Gift },
    { to: "/account?tab=usage", label: "Usage & credits", icon: Wallet },
    { to: "/help", label: "Help & guided tour", icon: HelpCircle },
    { to: "/account", label: "Account & settings", icon: User },
  ];
  return (
    <>
      <nav
        aria-label="Workspace"
        className="fixed inset-x-0 bottom-0 z-[45] flex h-[60px] items-stretch justify-around border-t border-white/[0.1] bg-black/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {TABS.map(({ to, label, icon: Icon, ...rest }) => {
          const active = sidebarLinkActive(pathname, to);
          const primary = "primary" in rest && rest.primary;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium",
                active ? "text-white" : "text-white/55",
              )}
            >
              <span className={cn("flex h-7 w-11 items-center justify-center rounded-full", primary ? "bg-white text-[#0a0a0a]" : active ? "bg-white/12" : "")}>
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              {label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-white/55">
          <span className="flex h-7 w-11 items-center justify-center rounded-full">
            <Menu className="h-[18px] w-[18px]" aria-hidden />
          </span>
          More
        </button>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl border-white/10 bg-[#0a0a0a] px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 text-white">
          <SheetTitle className="px-3 pb-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-white/45">Workspace</SheetTitle>
          <div className="grid grid-cols-2 gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px]",
                  sidebarLinkActive(pathname, to) ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/[0.06]",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0 text-white/60" aria-hidden />
                {label}
              </Link>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 border-t border-white/[0.08] pt-3">
            {extra.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] text-white/80 hover:bg-white/[0.06]">
                <Icon className="h-[18px] w-[18px] shrink-0 text-white/60" aria-hidden />
                {label}
              </Link>
            ))}
            <InstallSideLink variant="row" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
