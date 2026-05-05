import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  Brain,
  Microscope,
  Tags,
  LineChart,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** First seven primary nav entries from `DashboardSidebar` (excludes Analytics / Review). */
const NAV: readonly { to: string; tag: string; icon: LucideIcon }[] = [
  { to: "/dashboard", tag: "Manage", icon: LayoutDashboard },
  { to: "/tools/generator", tag: "Generate", icon: Database },
  { to: "/tools/trainer", tag: "Train", icon: Brain },
  { to: "/tools/analysis", tag: "Analyse", icon: Microscope },
  { to: "/tools/backtester", tag: "Test", icon: LineChart },
  { to: "/products/labeling-optimizer/technical", tag: "Optimize", icon: Tags },
  { to: "/tools/deploy", tag: "Deploy", icon: Rocket },
] as const;

/** ~20% larger than prior 113px strip. */
const FAKE_W = "w-[136px]";
const ICON_PX = "h-[29px] w-[29px]";
const TAG_TEXT = "text-[12px]";

/**
 * Static decorative clone of `DashboardSidebar` primary nav — same icon set, box style, and labels as tags.
 * No tooltips (avoids provider requirement); links remain real for accessibility.
 */
export function ProductHubFakeSidebar({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08]",
        "bg-black/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl",
        FAKE_W,
        className
      )}
      aria-label="Dashboard navigation (extract)"
    >
      <nav className="flex flex-col items-center gap-0.5 px-1.5 py-3">
        {NAV.map(({ to, tag, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex w-full flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 text-white/70 transition-all duration-200 hover:bg-white/[0.06] hover:text-white"
          >
            <Icon className={cn(ICON_PX, "shrink-0 stroke-[1.75]")} aria-hidden />
            <span
              className={cn(
                "max-w-[5.5rem] text-center font-semibold uppercase leading-tight tracking-wide text-white/55",
                TAG_TEXT
              )}
            >
              {tag}
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
