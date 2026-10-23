import { cx } from "@/features/review/components/primitives";
import type { AuditDefect } from "../lib";
import { Card, Disclosure, TONE_DOT, TONE_TEXT } from "../ui";
import { useResults } from "../state";

const SEVERITY: Record<AuditDefect["severity"], string> = {
  critical: "border-red-400/35 text-red-200/90",
  high: "border-amber-300/35 text-amber-100/85",
  medium: "border-white/[0.18] text-white/70",
  low: "border-white/[0.1] text-white/50",
};

function fmtValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function FindingsTab() {
  const { conclusion: c, audit, artifacts } = useResults();
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <Card title="Conclusion" note={c.summary}>
          <dl className="divide-y divide-white/[0.06]">
            {c.items.map((it) => (
              <div key={it.key} className="grid gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt className="flex items-center gap-2 text-[13px] text-white/50">
                  <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[it.tone])} />
                  {it.label}
                </dt>
                <dd className="min-w-0 text-[13px]">
                  <p className={cx("text-[13px]", TONE_TEXT[it.tone])}>{it.value}</p>
                  {it.detail ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/45">{it.detail}</p> : null}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Next steps">
          <ol className="space-y-2.5">
            {c.nextSteps.map((s, i) => (
              <li key={s} className="flex gap-3 text-[13px] leading-relaxed text-white/80">
                <span className="mt-px font-digits text-white/35 tabular-nums">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {audit?.defects?.length ? (
        <Card title="Methodology defects" note="Found by the audit in the optimizer as it ran. The optimizer's mathematics were not changed; the market-valued figures show their effect.">
          <ul className="divide-y divide-white/[0.06]">
            {audit.defects.map((d) => (
              <li key={d.id} className="grid gap-1.5 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-4">
                <span className={cx("h-fit w-fit rounded-md border px-1.5 py-px text-[11.5px] capitalize", SEVERITY[d.severity])}>{d.severity}</span>
                <div className="min-w-0">
                  <p className="text-[13.5px] text-white/90">{d.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/50">{d.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {audit ? (
          <Card title="What the score measures">
            <dl className="divide-y divide-white/[0.06] text-[13px]">
              {[
                ["Objective", audit.objective.label],
                ["Entry", audit.payoff_model.entry],
                ["Sizing", audit.payoff_model.sizing],
                ["Exits", audit.payoff_model.exits],
                ["Expiry", audit.payoff_model.expiry],
                ["Costs", audit.payoff_model.costs_round_trip_pct != null ? `${audit.payoff_model.costs_round_trip_pct}% round trip` : "—"],
                ["Market-valued audit", audit.mark_to_market.description],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-white/45">{k}</dt>
                  <dd className="text-white/80">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}
        {audit?.configuration?.length ? (
          <Card title="Configured vs applied settings" note="Values from the run form compared with what the optimizer actually used.">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-left text-white/45">
                    <th className="py-2 pr-3 font-normal">Setting</th>
                    <th className="py-2 pl-3 text-right font-normal">Configured</th>
                    <th className="py-2 pl-3 text-right font-normal">Applied</th>
                  </tr>
                </thead>
                <tbody className="font-digits tabular-nums">
                  {audit.configuration.map((r) => (
                    <tr key={r.field} className="border-b border-white/[0.05]">
                      <td className="py-2 pr-3 font-sans text-white/70">
                        {r.field}
                        {r.note ? <span className="ml-2 text-white/35">{r.note}</span> : null}
                      </td>
                      <td className="py-2 pl-3 text-right text-white/60">{fmtValue(r.configured)}</td>
                      <td className={cx("py-2 pl-3 text-right", r.match ? "text-white/80" : "text-amber-200/90")}>{fmtValue(r.applied)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>

      <Card bodyClassName="px-0 pb-0 sm:px-0">
        <Disclosure title="Charts from the previous results page that are not shown" meta="2 items">
          <ul className="space-y-2 text-[12.5px] leading-relaxed text-white/55">
            <li>
              <span className="text-white/80">Best CAGR vs benchmarks.</span> It compared an in-sample maximum over the full grid against index CAGRs from different, unmatched
              windows; the comparison is not meaningful. Buy &amp; hold over the same window is shown instead.
            </li>
            <li>
              <span className="text-white/80">Histogram of annual linear P/L.</span> Replaced by the full-grid distribution of compounded scores (label payoff and market-valued)
              on the Search space tab, which uses the optimizer's actual objective.
            </li>
          </ul>
        </Disclosure>
        <Disclosure title="Exported files" meta={`${artifacts.length} artifacts · included in Export ZIP`}>
          <ul className="grid gap-x-6 gap-y-1 font-mono text-[12px] text-white/50 sm:grid-cols-2 lg:grid-cols-3">
            {artifacts.map((a) => (
              <li key={a} className="truncate" title={a}>
                {a}
              </li>
            ))}
          </ul>
        </Disclosure>
      </Card>
    </div>
  );
}
