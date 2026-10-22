import { ArrowUpRight, Download } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewRun } from "@/lib/api";
import { AuthorizedDownloadLink } from "@/components/AuthorizedDownloadLink";
import { useReview } from "../ReviewContext";
import { formatDate, formatDuration } from "../lib/format";
import { TOOL_LABELS } from "../lib/naming";
import { runSummary } from "../lib/runSummary";
import { DataTable, type Column } from "../components/DataTable";
import { LibraryToolbar, useLibraryFilter } from "../components/LibraryToolbar";
import { FavoriteToggle } from "../components/LabelEditor";
import { AssetTitle, useRunRoute } from "../components/assets";
import { btnSm, Chip, cx, EmptyState, KindTag, Missing, StatusPill } from "../components/primitives";

const STATUS_GROUPS: Record<string, string[]> = {
  active: ["running", "queued"],
  done: ["succeeded"],
  failed: ["failed", "interrupted", "cancelled"],
};

const RUN_FAMILIES = [
  { slug: "backtester", title: "Backtests" },
  { slug: "labeling-optimizer", title: "Labeling optimizers" },
  { slug: "training-chart-generator", title: "Chart generators" },
  { slug: "testdata", title: "Test datasets" },
  { slug: "trainer", title: "Model training" },
  { slug: "analysis", title: "CNN analysis" },
];

export function RunsView() {
  const { data, names, graph, inspect, inspected, patchLabel } = useReview();
  const routeFor = useRunRoute();
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const [tool, setTool] = useState("all");
  const [status, setStatus] = useState<"all" | keyof typeof STATUS_GROUPS>("all");

  const hay = useCallback((r: ReviewRun) => `${names.run.get(r.id)} ${r.id} ${r.tool} ${r.status} ${r.error ?? ""}`, [names]);
  const extra = useCallback(
    (r: ReviewRun) => (tool === "all" || r.tool === tool) && (status === "all" || STATUS_GROUPS[status].includes(r.status)),
    [tool, status],
  );
  const f = useLibraryFilter(runs, hay, extra);
  const tools = useMemo(() => [...new Set(runs.map((r) => r.tool))], [runs]);

  if (runs.length === 0) return <EmptyState title="No runs yet" body="Runs from every research tool appear here with their configuration, outcome and outputs." />;

  const columns: Column<ReviewRun>[] = [
    {
      id: "fav",
      header: "",
      className: "w-6 pr-0",
      cell: (r) => <FavoriteToggle on={r.favorite} onToggle={() => void patchLabel({ kind: "run", id: r.id }, { favorite: !r.favorite })} />,
    },
    { id: "name", header: "Run", sort: (r) => names.run.get(r.id), cell: (r) => <div className="max-w-[320px]"><AssetTitle refv={{ kind: "run", id: r.id }} archived={r.archived} /></div> },
    { id: "tool", header: "Type", sort: (r) => r.tool, cell: (r) => <KindTag>{TOOL_LABELS[r.tool] ?? r.tool}</KindTag> },
    { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <StatusPill status={r.status} progress={r.progress} /> },
    {
      id: "result",
      header: "Result",
      cell: (r) => {
        const s = runSummary(r);
        const failed = r.status === "failed" || r.status === "interrupted";
        return s ? (
          <span className={cx("block max-w-[300px] truncate text-[13px]", failed ? "font-mono text-red-200/65" : "font-digits text-white/70")} title={s}>
            {s}
          </span>
        ) : (
          <Missing />
        );
      },
    },
    {
      id: "links",
      header: "Links",
      hideBelow: "2xl",
      align: "right",
      hint: "Recorded or recovered provenance links touching this run.",
      sort: (r) => (graph.in.get(`run:${r.id}`)?.length ?? 0) + (graph.out.get(`run:${r.id}`)?.length ?? 0),
      cell: (r) => {
        const n = (graph.in.get(`run:${r.id}`)?.length ?? 0) + (graph.out.get(`run:${r.id}`)?.length ?? 0);
        return n ? n : <Missing />;
      },
    },
    { id: "started", header: "Started", sort: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-[13px] text-white/55" title={formatDate(r.created_at)}>{formatDate(r.created_at, false)}</span> },
    { id: "duration", header: "Duration", align: "right", sort: (r) => r.duration_s, cell: (r) => formatDuration(r.duration_s) },
    {
      id: "actions",
      header: "",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Link to={routeFor(r)} className={btnSm} title="Open in the originating tool">
            Open <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          {r.download_zip_url && r.status === "succeeded" ? (
            <AuthorizedDownloadLink path={r.download_zip_url} filename={`${r.id}.zip`} className={btnSm} title="Download outputs">
              <Download className="h-3.5 w-3.5" />
            </AuthorizedDownloadLink>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <LibraryToolbar f={f} noun="runs" total={runs.length}>
        <select
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          aria-label="Filter by run type"
          className="h-9 rounded-lg border border-white/[0.1] bg-black px-3 text-[13px] font-medium text-white/85 transition hover:border-white/20 focus:border-white/30 focus:outline-none"
        >
          <option value="all">All types</option>
          {tools.map((t) => (
            <option key={t} value={t}>
              {TOOL_LABELS[t] ?? t} ({runs.filter((r) => r.tool === t).length})
            </option>
          ))}
        </select>
        {(["all", "active", "done", "failed"] as const).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
            {s === "all" ? "Any status" : s === "done" ? "Completed" : s === "active" ? "Active" : "Failed"}
          </Chip>
        ))}
      </LibraryToolbar>
      <DataTable
        ariaLabel="Runs"
        rows={f.filtered}
        rowKey={(r) => r.id}
        columns={columns}
        activeKey={inspected?.kind === "run" ? inspected.id : null}
        onActivate={(r) => inspect({ kind: "run", id: r.id })}
        defaultSort={{ id: "started", dir: "desc" }}
        rowClassName={(r) => (r.archived ? "opacity-60" : undefined)}
        minWidth={1040}
      />
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-white/40">
        <span className="text-white/55">Per-tool history in this browser</span>
        {RUN_FAMILIES.map((fam) => (
          <Link key={fam.slug} to={`/tools/run-log/${fam.slug}`} className="transition hover:text-white">
            {fam.title} →
          </Link>
        ))}
      </div>
    </div>
  );
}
