import type { Bot } from "@/lib/api";
import { formatSignal } from "@/components/dashboard/dashboardMetrics";

type Props = {
  bots: Bot[];
};

export function AccountSignalMix({ bots }: Props) {
  const live = bots.filter((b) => (b.lifecycle_state ?? "active") !== "archived");
  let long = 0;
  let short = 0;
  let neutral = 0;
  for (const b of live) {
    const sig = formatSignal(b.last_signal || b.latest_run?.signal || b.latest_run?.label);
    if (sig === "LONG") long += 1;
    else if (sig === "SHORT") short += 1;
    else neutral += 1;
  }
  const n = live.length || 1;
  const rows = [
    { label: "Long", count: long, width: (long / n) * 100 },
    { label: "Short", count: short, width: (short / n) * 100 },
    { label: "Neutral", count: neutral, width: (neutral / n) * 100 },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
        Fleet signals
      </p>
      <p className="mt-0.5 shrink-0 text-[10px] text-white/40">Latest signal across all bots.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-2">
            <p className="text-[9px] uppercase tracking-[0.1em] text-white/40">{r.label}</p>
            <p className="font-digits text-[22px] font-semibold tabular-nums text-white">{r.count}</p>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={`${r.label}-bar`}>
            <div className="mb-0.5 flex justify-between text-[10px] text-white/50">
              <span>{r.label}</span>
              <span className="font-digits">{r.width.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-white/55" style={{ width: `${r.width}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
