import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import type { FleetRange } from "./api";
import { fmtAge, pickLayout, type ChartMode, type SecondaryPanel } from "./lib";
import { useFleet } from "./useFleet";
import { useElementSize } from "./ui";
import { auditOverview } from "./viewportAudit";
import { KpiStrip } from "./panels/KpiStrip";
import { EquityPanel } from "./panels/EquityPanel";
import { FleetTable } from "./panels/FleetTable";
import { DailyPnlPanel } from "./panels/DailyPnlPanel";
import { ContributionPanel } from "./panels/ContributionPanel";
import { ExposurePanel } from "./panels/ExposurePanel";
import { HealthEventsPanel } from "./panels/HealthEventsPanel";
import { ActivitySwimlane } from "./panels/ActivitySwimlane";

declare global {
  interface Window {
    __convolveOverviewAudit?: typeof auditOverview;
  }
}

if (import.meta.env.DEV && typeof window !== "undefined") window.__convolveOverviewAudit = auditOverview;

function useNow(stepMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

function StatusBar({ children, tone }: { children: ReactNode; tone: "warn" | "error" | "info" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex h-[22px] shrink-0 items-center gap-2 truncate rounded-md border px-2.5 text-[11.5px]",
        tone === "error" ? "border-[#F87171]/35 bg-[#F87171]/[0.07] text-[#FCA5A5]" : tone === "warn" ? "border-[#FCD34D]/30 bg-[#FCD34D]/[0.06] text-[#FCD34D]" : "border-[#8FB3E0]/30 bg-[#8FB3E0]/[0.06] text-[#C9DBF1]",
      )}
    >
      {children}
    </div>
  );
}

const SECONDARY_COLS: Record<number, string> = { 2: "repeat(2, minmax(0,1fr))", 3: "repeat(3, minmax(0,1fr))", 4: "minmax(0,1.15fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.15fr)" };

export function FleetOverview() {
  const [range, setRange] = useState<FleetRange>("1W");
  const [mode, setMode] = useState<ChartMode>("pnl");
  const [breakdown, setBreakdown] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const fleet = useFleet(range);
  const now = useNow(5000);
  const [rootRef, size] = useElementSize<HTMLDivElement>();
  const { data: p, error, okAt, fixture } = fleet;

  const banners: ReactNode[] = [];
  if (fixture) banners.push(<StatusBar key="fx" tone="info">FIXTURE DATA · “{fixture}” · development preview, not your account</StatusBar>);
  if (error && p) banners.push(<StatusBar key="err" tone="warn">Refresh failed ({error}). Showing data from {fmtAge(okAt ? (now - okAt) / 1000 : null)} ago; retrying.</StatusBar>);
  const bannerH = banners.length * 26;
  const pad = size.width >= 768 ? 16 : 12;
  const layout = pickLayout(size.width - pad, Math.max(0, size.height - bannerH - pad));
  const stacked = layout.tier === "stacked";

  let body: ReactNode;
  if (!p) {
    body = fleet.loading ? (
      <div className={cn(dashboardCard, "flex h-full items-center justify-center text-[12px] text-white/40")}>Loading fleet…</div>
    ) : (
      <div role="alert" className={cn(dashboardCard, "flex h-full flex-col items-center justify-center gap-2 text-[12.5px] text-[#FCA5A5]")}>
        Fleet data could not be loaded{error ? `: ${error}` : ""}.
        <button type="button" onClick={fleet.refresh} className="rounded-md border border-white/15 px-3 py-1 text-[12px] text-white/70 hover:text-white">
          Retry
        </button>
      </div>
    );
  } else {
    const secondary: Record<SecondaryPanel, ReactNode> = {
      daily: <DailyPnlPanel key="daily" p={p} />,
      contribution: <ContributionPanel key="contribution" p={p} hovered={hovered} onHover={setHovered} />,
      exposure: <ExposurePanel key="exposure" p={p} hovered={hovered} />,
      health: <HealthEventsPanel key="health" p={p} now={now} />,
    };
    const sec = layout.secondary;
    body = (
      <div
        className="grid h-full min-h-0"
        style={
          stacked
            ? { gridTemplateRows: `auto 420px 320px repeat(${sec.length}, 220px)`, gap: layout.gap }
            : { gridTemplateRows: layout.rows, gap: layout.gap }
        }
      >
        <div className={stacked ? "h-[64px]" : "min-h-0"}>
          <KpiStrip p={p} compact={layout.compact || stacked} okAt={okAt} error={error} now={now} />
        </div>
        {stacked ? (
          <>
            <EquityPanel p={p} range={range} onRange={setRange} mode={mode} onMode={setMode} breakdown={breakdown} onBreakdown={setBreakdown} hovered={hovered} showUnderwater loadingRange={fleet.loading} />
            <FleetTable p={p} hovered={hovered} onHover={setHovered} compact activity={false} />
            {sec.map((k) => secondary[k])}
          </>
        ) : (
          <>
            <div className="grid min-h-0 gap-[6px]" style={{ gridTemplateColumns: layout.compact ? "minmax(0,7fr) minmax(0,5fr)" : "minmax(0,8fr) minmax(0,4fr)" }}>
              <EquityPanel
                p={p}
                range={range}
                onRange={setRange}
                mode={mode}
                onMode={setMode}
                breakdown={breakdown}
                onBreakdown={setBreakdown}
                hovered={hovered}
                showUnderwater={layout.showUnderwater}
                loadingRange={fleet.loading}
              />
              <FleetTable p={p} hovered={hovered} onHover={setHovered} compact={layout.compact} activity={layout.tableActivity} />
            </div>
            <div className="grid min-h-0 gap-[6px]" style={{ gridTemplateColumns: SECONDARY_COLS[sec.length] ?? `repeat(${sec.length}, minmax(0,1fr))` }}>
              {sec.map((k) => secondary[k])}
            </div>
            {layout.showSwimlane ? <ActivitySwimlane p={p} hovered={hovered} onHover={setHovered} /> : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-fleet-root
      data-tier={p ? layout.tier : "loading"}
      data-fleet-state={p ? (p.bots.length ? "active" : "inactive") : undefined}
      data-scroll-allowed={stacked ? "stacked" : undefined}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-1 p-1.5 md:p-2", stacked ? "overflow-y-auto" : "overflow-hidden")}
    >
      {banners}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
