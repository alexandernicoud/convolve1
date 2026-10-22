import { Boxes, Database, GitBranch, GitCompare, LayoutGrid, LineChart, ListTree, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ReviewProvider, TABS, useReview, type TabId } from "./ReviewContext";
import { clearAssetDetailCache } from "./useAssetDetail";
import { formatRelative } from "./lib/format";
import { btn, cx, PanelTitle, surface } from "./components/primitives";
import { OverviewView } from "./views/OverviewView";
import { ModelsView } from "./views/ModelsView";
import { DatasetsView } from "./views/DatasetsView";
import { BacktestsView } from "./views/BacktestsView";
import { RunsView } from "./views/RunsView";
import { LineageView } from "./views/LineageView";
import { CompareView } from "./views/CompareView";
import { Inspector } from "./inspector/Inspector";

const TAB_META: Record<TabId, { label: string; icon: typeof LayoutGrid }> = {
  overview: { label: "Overview", icon: LayoutGrid },
  models: { label: "Models", icon: Boxes },
  datasets: { label: "Datasets", icon: Database },
  backtests: { label: "Backtests", icon: LineChart },
  runs: { label: "Runs", icon: ListTree },
  lineage: { label: "Lineage", icon: GitBranch },
  compare: { label: "Compare", icon: GitCompare },
};

const FAMILIES = [
  { slug: "backtester", title: "Backtests" },
  { slug: "labeling-optimizer", title: "Labeling optimizers" },
  { slug: "training-chart-generator", title: "Chart generators" },
  { slug: "testdata", title: "Test datasets" },
  { slug: "trainer", title: "Model training" },
  { slug: "analysis", title: "CNN analysis" },
];

function Workspace() {
  const { data, loading, error, reload, tab, setTab, inspected, compare } = useReview();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable]")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) setTab(TABS[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  const count: Partial<Record<TabId, number>> = data
    ? {
        models: data.models.length,
        datasets: data.datasets.length,
        backtests: data.runs.filter((r) => r.tool === "backtester").length,
        runs: data.runs.length,
        lineage: data.edges?.length ?? 0,
        compare: compare.length,
      }
    : {};

  return (
    <div className={cx("pb-6 transition-[padding]", inspected && "xl:pr-[min(560px,90vw)]")}>
      <div className="sticky top-0 z-20 mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-white/[0.1] bg-black">
        <nav className="-mb-px flex flex-wrap" role="tablist" aria-label="Review sections">
          {TABS.map((t, i) => {
            const M = TAB_META[t];
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                title={`${M.label} (${i + 1})`}
                onClick={() => setTab(t)}
                className={cx(
                  "inline-flex items-center gap-2 border-b-2 px-3.5 pb-3 pt-3 text-[14px] font-medium transition first:pl-1 focus:outline-none focus-visible:text-white",
                  active ? "border-white text-white" : "border-transparent text-white/45 hover:text-white/85",
                )}
              >
                <M.icon className={cx("h-4 w-4", active ? "text-white" : "text-white/40")} />
                {M.label}
                {count[t] ? (
                  <span className={cx("font-digits text-[12.5px] tabular-nums", active ? "text-white/60" : "text-white/30")}>{count[t]}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 pb-2">
          {data?.generated_at ? (
            <span className="text-[13px] text-white/40" title={data.sources?.catalog ? "Filesystem + database catalog" : "Filesystem"}>
              Updated {formatRelative(data.generated_at)}
              {data.sources?.catalog ? " · incl. catalog" : ""}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              clearAssetDetailCache();
              void reload();
            }}
            className={btn}
          >
            <RefreshCw className={cx("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {error && data ? (
        <div className="mb-4 rounded-xl border border-red-400/25 px-4 py-3 text-[13.5px] text-red-200/85">{error}</div>
      ) : null}

      {loading && !data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading research workspace">
          <div className={cx(surface, "h-[124px] animate-pulse")} />
          <div className="grid gap-4 xl:grid-cols-12">
            <div className={cx(surface, "h-80 animate-pulse xl:col-span-8")} />
            <div className={cx(surface, "h-80 animate-pulse xl:col-span-4")} />
          </div>
        </div>
      ) : error && !data ? (
        <div className={cx(surface, "px-6 py-8")}>
          <PanelTitle muted>Review is unavailable</PanelTitle>
          <p className="mt-2 pl-4 text-[14px] text-red-300/85">{error}</p>
          <p className="mt-2 max-w-2xl pl-4 text-[14px] leading-relaxed text-white/50">
            The backend may be offline. Per-tool run history stored in this browser is still available:
          </p>
          <div className="mt-5 flex flex-wrap gap-2 pl-4">
            {FAMILIES.map((f) => (
              <Link key={f.slug} to={`/tools/run-log/${f.slug}`} className={btn}>
                {f.title}
              </Link>
            ))}
          </div>
        </div>
      ) : data ? (
        <div role="tabpanel">
          {tab === "overview" && <OverviewView />}
          {tab === "models" && <ModelsView />}
          {tab === "datasets" && <DatasetsView />}
          {tab === "backtests" && <BacktestsView />}
          {tab === "runs" && <RunsView />}
          {tab === "lineage" && <LineageView />}
          {tab === "compare" && <CompareView />}
        </div>
      ) : null}

      {data ? <Inspector /> : null}
    </div>
  );
}

export function ReviewWorkspace() {
  return (
    <ReviewProvider>
      <Workspace />
    </ReviewProvider>
  );
}
