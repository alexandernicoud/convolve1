import { classBalance, int } from "../lib/format";
import { Missing } from "./primitives";

const SHADES = ["bg-white/80", "bg-white/35", "bg-white/60", "bg-white/20", "bg-white/45"];

export function ClassBalanceBar({ dist, detailed }: { dist?: Record<string, number> | null; detailed?: boolean }) {
  const parts = classBalance(dist);
  if (parts.length === 0) return <Missing />;
  const title = parts.map((p) => `label ${p.label}: ${p.count} (${(p.share * 100).toFixed(1)}%)`).join("\n");
  return (
    <div className={detailed ? "space-y-2" : "w-28"} title={title}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-white/[0.05]" role="img" aria-label={title}>
        {parts.map((p, i) => (
          <div key={p.label} className={SHADES[i % SHADES.length]} style={{ width: `${p.share * 100}%` }} />
        ))}
      </div>
      {detailed ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {parts.map((p, i) => (
            <span key={p.label} className="inline-flex items-center gap-1.5 font-digits text-[13px] tabular-nums text-white/70">
              <span className={`h-2 w-2 rounded-sm ${SHADES[i % SHADES.length]}`} />
              label {p.label} · {int(p.count)} · {(p.share * 100).toFixed(1)}%
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 font-digits text-[12px] tabular-nums text-white/45">
          {parts.map((p) => `${p.label}:${(p.share * 100).toFixed(0)}%`).join("  ")}
        </div>
      )}
    </div>
  );
}
