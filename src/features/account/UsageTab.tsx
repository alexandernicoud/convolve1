import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { REASON_LABELS, type CreditSummary, type LedgerEntry, type PlanCatalogue } from "@/features/credits/model";
import { runHref, type Loadable, type RunSummary, type Usage } from "./data";
import { BarChart, Card, Empty, Notice, Stat, formatDateTime, formatDuration } from "./ui";
import { LoadingRegion, SkeletonChart, SkeletonStatGrid } from "@/components/skeleton/Skeleton";

const STATUS_STYLE: Record<string, string> = {
  succeeded: "text-[#a6ecc8]",
  failed: "text-red-300",
  interrupted: "text-red-300",
  cancelled: "text-white/45",
  running: "text-amber-200",
  queued: "text-amber-200",
};

const RECENT_PREVIEW = 5;

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function reasonKind(reason: string): "reward" | "charge" | "refund" | "other" {
  if (reason === "charge") return "charge";
  if (reason === "refund" || reason === "credit_refund" || reason === "credit_refund_reversal") return "refund";
  if (reason === "grant" || reason === "allocation" || reason === "adjustment" || reason === "subscription" || reason === "purchase" || reason === "reward") {
    return "reward";
  }
  return "other";
}

function TransactionRow({ t }: { t: LedgerEntry }) {
  const kind = reasonKind(t.reason);
  const title = REASON_LABELS[t.reason] ?? t.reason;
  return (
    <li className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="truncate text-white/85">
          {title}
          {t.tool_label ? ` · ${t.tool_label}` : ""}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/40">
          <span>{formatDateTime(t.created_at)}</span>
          <span className="text-white/25">·</span>
          <span className="capitalize">{kind === "reward" ? "credit added" : kind === "charge" ? "deduction" : kind === "refund" ? "refund" : t.reason}</span>
          {t.run_id ? (
            <>
              <span className="text-white/25">·</span>
              <span className="font-mono truncate" title={t.run_id}>
                run {t.run_id.slice(0, 8)}
              </span>
            </>
          ) : null}
          {t.note ? (
            <>
              <span className="text-white/25">·</span>
              <span className="truncate">{t.note}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={`tabular-nums ${t.delta < 0 ? "text-white" : "text-[#a6ecc8]"}`}>
          {t.delta > 0 ? "+" : ""}
          {t.delta}
        </div>
        <div className="text-[11px] tabular-nums text-white/35">balance {t.balance_after}</div>
      </div>
    </li>
  );
}

export function RunList({
  runs,
  creditsByRun,
  preview = runs.length,
  expanded,
}: {
  runs: RunSummary[];
  creditsByRun?: Map<string, number>;
  preview?: number;
  expanded?: boolean;
}) {
  if (runs.length === 0) return <Empty>No research runs yet. Runs you start in any tool appear here.</Empty>;
  const shown = expanded || preview >= runs.length ? runs : runs.slice(0, preview);
  return (
    <ul className="divide-y divide-white/[0.06]">
      {shown.map((r) => {
        const href = runHref(r);
        const credits = creditsByRun?.get(r.id);
        const body = (
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-white/85">{r.label}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-white/40">
                <span className="capitalize">{r.tool.replace(/_/g, " ")}</span>
                <span className="text-white/25">·</span>
                <span>{formatDateTime(r.created_at)}</span>
              </div>
              {r.error_summary && <div className="mt-1 line-clamp-1 text-xs text-red-300/80">{r.error_summary}</div>}
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-xs capitalize ${STATUS_STYLE[r.status] ?? "text-white/55"}`}>{r.status}</div>
              <div className="text-[11px] tabular-nums text-white/40">
                {credits == null ? "not charged" : credits === 0 ? "no charge" : `${Math.abs(credits)} cr`}
              </div>
            </div>
          </div>
        );
        return (
          <li key={r.id}>
            {href ? (
              <Link to={href} className="block rounded-lg transition hover:bg-white/[0.03]">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CreditsSection({ credits, plans }: { credits: Loadable<CreditSummary>; plans: Loadable<PlanCatalogue> }) {
  const c = credits.data;
  const enforced = c?.mode === "enforce";
  const last30 = c?.daily.reduce((s, d) => s + d.credits, 0) ?? 0;
  const [txExpanded, setTxExpanded] = useState(false);
  const txPreview = 12;
  const txs = c?.transactions ?? [];
  const shownTx = txExpanded || txs.length <= txPreview ? txs : txs.slice(0, txPreview);

  return (
    <>
      <Card
        title="Credits"
        description={
          !c
            ? undefined
            : enforced
              ? "Your balance is held and charged by the server. Each run is charged once, when it is accepted."
              : "Free beta: research runs are not charged. Ledger entries below still show allocations, rewards and any recorded activity."
        }
        action={
          <Link to="/products#pricing" className="shrink-0 text-sm text-white/55 underline-offset-4 hover:text-white hover:underline">
            Plans
          </Link>
        }
      >
        {credits.error && <Notice kind="error">{credits.error}</Notice>}
        {!c && !credits.error && (
          <LoadingRegion label="Loading credit balance">
            <SkeletonStatGrid />
          </LoadingRegion>
        )}
        {c && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Available" value={enforced ? c.balance.toLocaleString() : "—"} hint={enforced ? undefined : "Not charged yet"} />
            <Stat label="Allocated in total" value={c.totals.allocated.toLocaleString()} />
            <Stat label="Used in total" value={c.totals.consumed.toLocaleString()} hint={c.totals.refunded ? `${c.totals.refunded} refunded` : undefined} />
            <Stat label="Used, last 30 days" value={last30.toLocaleString()} />
          </div>
        )}
      </Card>

      {c && (
        <Card
          title="Credit History"
          description="Ledger of credits added, deducted and refunded. Free-beta compute usage is not billed and does not create charge rows."
        >
          {txs.length === 0 ? (
            <Empty>
              {enforced
                ? "No credit transactions yet. Allocations, run charges, refunds and rewards will appear here."
                : "No credit transactions yet. During the free beta, runs are not charged. Rewards and allocations appear here when recorded."}
            </Empty>
          ) : (
            <>
              <ul className="divide-y divide-white/[0.06]">
                {shownTx.map((t) => (
                  <TransactionRow key={t.id} t={t} />
                ))}
              </ul>
              {txs.length > txPreview ? (
                <button
                  type="button"
                  onClick={() => setTxExpanded((v) => !v)}
                  className="mt-3 text-sm font-medium text-white/55 underline-offset-4 hover:text-white hover:underline"
                >
                  {txExpanded ? "Show less" : `Show more (${txs.length - txPreview} more)`}
                </button>
              ) : null}
            </>
          )}
        </Card>
      )}

      {c && (
        <Card title="Credits used per day" description="Net credits used per day over the last 30 days (charges minus refunds).">
          {c.daily.every((d) => d.credits === 0) ? (
            <Empty>{enforced ? "No charged usage in the last 30 days." : "No charged usage yet — free-beta runs do not appear here."}</Empty>
          ) : (
            <BarChart
              label="Credits used per day"
              unit="credits"
              data={c.daily.map((d) => ({ key: d.date, label: shortDate(d.date), value: Math.max(0, d.credits) }))}
            />
          )}
        </Card>
      )}

      {c && c.by_tool.length > 0 && (
        <Card title="Credits by tool">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-white/40">
                <th className="pb-2 font-normal">Tool</th>
                <th className="pb-2 text-right font-normal">Runs charged</th>
                <th className="pb-2 text-right font-normal">Credits</th>
              </tr>
            </thead>
            <tbody>
              {c.by_tool.map((t) => (
                <tr key={t.tool} className="border-t border-white/[0.06]">
                  <td className="py-2.5 text-white/80">{t.label}</td>
                  <td className="py-2.5 text-right tabular-nums text-white/60">{t.runs}</td>
                  <td className="py-2.5 text-right tabular-nums text-white">{t.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {plans.data && (
        <Card title="Cost per run" description="Set by the server. Failed or interrupted runs are refunded automatically.">
          <div className="grid gap-2 sm:grid-cols-2">
            {plans.data.run_costs.map((r) => (
              <div key={r.tool} className="flex items-center justify-between rounded-xl border border-white/[0.07] px-4 py-2.5 text-sm">
                <span className="text-white/70">{r.label}</span>
                <span className="tabular-nums text-white">{r.credits} credits</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-white/40">Paper-trading bots, exports and viewing results do not use credits.</p>
        </Card>
      )}
    </>
  );
}

function ActivitySection({ usage, credits }: { usage: Loadable<Usage>; credits: Loadable<CreditSummary> }) {
  const u = usage.data;
  const [expanded, setExpanded] = useState(false);
  const creditsByRun = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of credits.data?.transactions ?? []) {
      if (t.run_id && t.reason === "charge") m.set(t.run_id, (m.get(t.run_id) ?? 0) + t.delta);
    }
    return m;
  }, [credits.data]);

  if (usage.error) {
    return (
      <Card title="Research activity">
        <Notice kind="error">{usage.error}</Notice>
      </Card>
    );
  }
  if (!u) {
    return (
      <Card title="Research activity">
        <LoadingRegion label="Loading research activity" className="space-y-6">
          <SkeletonStatGrid />
          <SkeletonChart height={120} />
        </LoadingRegion>
      </Card>
    );
  }
  const more = Math.max(0, u.recent.length - RECENT_PREVIEW);
  return (
    <>
      <Card title="Research activity" description="Counted from the runs stored under your account.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Runs" value={u.totals.runs} />
          <Stat label="Completed" value={u.totals.succeeded} />
          <Stat label="Failed or interrupted" value={u.totals.failed} />
          <Stat label="Cancelled" value={u.totals.cancelled} hint={u.totals.active ? `${u.totals.active} in progress` : undefined} />
        </div>
        <div className="mt-6">
          {u.totals.runs === 0 ? (
            <Empty>No runs yet. Start with a dataset in the generator.</Empty>
          ) : (
            <BarChart
              label="Runs per week, last 12 weeks"
              unit="runs"
              data={u.weekly.map((w) => ({ key: w.week, label: shortDate(w.week), value: w.runs }))}
            />
          )}
        </div>
      </Card>

      {u.by_tool.length > 0 && (
        <Card title="Runs by tool">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-sm">
              <thead>
                <tr className="text-left text-xs text-white/40">
                  <th className="pb-2 font-normal">Tool</th>
                  <th className="pb-2 text-right font-normal">Runs</th>
                  <th className="pb-2 text-right font-normal">Completed</th>
                  <th className="pb-2 text-right font-normal">Failed</th>
                  <th className="pb-2 text-right font-normal">Run time</th>
                </tr>
              </thead>
              <tbody>
                {u.by_tool.map((t) => (
                  <tr key={t.tool} className="border-t border-white/[0.06]">
                    <td className="py-2.5 text-white/80">{t.label}</td>
                    <td className="py-2.5 text-right tabular-nums text-white">{t.runs}</td>
                    <td className="py-2.5 text-right tabular-nums text-white/60">{t.succeeded}</td>
                    <td className="py-2.5 text-right tabular-nums text-white/60">{t.failed}</td>
                    <td className="py-2.5 text-right tabular-nums text-white/60">
                      {t.duration_seconds > 0 ? formatDuration(t.duration_seconds) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-white/35">Run time is measured from start to finish for runs with both timestamps.</p>
        </Card>
      )}

      <Card title="Recent runs" description="Most recent research runs. Expand to see more from this page.">
        <RunList runs={u.recent} creditsByRun={creditsByRun} preview={RECENT_PREVIEW} expanded={expanded} />
        {more > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 text-sm font-medium text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            {expanded ? "Show less" : `Show more (${more} more)`}
          </button>
        ) : null}
      </Card>

      <Card title="Stored resources" description="What your account currently holds.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Datasets" value={u.resources.datasets} />
          <Stat label="Models" value={u.resources.models} />
          <Stat label="Paper bots" value={u.resources.bots} hint={`${u.resources.active_bots} active`} />
          <Stat label="Measured run time" value={u.resources.run_seconds > 0 ? formatDuration(u.resources.run_seconds) : "—"} />
        </div>
      </Card>
    </>
  );
}

export function UsageTab({
  credits,
  usage,
  plans,
}: {
  credits: Loadable<CreditSummary>;
  usage: Loadable<Usage>;
  plans: Loadable<PlanCatalogue>;
}) {
  return (
    <div className="space-y-6">
      <CreditsSection credits={credits} plans={plans} />
      <ActivitySection usage={usage} credits={credits} />
    </div>
  );
}
