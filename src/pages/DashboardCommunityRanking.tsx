import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { dashboardCard } from "@/components/dashboard/dashboardCard";

export default function DashboardCommunityRanking() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="Community ranking" className="mb-2" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 md:p-4">
        <Link
          to="/dashboard"
          className="inline-flex w-fit shrink-0 items-center gap-2 text-[12px] font-medium text-white/70 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to overview
        </Link>
        <div className={`min-h-0 flex-1 rounded-xl ${dashboardCard} p-8`}>
          <p className="text-center text-[15px] font-medium text-white/85">Coming soon — stay tuned.</p>
        </div>
      </div>
    </div>
  );
}
