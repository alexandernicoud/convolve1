import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, RefreshCw } from "lucide-react";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { AsyncBoundary, SkeletonPanel } from "@/components/skeleton/Skeleton";
import { useApi } from "@/features/account/data";
import { Empty, Notice } from "@/features/account/ui";
import { FeedbackReviewContent } from "@/features/feedback/FeedbackReviewPage";
import { cn } from "@/lib/utils";

type AdminUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  last_activity: string | null;
  confirmed: boolean | null;
  provider: string | null;
  terms_accepted: boolean;
  opened_workspace: boolean;
  runs: number;
  runs_succeeded: number;
  runs_failed: number;
  datasets: number;
  models: number;
  bots: number;
  credits: number;
  feedback_done: boolean;
  referrals: number;
};
type Overview = {
  generated_at: string;
  source: "auth.users" | "profiles";
  totals: Record<string, number>;
  signups_daily: { date: string; count: number }[];
  tools: ({ tool: string; total: number } & Record<string, number | string>)[];
  users: AdminUser[];
  recent_runs: {
    id: string;
    tool: string;
    status: string;
    stage: string | null;
    error: string | null;
    email: string | null;
    created_at: string | null;
    finished_at: string | null;
  }[];
};
type Message = { id: string; name: string; email: string; topic: string | null; message: string; notified: boolean; created_at: string | null };

const TABS = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["runs", "Runs"],
  ["messages", "Messages"],
  ["feedback", "Questionnaire"],
] as const;
type Tab = (typeof TABS)[number][0];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const TOOL_LABELS: Record<string, string> = {
  "training-chart-generator": "Generator",
  trainer: "Trainer",
  backtester: "Backtester",
  testdata: "Test data",
  "labeling-optimizer": "Labeling optimizer",
  analysis: "Analysis",
};

/** Administrators only: every request answers 404 to other accounts, so the page shows nothing to them. */
export default function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([id]) => id === params.get("tab"))?.[0] ?? "overview") as Tab;
  const data = useApi<Overview>("/api/admin/overview");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="Admin console" className="mb-2" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-2">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setParams({ tab: id }, { replace: true })}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm transition",
                    tab === id ? "border-white/40 bg-white/[0.08] text-white" : "border-white/[0.1] text-white/55 hover:text-white",
                  )}
                >
                  {label}
                </button>
              ))}
              <Link
                to="/dashboard/admin/citations"
                className="inline-flex items-center gap-1 rounded-full border border-white/[0.1] px-3.5 py-1.5 text-sm text-white/55 hover:text-white"
              >
                Citations <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            </div>
            <button
              type="button"
              onClick={data.reload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
            </button>
          </div>

          {tab === "feedback" ? (
            <FeedbackReviewContent />
          ) : tab === "messages" ? (
            <Messages />
          ) : data.error && !data.data ? (
            <Notice kind="error">This page is only available to the administrator.</Notice>
          ) : (
            <AsyncBoundary state={data} label="Loading the admin overview" skeleton={<SkeletonPanel rows={6} />}>
              {(d) => (tab === "users" ? <Users users={d.users} /> : tab === "runs" ? <Runs d={d} /> : <OverviewTab d={d} />)}
            </AsyncBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{label}</p>
      <p className="mt-2 font-digits text-2xl tabular-nums text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-white/45">{sub}</p>}
    </div>
  );
}

function OverviewTab({ d }: { d: Overview }) {
  const t = d.totals;
  const max = Math.max(1, ...d.signups_daily.map((x) => x.count));
  const funnel = [
    ["Signed up", t.accounts],
    ["Opened workspace", t.opened_workspace],
    ["Ran an experiment", t.ran_experiment],
    ["Answered questionnaire", t.feedback],
  ] as const;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Accounts" value={t.accounts} sub={`+${t.signups_7d} this week · +${t.signups_30d} in 30 days`} />
        <Tile label="Active this week" value={t.active_7d} sub="started at least one run" />
        <Tile label="Runs" value={t.runs} sub={`${t.runs_7d} this week`} />
        <Tile label="Inbox" value={t.contact_messages} sub={`${t.contact_messages_7d} messages this week · ${t.citations_pending} citations pending`} />
      </div>

      <section className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5">
        <h2 className="text-sm font-medium text-white">Sign-ups, last 30 days</h2>
        <div className="mt-4 flex h-28 items-end gap-1" role="img" aria-label="Daily sign-ups over the last 30 days">
          {d.signups_daily.map((x) => (
            <div key={x.date} className="group relative flex-1" title={`${x.date}: ${x.count}`}>
              <div className="w-full rounded-t bg-[#a6ecc8]/70" style={{ height: `${(x.count / max) * 100}%`, minHeight: x.count ? 4 : 1 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-white/35">
          <span>{d.signups_daily[0]?.date}</span>
          <span>{d.signups_daily[d.signups_daily.length - 1]?.date}</span>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5">
          <h2 className="text-sm font-medium text-white">Funnel</h2>
          <div className="mt-4 space-y-3">
            {funnel.map(([label, n]) => (
              <div key={label}>
                <div className="flex justify-between text-xs text-white/60">
                  <span>{label}</span>
                  <span className="tabular-nums text-white/85">
                    {n} {t.accounts ? `· ${Math.round((n / t.accounts) * 100)}%` : ""}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-white/[0.06]">
                  <div className="h-2 rounded-full bg-white/70" style={{ width: `${t.accounts ? (n / t.accounts) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5">
          <h2 className="text-sm font-medium text-white">Runs by tool</h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-white/40">
              <tr>
                <th className="py-1.5 font-medium">Tool</th>
                <th className="py-1.5 text-right font-medium">Total</th>
                <th className="py-1.5 text-right font-medium">Succeeded</th>
                <th className="py-1.5 text-right font-medium">Failed</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {d.tools.map((r) => (
                <tr key={r.tool} className="border-t border-white/[0.06]">
                  <td className="py-1.5">{TOOL_LABELS[r.tool] ?? r.tool}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.total}</td>
                  <td className="py-1.5 text-right tabular-nums text-[#a6ecc8]">{Number(r.succeeded ?? 0)}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-300">{Number(r.failed ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.tools.length && <p className="mt-3 text-xs text-white/45">No runs yet.</p>}
        </section>
      </div>
      <p className="text-[11px] text-white/35">
        Accounts from {d.source === "auth.users" ? "Supabase sign-ups" : "workspace profiles (people who opened the workspace at least once)"}. Updated{" "}
        {when(d.generated_at)}.
      </p>
    </div>
  );
}

function Users({ users }: { users: AdminUser[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? users.filter((u) => (u.email ?? "").toLowerCase().includes(s) || u.id.includes(s)) : users;
  }, [q, users]);
  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by email or id"
        className="input-field w-full max-w-sm text-sm"
        aria-label="Search users"
      />
      <div className="overflow-x-auto rounded-2xl border border-white/[0.09]">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-white/[0.03] text-white/45">
            <tr>
              {["Email", "Signed up", "Last activity", "Runs (ok / failed)", "Datasets", "Models", "Bots", "Feedback", "Invites", "Status"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-white/80">
            {shown.map((u) => (
              <tr key={u.id} className="border-t border-white/[0.06] align-top">
                <td className="px-3 py-2">
                  <div className="text-white">{u.email ?? "—"}</div>
                  <div className="font-mono text-[10px] text-white/30">{u.id.slice(0, 8)}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{when(u.created_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{when(u.last_activity ?? u.last_sign_in_at)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {u.runs} <span className="text-white/40">({u.runs_succeeded} / {u.runs_failed})</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{u.datasets}</td>
                <td className="px-3 py-2 tabular-nums">{u.models}</td>
                <td className="px-3 py-2 tabular-nums">{u.bots}</td>
                <td className="px-3 py-2">{u.feedback_done ? "Yes" : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{u.referrals}</td>
                <td className="px-3 py-2 text-white/55">
                  {[
                    u.confirmed === false ? "unconfirmed" : null,
                    u.opened_workspace ? null : "never opened workspace",
                    u.terms_accepted ? null : "terms pending",
                    u.provider,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "ok"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="p-4 text-xs text-white/45">No accounts match.</p>}
      </div>
    </div>
  );
}

function Runs({ d }: { d: Overview }) {
  if (!d.recent_runs.length) return <Empty>No runs yet.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.09]">
      <table className="w-full min-w-[800px] text-left text-xs">
        <thead className="bg-white/[0.03] text-white/45">
          <tr>
            {["Started", "Tool", "Account", "Status", "Error"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-white/80">
          {d.recent_runs.map((r) => (
            <tr key={r.id} className="border-t border-white/[0.06] align-top">
              <td className="px-3 py-2 whitespace-nowrap">{when(r.created_at)}</td>
              <td className="px-3 py-2">{TOOL_LABELS[r.tool] ?? r.tool}</td>
              <td className="px-3 py-2">{r.email ?? "—"}</td>
              <td className={cn("px-3 py-2", r.status === "failed" ? "text-red-300" : r.status === "succeeded" ? "text-[#a6ecc8]" : "text-white/70")}>
                {r.status}
              </td>
              <td className="max-w-[28rem] px-3 py-2 text-white/55">{r.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Messages() {
  const list = useApi<{ total: number; messages: Message[] }>("/api/admin/contact");
  if (list.error && !list.data) return <Notice kind="error">This page is only available to the administrator.</Notice>;
  return (
    <AsyncBoundary
      state={list}
      label="Loading messages"
      skeleton={<SkeletonPanel rows={4} />}
      isEmpty={(d) => d.messages.length === 0}
      empty={<Empty>No messages yet.</Empty>}
    >
      {(d) => (
        <div className="space-y-3">
          <p className="text-sm text-white/55">
            {d.total} {d.total === 1 ? "message" : "messages"} from the contact form. Reply by email; the sender's address is shown on each.
          </p>
          {d.messages.map((m) => (
            <article key={m.id} className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5">
              <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
                <span>
                  <span className="text-sm text-white">{m.name || "No name"}</span>{" "}
                  <a href={`mailto:${m.email}`} className="underline underline-offset-2 hover:text-white">
                    {m.email}
                  </a>
                  {m.topic ? <span className="ml-2 rounded-full border border-white/15 px-2 py-0.5">{m.topic}</span> : null}
                </span>
                <span>{when(m.created_at)}</span>
              </header>
              <p className="mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/85">{m.message}</p>
            </article>
          ))}
        </div>
      )}
    </AsyncBoundary>
  );
}
