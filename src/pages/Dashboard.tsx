import { useEffect, useState } from "react";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { FleetOverview } from "@/features/fleet/FleetOverview";

const GUIDE_KEY = "dashboard-workflow-guide-dismissed";

function WorkflowGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/[0.15] bg-[#0f1116] p-6 shadow-[0_36px_100px_-48px_rgba(0,0,0,0.9)]">
        <h2 className="text-[clamp(1.15rem,2.2vw,1.5rem)] font-semibold tracking-tight text-white">Workspace flow</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/72">Follow this order to move from idea to live execution.</p>
        <ol className="mt-4 space-y-2 text-sm text-white/88">
          <li>1. Generate data</li>
          <li>2. Train model</li>
          <li>3. Analyze signals</li>
          <li>4. Backtest strategy</li>
          <li>5. Deploy bot</li>
          <li>6. Monitor in dashboard</li>
        </ol>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 inline-flex rounded-full border border-white/25 bg-white/[0.08] px-5 py-2.5 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/[0.14]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    try {
      setShowGuide(window.localStorage.getItem(GUIDE_KEY) !== "1");
    } catch {
      setShowGuide(true);
    }
  }, []);

  const closeGuide = () => {
    setShowGuide(false);
    try {
      window.localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      // no-op
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar className="mb-0 shrink-0" />
      <FleetOverview />
      {showGuide ? <WorkflowGuide onClose={closeGuide} /> : null}
    </div>
  );
}
