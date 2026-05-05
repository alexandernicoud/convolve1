import { DEMO_ACCENT } from "@/components/dashboard/demoPortfolioPalette";

/**
 * Demo-only: three donut gauges for L1/L0 match rates — same styling as prediction accuracy.
 * Correct L1 + Wrong L1 = 100% (complementary).
 */
const RINGS = [
  { id: "l1c", label: "Correct L1", pct: 64.2, stroke: DEMO_ACCENT.purple },
  { id: "l1w", label: "Wrong L1", pct: 35.8, stroke: DEMO_ACCENT.pink },
  { id: "l0c", label: "Correct L0", pct: 71.5, stroke: DEMO_ACCENT.whiteLine },
] as const;

const RING_SIZE = 72;
const STROKE = 4;

function Ring({ label, pct, stroke }: { label: string; pct: number; stroke: string }) {
  const size = RING_SIZE;
  const r = (size - STROKE) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;

  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            className="transition-[stroke-dasharray] duration-500"
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-0.5">
          <span className="font-digits text-[12px] font-semibold tabular-nums leading-none text-white">
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>
      <p className="w-full text-center text-[8px] font-medium uppercase leading-tight tracking-[0.08em] text-white/45">
        {label}
      </p>
    </div>
  );
}

export function DemoLabelMatchRates() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col justify-center">
      <p className="mb-1 w-full shrink-0 text-center text-[9px] font-semibold uppercase leading-tight tracking-[0.16em] text-white">
        Label match
      </p>
      <div className="flex w-full flex-col items-center gap-1.5">
        {RINGS.map((row) => (
          <Ring key={row.id} label={row.label} pct={row.pct} stroke={row.stroke} />
        ))}
      </div>
    </div>
  );
}
