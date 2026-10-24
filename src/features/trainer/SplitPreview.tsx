import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { trainerApi, type SplitPartition, type SplitPreviewRequest, type SplitPreviewResponse } from "@/lib/api";
import { fmtInt } from "@/lib/viz/format";
import { METADATA_SOURCE, PURGE_REASON } from "./options";

/** Server split preview for ``req`` (same code as training), refetched debounced when it changes. */
export function useSplitPreview(req: SplitPreviewRequest | null): {
  data: SplitPreviewResponse | null;
  loading: boolean;
  error: string | null;
} {
  const key = useMemo(() => (req ? JSON.stringify(req) : ""), [req]);
  const [data, setData] = useState<SplitPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!key) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      trainerApi
        .splitPreview(JSON.parse(key) as SplitPreviewRequest)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setData(null);
          setError(e instanceof Error ? e.message : "Could not preview the split");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [key]);
  return { data, loading, error };
}

const PART_LABEL: Record<string, string> = { train: "Training", val: "Validation", test: "Test (held out)" };

const share1 = (p: SplitPartition) => {
  const n1 = p.label_counts["1"] ?? 0;
  return p.samples ? `${Math.round((n1 / p.samples) * 100)}%` : "–";
};

const LABEL_PURGE: Record<string, string> = {
  applied: "Outcome windows checked: no training chart's label period reaches a later partition.",
  unverified:
    "Outcome windows could not be checked for some charts (no label horizon recorded). Their labels may look into the validation period; only chart windows were purged.",
  not_applicable: "No later partition to purge against.",
};

/** Partition counts, label mix, periods, purged charts and warnings of a split preview. */
export function SplitPreviewView({
  data,
  loading,
  error,
}: {
  data: SplitPreviewResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !data) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-white/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Computing the split on the server…
      </p>
    );
  }
  if (error) return <p className="text-[12.5px] text-red-200/80">{error}</p>;
  if (!data) return null;
  if (!data.ok || !data.plan) {
    return (
      <p className="rounded-lg border border-amber-300/25 bg-amber-300/[0.05] px-3 py-2 text-[12.5px] leading-relaxed text-amber-100/85" role="alert">
        {data.error ?? "This split cannot be built for the dataset."}
      </p>
    );
  }
  const plan = data.plan;
  const parts = (["train", "val", "test"] as const).filter((k) => plan.partitions[k]);
  const lw = data.label_window;
  return (
    <div className={loading ? "space-y-3 opacity-60" : "space-y-3"} data-help="train-split-preview">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wide text-white/40">
            <th className="py-1 font-medium">Partition</th>
            <th className="py-1 text-right font-medium">Charts</th>
            <th className="py-1 text-right font-medium">Label 0 / 1</th>
            <th className="py-1 text-right font-medium">Label 1</th>
            <th className="py-1 pl-3 font-medium">Decision dates</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((k) => {
            const p = plan.partitions[k]!;
            return (
              <tr key={k} className="border-t border-white/[0.06]">
                <td className="py-1.5 text-white/80">{PART_LABEL[k]}</td>
                <td className="py-1.5 text-right font-digits tabular-nums text-white/75">{fmtInt(p.samples)}</td>
                <td className="py-1.5 text-right font-digits tabular-nums text-white/55">
                  {fmtInt(p.label_counts["0"] ?? 0)} / {fmtInt(p.label_counts["1"] ?? 0)}
                </td>
                <td className="py-1.5 text-right font-digits tabular-nums text-white/55">{share1(p)}</td>
                <td className="py-1.5 pl-3 font-digits tabular-nums text-white/50">
                  {p.decision_period ? `${p.decision_period[0]} → ${p.decision_period[1]}` : "random sample"}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-white/[0.06]">
            <td className="py-1.5 text-white/60">Left out (purged)</td>
            <td className="py-1.5 text-right font-digits tabular-nums text-white/60">{fmtInt(plan.excluded_total)}</td>
            <td colSpan={3} className="py-1.5 pl-3 text-[12px] text-white/45">
              {Object.entries(plan.excluded_by_reason)
                .map(([r, n]) => `${fmtInt(n)} · ${PURGE_REASON[r] ?? r}`)
                .join("; ") || "none"}
            </td>
          </tr>
        </tbody>
      </table>
      {plan.method === "chronological" || plan.partitions.test ? (
        <p className="text-[12px] leading-relaxed text-white/50">{LABEL_PURGE[plan.label_purge]}</p>
      ) : null}
      <p className="text-[12px] leading-relaxed text-white/45">
        Chart dates from:{" "}
        {Object.entries(plan.metadata_sources)
          .map(([s, n]) => `${METADATA_SOURCE[s] ?? s} (${fmtInt(n)})`)
          .join(", ") || "–"}
        {lw.label_horizon_bars
          ? ` · Label horizon ${lw.label_horizon_bars} bars (${lw.label_horizon_source === "user" ? "entered in the Trainer" : "from the generator settings"})`
          : " · Label horizon unknown"}
      </p>
      {plan.warnings.length ? (
        <ul className="space-y-1 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] px-3 py-2 text-[12px] leading-relaxed text-amber-100/80">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
