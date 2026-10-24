import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { FleetOverview } from "@/features/fleet/FleetOverview";

export default function Dashboard() {
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar className="mb-0 shrink-0" />
      <FleetOverview />
    </div>
  );
}
