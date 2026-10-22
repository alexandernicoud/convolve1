import { Link } from "react-router-dom";
import { ExternalLink, Download } from "lucide-react";
import type { GlobalRun } from "@/lib/api";
import { AuthorizedDownloadLink } from "@/components/AuthorizedDownloadLink";
import { useRunsStore } from "@/state/runsStore";

type ToolFilter = "training-chart-generator" | "trainer" | "backtester";

function toolLabel(tool: string): string {
  switch (tool) {
    case "labeling-optimizer":
      return "Labeling optimizer";
    case "training-chart-generator":
      return "Chart generator";
    case "trainer":
      return "Trainer";
    case "analysis":
      return "CNN analysis";
    case "backtester":
      return "Backtester";
    case "testdata":
      return "Test data";
    default:
      return tool;
  }
}

function formatTs(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
}

function statusLabel(s: string): string {
  if (s === "succeeded") return "Completed";
  return s;
}

interface RecentRunsBlockProps {
  tool: ToolFilter;
  title?: string;
  maxItems?: number;
}

export default function RecentRunsBlock({ tool, title = "Recent runs", maxItems = 6 }: RecentRunsBlockProps) {
  const runsById = useRunsStore((s) => s.runsById);
  const getRunRoute = useRunsStore((s) => s.getRunRoute);

  const rows: GlobalRun[] = Object.values(runsById)
    .filter((r) => r.tool === tool)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, maxItems);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(255,255,255,0.55)]">{title}</h3>
        <Link
          to="/tools/run-log"
          className="text-xs text-white/55 underline-offset-2 hover:text-white hover:underline"
        >
          All runs
        </Link>
      </div>
      <ul className="space-y-2">
        {rows.map((run) => {
          const href = getRunRoute(run);
          const canView = run.status === "succeeded" || run.status === "failed" || run.status === "running";
          const dl = run.download_zip_url;
          return (
            <li
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[#F5F5F5]">{toolLabel(run.tool)}</div>
                <div className="text-xs text-[#F5F5F5]/50">
                  {statusLabel(run.status)} · {formatTs(run.updated_at)}
                  {run.message ? ` · ${run.message.slice(0, 80)}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {run.status === "running" || run.status === "queued" ? (
                  <span className="text-xs tabular-nums text-white/70">{Math.round((run.progress || 0) * 100)}%</span>
                ) : null}
                {canView ? (
                  <Link
                    to={href}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs font-medium text-white transition hover:bg-white/20"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View
                  </Link>
                ) : null}
                {dl && run.status === "succeeded" ? (
                  <AuthorizedDownloadLink
                    path={dl}
                    filename={`${run.id}.zip`}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 text-xs text-white/90 transition hover:bg-white/10"
                  >
                    <Download className="h-3 w-3" />
                    ZIP
                  </AuthorizedDownloadLink>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
