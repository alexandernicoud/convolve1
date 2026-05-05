import type { DashboardActivityItem } from "@/lib/api";

function formatActivityTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildDemoActivityLog(now = Date.now()): DashboardActivityItem[] {
  const rows: Omit<DashboardActivityItem, "at">[] = [
    { kind: "training", symbol: "CV‑XL", title: "Train", subtitle: "2,420 cr" },
    { kind: "backtest", symbol: "SPY", title: "BT", subtitle: "148 cr" },
    { kind: "labeling", symbol: "V4", title: "Lbl", subtitle: "36 cr" },
    { kind: "deploy", symbol: "NVDA", title: "Dep", subtitle: "12 cr" },
    { kind: "prediction", symbol: "MSFT", title: "Run", subtitle: "4 cr", confidence: 0.62 },
    { kind: "trade_closed", symbol: "EURUSD", title: "Trade", subtitle: "1 cr", pnl_amount: 412 },
    { kind: "training", symbol: "CV‑S", title: "Train", subtitle: "1,080 cr" },
    { kind: "prediction", symbol: "GLD", title: "Run", subtitle: "4 cr", confidence: 0.54 },
    { kind: "backtest", symbol: "QQQ", title: "BT", subtitle: "212 cr" },
    { kind: "prediction", symbol: "BTC", title: "Run", subtitle: "6 cr", confidence: 0.58 },
    { kind: "trade_open", symbol: "AAPL", title: "Trade", subtitle: "1 cr" },
  ];
  return rows.slice(0, 10).map((r, i) => ({
    ...r,
    at: new Date(now - i * 6.5 * 60_000 - i * 17_000).toISOString(),
  }));
}

/** Demo dashboard — frozen at import time. */
export const DEMO_ACTIVITY_LOG = buildDemoActivityLog();

export function DemoActivityLog({ items }: { items: DashboardActivityItem[] }) {
  const rows = items.slice(0, 10);
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">Activity</p>
      <ul className="mt-2 min-h-0 flex-1 space-y-0 overflow-y-auto overflow-x-hidden pr-0.5">
        {rows.map((item, idx) => (
          <li
            key={`${item.kind}-${item.at}-${idx}`}
            className="flex items-baseline justify-between gap-2 border-b border-white/[0.08] py-1 text-[11px] last:border-0"
          >
            <span className="min-w-0 flex-1 font-digits tabular-nums leading-snug text-white/90">
              <span className="font-semibold text-white">{item.symbol}</span>
              {item.subtitle ? (
                <span className="text-white/55">
                  {" "}
                  · {item.subtitle}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 font-digits text-[9px] leading-snug text-white/45">{formatActivityTime(item.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
