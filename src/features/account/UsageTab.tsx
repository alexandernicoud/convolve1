import { Link } from "react-router-dom";
import { REASON_LABELS, type CreditSummary, type PlanCatalogue } from "@/features/credits/model";
import { runHref, type Loadable, type RunSummary, type Usage } from "./data";
import { BarChart, Card, Empty, Notice, Stat, formatDateTime, formatDuration } from "./ui";

const STATUS_STYLE: Record<string, string> = {
  succeeded: "text-[#a6ecc8]",
  failed: "text-red-300",
  interrupted: "text-red-300",
  cancelled: "text-white/45",
  running: "text-amber-200",
  queued: "text-amber-200",
};

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function RunList({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) return <Empty>No research runs yet. Runs you start in any tool appear here.</Empty>;
  return (
    <ul className="divide-y divide-white/[0.06]">
      {runs.map((r) => {
        const href = runHref(r);
        const body = (
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-white/85">{r.label}</div>
              <div className="truncate font-mono text-[11px] text-white/35">{r.id}</div>
              {r.error_summary && <div className="mt-1 line-clamp-1 text-xs text-red-300/80">{r.error_summary}</div>}
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-xs capitalize ${STATUS_STYLE[r.status] ?? "text-white/55"}`}>{r.status}</div>
              <div className="text-[11px] text-white/35">{formatDateTime(r.created_at)}</div>
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

  return (
    <>
      <Card
        title="Credits"
        description={
          !c
            ? undefined
            : enforced
              ? "Your balance is held and charged by the server. Each run is charged once, when it is accepted."
              : "Runs are not charged yet. When charging starts, each run's cost below is deducted from a server-held balance."
        }
        action={
          <Link to="/pricing" className="shrink-0 text-sm text-white/55 underline-offset-4 hover:text-white hover:underline">
            Plans
          </Link>
        }
      >
        {credits.error && <Notice kind="error">{credits.error}</Notice>}
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
        <Card title="Credit history" description="Credits used per day over the last 30 days, net of refunds.">
          {c.transactions.length === 0 ? (
            <Empty>
              {enforced
                ? "No credit activity yet."
                : "No credits have been charged. History appears here once charging is switched on."}
            </Empty>
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

      {c && c.transactions.length > 0 && (
        <Card title="Recent transactions">
          <ul className="divide-y divide-white/[0.06]">
            {c.transactions.slice(0, 15).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-white/80">
                    {REASON_LABELS[t.reason] ?? t.reason}
                    {t.tool_label ? ` · ${t.tool_label}` : ""}
                  </div>
                  <div className="truncate text-[11px] text-white/35">
                    {formatDateTime(t.created_at)}
                    {t.note ? ` · ${t.note}` : ""}
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
            ))}
          </ul>
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

function ActivitySection({ usage }: { usage: Loadable<Usage> }) {
  const u = usage.data;
  if (usage.error) {
    return (
      <Card title="Research activity">
        <Notice kind="error">{usage.error}</Notice>
      </Card>
    );
  }
  if (!u) return null;
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

      <Card title="Recent runs">
        <RunList runs={u.recent} />
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
      <ActivitySection usage={usage} />
    </div>
  );
}
