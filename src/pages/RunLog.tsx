import { useEffect, useMemo, useState } from "react";
import { Link, useParams, Navigate, useSearchParams } from "react-router-dom";
import {
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Trash2,
  ArrowLeft,
  LayoutGrid,
  RefreshCw,
  Boxes,
  Database,
  ListTree,
  GitBranch,
  Bot as BotIcon,
  Download,
  AlertTriangle,
  Star,
  Archive,
  ArchiveRestore,
  Pencil,
  Check,
  X,
  Plus,
  Search,
  Tag as TagIcon,
} from "lucide-react";
import type {
  GlobalRun,
  ReviewOverviewResponse,
  ReviewModel,
  ReviewDataset,
  ReviewRun,
  ReviewLineage,
  LibraryLabelPatch,
} from "@/lib/api";
import { apiUrl, reviewApi, internalModelsApi, datasetsApi } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";

// ---------------- Library organization (labels/tags/favorite/archive) ----------------

/** Fields every labelable asset shares, so filter + editor components can be generic. */
interface Labelable {
  id: string;
  name?: string | null;
  auto_name?: string | null;
  display_name?: string | null;
  symbols?: string | null;
  tags?: string[];
  favorite?: boolean;
  archived?: boolean;
  notes?: string | null;
}

/** Merge a server label overlay back into a listing item (keeps machine name recoverable). */
function mergeOverlay<T extends Labelable>(item: T, overlay: Partial<Labelable>): T {
  const base = item.auto_name ?? item.name ?? item.id;
  const displayName = overlay.display_name ?? null;
  return {
    ...item,
    tags: overlay.tags ?? [],
    favorite: !!overlay.favorite,
    archived: !!overlay.archived,
    notes: overlay.notes ?? null,
    display_name: displayName,
    auto_name: base,
    name: displayName || base,
  };
}

interface LibraryFilterState<T> {
  q: string;
  setQ: (v: string) => void;
  activeTags: string[];
  toggleTag: (t: string) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  favOnly: boolean;
  setFavOnly: (v: boolean) => void;
  allTags: string[];
  filtered: T[];
  archivedCount: number;
}

function useLibraryFilter<T extends Labelable>(items: T[]): LibraryFilterState<T> {
  const [q, setQ] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [favOnly, setFavOnly] = useState(false);

  const allTags = useMemo(
    () => Array.from(new Set(items.flatMap((i) => i.tags ?? []))).sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const archivedCount = useMemo(() => items.filter((i) => i.archived).length, [items]);

  const toggleTag = (t: string) =>
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (!showArchived && i.archived) return false;
      if (favOnly && !i.favorite) return false;
      if (activeTags.length) {
        const lower = (i.tags ?? []).map((x) => x.toLowerCase());
        if (!activeTags.every((t) => lower.includes(t.toLowerCase()))) return false;
      }
      if (needle) {
        const hay = `${i.name ?? ""} ${i.id ?? ""} ${i.symbols ?? ""} ${(i.tags ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, activeTags, showArchived, favOnly]);

  return { q, setQ, activeTags, toggleTag, showArchived, setShowArchived, favOnly, setFavOnly, allTags, filtered, archivedCount };
}

function LibraryToolbar<T extends Labelable>({
  state,
  noun,
  total,
}: {
  state: LibraryFilterState<T>;
  noun: string;
  total: number;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
          <input
            value={state.q}
            onChange={(e) => state.setQ(e.target.value)}
            placeholder={`Search ${noun} by name, tag, symbol…`}
            className="w-full rounded-lg border border-white/12 bg-[#0a0a0a]/70 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => state.setFavOnly(!state.favOnly)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
            state.favOnly ? "border-amber-300/50 bg-amber-300/10 text-amber-100" : "border-white/15 text-white/60 hover:text-white"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${state.favOnly ? "fill-amber-300 text-amber-300" : ""}`} />
          Favorites
        </button>
        <button
          type="button"
          onClick={() => state.setShowArchived(!state.showArchived)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
            state.showArchived ? "border-white/40 bg-white/10 text-white" : "border-white/15 text-white/60 hover:text-white"
          }`}
        >
          <Archive className="h-3.5 w-3.5" />
          {state.showArchived ? "Showing archived" : `Archived (${state.archivedCount})`}
        </button>
        <span className="text-xs text-white/40">
          {state.filtered.length} / {total}
        </span>
      </div>
      {state.allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <TagIcon className="h-3.5 w-3.5 text-white/35" />
          {state.allTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => state.toggleTag(t)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                state.activeTags.includes(t)
                  ? "border-white/45 bg-white/15 text-white"
                  : "border-white/12 text-white/55 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Editable name + favorite/archive + tag chips for one asset (used in Models & Datasets tabs). */
function LabelCell({
  item,
  secondaryId,
  onPatch,
  children,
}: {
  item: Labelable;
  secondaryId?: string | null;
  onPatch: (patch: LibraryLabelPatch) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name || item.id);
  const [tagDraft, setTagDraft] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  const commitName = () => {
    const v = draft.trim();
    const base = item.auto_name ?? item.id;
    // Empty or same-as-auto clears the custom name.
    onPatch({ display_name: v && v !== base ? v : null });
    setEditing(false);
  };

  const addTag = () => {
    const v = tagDraft.trim();
    if (!v) {
      setAddingTag(false);
      return;
    }
    const next = Array.from(new Set([...(item.tags ?? []), v]));
    onPatch({ tags: next });
    setTagDraft("");
    setAddingTag(false);
  };

  const removeTag = (t: string) => onPatch({ tags: (item.tags ?? []).filter((x) => x !== t) });

  return (
    <div className="min-w-[200px] space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPatch({ favorite: !item.favorite })}
          title={item.favorite ? "Unfavorite" : "Favorite"}
          className="shrink-0 text-white/40 hover:text-amber-300"
        >
          <Star className={`h-3.5 w-3.5 ${item.favorite ? "fill-amber-300 text-amber-300" : ""}`} />
        </button>
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-40 rounded border border-white/25 bg-[#0a0a0a] px-1.5 py-0.5 text-sm text-white focus:outline-none"
            />
            <button type="button" onClick={commitName} className="text-emerald-300 hover:text-emerald-200">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-white/50 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="group flex items-center gap-1.5">
            <span className={`max-w-[200px] truncate font-medium ${item.archived ? "text-white/45" : "text-white/90"}`}>
              {item.name || item.id}
            </span>
            <button
              type="button"
              onClick={() => {
                setDraft(item.display_name || item.auto_name || item.name || item.id);
                setEditing(true);
              }}
              className="text-white/30 opacity-0 transition group-hover:opacity-100 hover:text-white/80"
              title="Rename"
            >
              <Pencil className="h-3 w-3" />
            </button>
            {item.archived ? (
              <span className="rounded border border-white/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-white/40">
                archived
              </span>
            ) : null}
          </div>
        )}
        <button
          type="button"
          onClick={() => onPatch({ archived: !item.archived })}
          title={item.archived ? "Unarchive" : "Archive"}
          className="ml-auto shrink-0 text-white/30 hover:text-white/80"
        >
          {item.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        </button>
      </div>

      {secondaryId ? <div className="font-mono text-[11px] text-white/40">{secondaryId}</div> : null}
      {children}

      <div className="flex flex-wrap items-center gap-1">
        {(item.tags ?? []).map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/70">
            {t}
            <button type="button" onClick={() => removeTag(t)} className="text-white/40 hover:text-white">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {addingTag ? (
          <input
            autoFocus
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTag();
              if (e.key === "Escape") setAddingTag(false);
            }}
            onBlur={addTag}
            placeholder="tag"
            className="w-16 rounded border border-white/20 bg-[#0a0a0a] px-1 py-0.5 text-[10px] text-white focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingTag(true)}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-white/15 px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80"
          >
            <Plus className="h-2.5 w-2.5" /> tag
          </button>
        )}
      </div>
    </div>
  );
}

interface RunFamily {
  slug: string;
  title: string;
  routePrefix: string;
}

const RUN_FAMILIES: RunFamily[] = [
  { slug: "backtester", title: "Backtests", routePrefix: "/tools/backtester/runs/" },
  { slug: "labeling-optimizer", title: "Labeling optimizers", routePrefix: "/products/labeling-optimizer/results/" },
  { slug: "training-chart-generator", title: "Chart generators", routePrefix: "/tools/generator/runs/" },
  { slug: "testdata", title: "Test datasets", routePrefix: "/tools/backtester?runId=" },
  { slug: "trainer", title: "Model training", routePrefix: "/tools/trainer?runId=" },
  { slug: "analysis", title: "CNN analysis", routePrefix: "/tools/trainer/runs/" },
];

const TOOL_LABELS: Record<string, string> = {
  backtester: "Backtest",
  "labeling-optimizer": "Labeling optimizer",
  "training-chart-generator": "Chart generator",
  testdata: "Test dataset",
  trainer: "Training",
  analysis: "Analysis",
};

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "models", label: "Models", icon: Boxes },
  { id: "datasets", label: "Datasets", icon: Database },
  { id: "runs", label: "Runs", icon: ListTree },
  { id: "lineage", label: "Lineage", icon: GitBranch },
] as const;

type TabId = (typeof TABS)[number]["id"];

const formatDate = (ts?: number | null) => {
  if (!ts) return "—";
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
};

const shortId = (id?: string | null) => (id ? (id.length > 12 ? `…${id.slice(-8)}` : id) : "—");

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Play className="h-4 w-4 animate-pulse text-white/60" />;
      case "succeeded":
        return <CheckCircle className="h-4 w-4 text-[#e5e5e5]" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-400" />;
      case "cancelled":
        return <XCircle className="h-4 w-4 text-yellow-400" />;
      case "queued":
        return <Clock className="h-4 w-4 text-yellow-400" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return "Running";
      case "succeeded":
        return "Completed";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      case "queued":
        return "Queued";
      default:
        return "Unknown";
    }
  };

function StatusPill({ status }: { status?: string | null }) {
  if (!status) return <span className="text-white/35">—</span>;
  const color =
    status === "succeeded"
      ? "border-white/20 bg-white/10 text-white/85"
      : status === "failed"
        ? "border-red-400/30 bg-red-400/10 text-red-300"
        : status === "running"
          ? "border-white/15 bg-white/[0.06] text-white/70"
          : "border-yellow-400/30 bg-yellow-400/10 text-yellow-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${color}`}>
      {getStatusText(status)}
    </span>
  );
}

function NotLinked({ text = "not linked" }: { text?: string }) {
  return <span className="text-xs italic text-white/30">{text}</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-white/45">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top text-[13px] text-white/80 ${className}`}>{children}</td>;
}

function SummaryCard({ label, value, accent }: { label: string; value: number | string; accent?: "red" | "none" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] uppercase tracking-wider text-white/45">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent === "red" ? "text-red-300" : "text-white"}`}>{value}</p>
    </div>
  );
}

// ---------------- Overview tab ----------------

function OverviewTab({ data }: { data: ReviewOverviewResponse }) {
  const { summary, runs, bots } = data;
  const active = runs.filter((r) => r.status === "running" || r.status === "queued");
  const failed = runs.filter((r) => r.status === "failed").slice(0, 5);
  const recent = runs.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Runs" value={summary.totalRuns} />
        <SummaryCard label="Running" value={summary.runningRuns} />
        <SummaryCard label="Completed" value={summary.completedRuns} />
        <SummaryCard label="Failed" value={summary.failedRuns} accent={summary.failedRuns > 0 ? "red" : "none"} />
        <SummaryCard label="Models" value={summary.totalModels} />
        <SummaryCard label="Datasets" value={summary.totalDatasets} />
        <SummaryCard label="Training runs" value={summary.totalTrainingRuns} />
        <SummaryCard label="Backtests" value={summary.totalBacktests} />
        <SummaryCard label="Analyses" value={summary.totalAnalyses} />
        <SummaryCard label="Deployed bots" value={summary.totalBots} />
      </div>

      {active.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Active runs</h3>
          <div className="space-y-2">
            {active.map((r) => (
              <RunRowCompact key={r.id} run={r} />
            ))}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/[0.04] p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-200">
            <AlertTriangle className="h-4 w-4" /> Recently failed
          </h3>
          <div className="space-y-2">
            {failed.map((r) => (
              <RunRowCompact key={r.id} run={r} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">Recent activity</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-white/40">No runs yet.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((r) => (
              <RunRowCompact key={r.id} run={r} />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <BotIcon className="h-4 w-4" /> Deployed bots
        </h3>
        {bots.length === 0 ? (
          <p className="text-sm text-white/40">No bots deployed yet.</p>
        ) : (
          <div className="space-y-2">
            {bots.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-white/85">
                  <span>{b.name || b.id.slice(0, 8)}</span>
                  <span className="text-white/40">·</span>
                  <span className="text-white/55">{b.symbol}</span>
                  {b.model_filename ? <span className="text-xs text-white/40">({b.model_filename})</span> : null}
                </div>
                <span className="text-xs text-white/55">{b.lifecycle_state || (b.is_active ? "active" : "inactive")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunRowCompact({ run }: { run: ReviewRun }) {
  const getRunRoute = useRunsStore((s) => s.getRunRoute);
  // Always use getRunRoute — backend `run.route` historically used plural /runs/ (404).
  const href = getRunRoute(run as GlobalRun);
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {getStatusIcon(run.status)}
        <span className="text-sm text-white/85">{TOOL_LABELS[run.tool] || run.tool}</span>
        <span className="font-mono text-xs text-white/40">{shortId(run.id)}</span>
        {run.status === "running" && (
          <span className="text-xs text-white/55">{Math.round(run.progress * 100)}% · {run.message || run.stage}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-xs text-white/40 sm:inline">{formatDate(run.updated_at)}</span>
        {href ? (
          <Link to={href} className="text-xs text-white/70 underline-offset-2 hover:underline">
            Open
          </Link>
        ) : null}
      </div>
    </div>
  );
}

// ---------------- Models tab ----------------

function ModelsTab({
  models,
  onPatch,
}: {
  models: ReviewModel[];
  onPatch: (id: string, patch: LibraryLabelPatch) => void;
}) {
  const filter = useLibraryFilter(models as Labelable[]);
  if (models.length === 0) {
    return <p className="py-8 text-center text-sm text-white/45">No models found. Train or upload a model to see it here.</p>;
  }
  const visible = filter.filtered as unknown as ReviewModel[];
  return (
    <div>
      <LibraryToolbar state={filter} noun="models" total={models.length} />
      <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[960px] border-collapse">
        <thead className="border-b border-white/10 bg-white/[0.03]">
          <tr>
            <Th>Model</Th>
            <Th>Source</Th>
            <Th>Created</Th>
            <Th>Training run</Th>
            <Th>Dataset</Th>
            <Th>Symbols</Th>
            <Th>Timeframe</Th>
            <Th>TP / SL / Horizon</Th>
            <Th>Metrics</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {visible.map((m) => (
            <tr key={`${m.source}:${m.id}`} className={`hover:bg-white/[0.02] ${m.archived ? "opacity-55" : ""}`}>
              <Td>
                <LabelCell item={m as Labelable} secondaryId={m.id} onPatch={(patch) => onPatch(m.id, patch)}>
                  {!m.metadata_available && (
                    <div className="mt-0.5 text-[11px] italic text-white/35">training metadata unavailable</div>
                  )}
                </LabelCell>
              </Td>
              <Td>
                <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-white/70">
                  {m.source}
                </span>
              </Td>
              <Td>{formatDate(m.created_at)}</Td>
              <Td>
                {m.training_run_id ? (
                  <Link to={`/tools/trainer?runId=${m.training_run_id}`} className="font-mono text-xs text-white/75 underline-offset-2 hover:underline">
                    {shortId(m.training_run_id)}
                  </Link>
                ) : (
                  <NotLinked />
                )}
              </Td>
              <Td>
                {m.generator_run_id ? (
                  <Link to={`/tools/generator/runs/${m.generator_run_id}`} className="font-mono text-xs text-white/75 underline-offset-2 hover:underline">
                    gen {shortId(m.generator_run_id)}
                  </Link>
                ) : m.dataset_id ? (
                  <span className="font-mono text-xs text-white/70">{shortId(m.dataset_id)}</span>
                ) : (
                  <NotLinked />
                )}
              </Td>
              <Td className="max-w-[160px] truncate">{m.symbols || <NotLinked text="unknown" />}</Td>
              <Td>{m.timeframe || <NotLinked text="unknown" />}</Td>
              <Td>
                {m.take_profit_fraction != null || m.stop_loss_fraction != null || m.horizon_bars != null ? (
                  <span className="text-xs">
                    {m.take_profit_fraction != null ? `${(m.take_profit_fraction * 100).toFixed(1)}%` : "—"} /{" "}
                    {m.stop_loss_fraction != null ? `${(m.stop_loss_fraction * 100).toFixed(1)}%` : "—"} /{" "}
                    {m.horizon_bars != null ? `${m.horizon_bars} bars` : "—"}
                  </span>
                ) : (
                  <NotLinked text="unknown" />
                )}
              </Td>
              <Td>
                {m.metrics && Object.keys(m.metrics).length > 0 ? (
                  <span className="text-xs">
                    {m.metrics.val_accuracy != null ? `val acc ${(m.metrics.val_accuracy * 100).toFixed(1)}%` : null}
                    {m.metrics.val_accuracy != null && m.metrics.epochs_trained != null ? " · " : null}
                    {m.metrics.epochs_trained != null ? `${m.metrics.epochs_trained} epochs` : null}
                  </span>
                ) : (
                  <NotLinked text="unknown" />
                )}
              </Td>
              <Td>
                <div className="flex flex-wrap items-center gap-2">
                  {m.training_run_id ? (
                    <Link to={`/tools/trainer?runId=${m.training_run_id}`} className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10">
                      Details
                    </Link>
                  ) : null}
                  <Link
                    to={
                      m.source === "trained" && m.training_run_id
                        ? `/tools/backtester?modelRunId=${m.training_run_id}`
                        : m.model_id
                          ? `/tools/backtester?modelId=${encodeURIComponent(m.model_id)}`
                          : "/tools/backtester"
                    }
                    className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10"
                  >
                    Backtest
                  </Link>
                  {(m.metadata_available || m.source === "uploaded") && (
                    <Link
                      to={
                        m.source === "trained" && m.training_run_id
                          ? `/tools/backtester?modelRunId=${m.training_run_id}`
                          : m.model_id
                            ? `/tools/backtester?modelId=${encodeURIComponent(m.model_id)}`
                            : "/tools/backtester"
                      }
                      className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10"
                    >
                      Fitting test set
                    </Link>
                  )}
                  {m.download_url ? (
                    <a href={apiUrl(m.download_url)} target="_blank" rel="noreferrer" className="rounded border border-white/15 p-1 text-white/75 hover:bg-white/10" title="Download model">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ---------------- Datasets tab ----------------

function DatasetsTab({
  datasets,
  onPatch,
}: {
  datasets: ReviewDataset[];
  onPatch: (id: string, patch: LibraryLabelPatch) => void;
}) {
  const filter = useLibraryFilter(datasets as Labelable[]);
  if (datasets.length === 0) {
    return <p className="py-8 text-center text-sm text-white/45">No datasets found. Generate or upload one to see it here.</p>;
  }
  const visible = filter.filtered as unknown as ReviewDataset[];
  return (
    <div>
      <LibraryToolbar state={filter} noun="datasets" total={datasets.length} />
      <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[960px] border-collapse">
        <thead className="border-b border-white/10 bg-white/[0.03]">
          <tr>
            <Th>Dataset</Th>
            <Th>Type</Th>
            <Th>Source</Th>
            <Th>Symbols</Th>
            <Th>Period</Th>
            <Th>Timeframe</Th>
            <Th>TP / SL / Horizon</Th>
            <Th>Images</Th>
            <Th>Linked to</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {visible.map((d) => (
            <tr key={d.id} className={`hover:bg-white/[0.02] ${d.archived ? "opacity-55" : ""}`}>
              <Td>
                <LabelCell
                  item={{ ...(d as Labelable), id: d.dataset_id || d.id }}
                  secondaryId={d.dataset_id || d.id}
                  onPatch={(patch) => onPatch(d.dataset_id || d.id, patch)}
                />
              </Td>
              <Td>
                <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-white/70">
                  {d.kind}
                </span>
              </Td>
              <Td>{d.source}</Td>
              <Td className="max-w-[140px] truncate">{d.symbols || <NotLinked text="unknown" />}</Td>
              <Td>
                {d.period_start || d.period_end ? (
                  <span className="text-xs">
                    {d.period_start || "?"} → {d.period_end || "?"}
                  </span>
                ) : (
                  <NotLinked text="unknown" />
                )}
              </Td>
              <Td>
                {d.timeframe ? (
                  <span className="text-xs">
                    {d.timeframe}
                    {d.timespan_count != null && d.timespan_unit ? ` · ${d.timespan_count} ${d.timespan_unit}` : ""}
                  </span>
                ) : (
                  <NotLinked text="unknown" />
                )}
              </Td>
              <Td>
                {d.take_profit_fraction != null || d.stop_loss_fraction != null || d.horizon_bars != null ? (
                  <span className="text-xs">
                    {d.take_profit_fraction != null ? `${(d.take_profit_fraction * 100).toFixed(1)}%` : "—"} /{" "}
                    {d.stop_loss_fraction != null ? `${(d.stop_loss_fraction * 100).toFixed(1)}%` : "—"} /{" "}
                    {d.horizon_bars != null ? `${d.horizon_bars}` : "—"}
                  </span>
                ) : (
                  <NotLinked text="unknown" />
                )}
              </Td>
              <Td>{d.total_images != null ? d.total_images : <NotLinked text="unknown" />}</Td>
              <Td>
                <div className="space-y-0.5 text-xs">
                  {d.generator_run_id ? (
                    <div>
                      <Link to={`/tools/generator/runs/${d.generator_run_id}`} className="text-white/70 underline-offset-2 hover:underline">
                        generator {shortId(d.generator_run_id)}
                      </Link>
                    </div>
                  ) : null}
                  {d.testdata_run_id ? (
                    <div>
                      <Link to={`/tools/backtester?runId=${d.testdata_run_id}`} className="text-white/70 underline-offset-2 hover:underline">
                        test run {shortId(d.testdata_run_id)}
                      </Link>
                    </div>
                  ) : null}
                  {d.training_run_id ? <div className="text-white/55">for training {shortId(d.training_run_id)}</div> : null}
                  {d.model_id ? <div className="text-white/55">for model {shortId(d.model_id)}</div> : null}
                  {(d.used_by_training_runs ?? []).map((rid) => (
                    <div key={rid}>
                      <Link to={`/tools/trainer?runId=${rid}`} className="text-white/70 underline-offset-2 hover:underline">
                        trained {shortId(rid)}
                      </Link>
                    </div>
                  ))}
                  {!d.generator_run_id && !d.testdata_run_id && !d.training_run_id && !d.model_id && (d.used_by_training_runs ?? []).length === 0 ? (
                    <NotLinked />
                  ) : null}
                </div>
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  {d.download_url ? (
                    <a href={apiUrl(d.download_url)} target="_blank" rel="noreferrer" className="rounded border border-white/15 p-1 text-white/75 hover:bg-white/10" title="Download ZIP">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="text-[11px] text-white/30">—</span>
                  )}
                  {d.kind === "training" && d.generator_run_id ? (
                    <Link to="/tools/trainer" className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10">
                      Train
                    </Link>
                  ) : null}
                  {(d.kind === "test" || d.kind === "unknown") && (d.dataset_id || d.id) ? (
                    <Link
                      to={`/tools/backtester?datasetId=${encodeURIComponent(d.dataset_id || d.id)}`}
                      className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10"
                    >
                      Backtest
                    </Link>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ---------------- Runs tab ----------------

function RunsTab({ runs }: { runs: ReviewRun[] }) {
  const getRunRoute = useRunsStore((s) => s.getRunRoute);
  const [toolFilter, setToolFilter] = useState<string>("all");
  const filtered = toolFilter === "all" ? runs : runs.filter((r) => r.tool === toolFilter);
  const tools = Array.from(new Set(runs.map((r) => r.tool)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setToolFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs transition ${toolFilter === "all" ? "border-white/40 bg-white/10 text-white" : "border-white/15 text-white/60 hover:text-white"}`}
        >
          All ({runs.length})
        </button>
        {tools.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setToolFilter(t)}
            className={`rounded-full border px-3 py-1 text-xs transition ${toolFilter === t ? "border-white/40 bg-white/10 text-white" : "border-white/15 text-white/60 hover:text-white"}`}
          >
            {TOOL_LABELS[t] || t} ({runs.filter((r) => r.tool === t).length})
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          {RUN_FAMILIES.map((f) => (
            <Link key={f.slug} to={`/tools/run-log/${f.slug}`} className="text-[11px] text-white/45 underline-offset-2 hover:text-white/75 hover:underline">
              {f.title} →
            </Link>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/45">No runs in this category.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="border-b border-white/10 bg-white/[0.03]">
              <tr>
                <Th>Run</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
                <Th>Input / result</Th>
                <Th>Linked assets</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filtered.map((r) => {
                const detailEntries = Object.entries(r.details || {}).slice(0, 4);
                const links = r.links || {};
                return (
                  <tr key={r.id} className="hover:bg-white/[0.02]">
                    <Td>
                      <span className="font-mono text-xs text-white/70">{shortId(r.id)}</span>
                    </Td>
                    <Td>{TOOL_LABELS[r.tool] || r.tool}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusPill status={r.status} />
                        {r.status === "running" ? (
                          <span className="text-xs text-white/55">{Math.round(r.progress * 100)}%</span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <span className="text-xs">{formatDate(r.updated_at)}</span>
                    </Td>
                    <Td>
                      {detailEntries.length > 0 ? (
                        <div className="max-w-[260px] space-y-0.5 text-xs text-white/60">
                          {detailEntries.map(([k, v]) => (
                            <div key={k} className="truncate">
                              <span className="text-white/40">{k}:</span> {String(v)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <NotLinked text="metadata unavailable" />
                      )}
                    </Td>
                    <Td>
                      <div className="space-y-0.5 text-xs">
                        {links.model_id ? <div className="text-white/60">model {shortId(links.model_id)}</div> : null}
                        {links.trainer_run_id ? (
                          <div>
                            <Link to={`/tools/trainer?runId=${links.trainer_run_id}`} className="text-white/70 underline-offset-2 hover:underline">
                              training {shortId(links.trainer_run_id)}
                            </Link>
                          </div>
                        ) : null}
                        {links.generator_run_id ? (
                          <div>
                            <Link to={`/tools/generator/runs/${links.generator_run_id}`} className="text-white/70 underline-offset-2 hover:underline">
                              generator {shortId(links.generator_run_id)}
                            </Link>
                          </div>
                        ) : null}
                        {links.dataset_id ? <div className="text-white/60">dataset {shortId(links.dataset_id)}</div> : null}
                        {!links.model_id && !links.trainer_run_id && !links.generator_run_id && !links.dataset_id ? (
                          <NotLinked />
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Link
                          to={getRunRoute(r as GlobalRun)}
                          className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10"
                        >
                          <Eye className="h-3 w-3" /> View
                        </Link>
                        {r.download_zip_url && r.status === "succeeded" ? (
                          <a href={apiUrl(r.download_zip_url)} target="_blank" rel="noreferrer" className="rounded border border-white/15 p-1 text-white/75 hover:bg-white/10" title="Download">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Lineage tab ----------------

function LineageTab({ lineages }: { lineages: ReviewLineage[] }) {
  if (lineages.length === 0) {
    return <p className="py-8 text-center text-sm text-white/45">No assets to connect yet. Generate a training dataset to start a chain.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/45">
        Best-effort chains from recorded metadata only. Missing steps are shown as “not linked” — relationships are never guessed.
      </p>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[1080px] border-collapse">
          <thead className="border-b border-white/10 bg-white/[0.03]">
            <tr>
              <Th>Training dataset</Th>
              <Th>Training run</Th>
              <Th>Model</Th>
              <Th>Test dataset</Th>
              <Th>Analysis</Th>
              <Th>Backtest</Th>
              <Th>Deployed bot</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {lineages.map((l) => (
              <tr key={l.key} className="hover:bg-white/[0.02]">
                <Td>
                  {l.training_dataset ? (
                    l.training_dataset.generator_run_id ? (
                      <Link
                        to={`/tools/generator/runs/${l.training_dataset.generator_run_id}`}
                        className="text-xs text-white/75 underline-offset-2 hover:underline"
                      >
                        {l.training_dataset.label || shortId(l.training_dataset.generator_run_id)}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-white/70">{l.training_dataset.label}</span>
                    )
                  ) : (
                    <NotLinked />
                  )}
                </Td>
                <Td>
                  {l.training_run ? (
                    <div className="flex items-center gap-2">
                      <Link to={`/tools/trainer?runId=${l.training_run.id}`} className="font-mono text-xs text-white/75 underline-offset-2 hover:underline">
                        {shortId(l.training_run.id)}
                      </Link>
                      <StatusPill status={l.training_run.status} />
                    </div>
                  ) : (
                    <NotLinked />
                  )}
                </Td>
                <Td>
                  {l.model ? (
                    <div>
                      <div className="max-w-[180px] truncate text-xs font-medium text-white/90">{l.model.name || l.model.id}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-white/45">{l.model.source}</span>
                        {!l.model.metadata_available ? (
                          <span className="text-[10px] italic text-white/35">metadata unavailable</span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <NotLinked />
                  )}
                </Td>
                <Td>
                  {l.test_datasets.length > 0 ? (
                    <div className="space-y-1">
                      {l.test_datasets.map((t) => (
                        <div key={t.run_id} className="flex items-center gap-2">
                          <Link to={`/tools/backtester?runId=${t.run_id}`} className="max-w-[140px] truncate text-xs text-white/75 underline-offset-2 hover:underline">
                            {t.name || shortId(t.dataset_id) || shortId(t.run_id)}
                          </Link>
                          <StatusPill status={t.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <NotLinked />
                  )}
                </Td>
                <Td>
                  {l.analyses.length > 0 ? (
                    <div className="space-y-1">
                      {l.analyses.map((a) => (
                        <div key={a.run_id} className="flex items-center gap-2">
                          {a.trainer_run_id && a.analysis_id ? (
                            <Link
                              to={`/products/trainer/analysis/${a.trainer_run_id}/${a.analysis_id}`}
                              className="font-mono text-xs text-white/75 underline-offset-2 hover:underline"
                            >
                              {shortId(a.analysis_id)}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-white/70">{shortId(a.run_id)}</span>
                          )}
                          <StatusPill status={a.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <NotLinked />
                  )}
                </Td>
                <Td>
                  {l.backtests.length > 0 ? (
                    <div className="space-y-1">
                      {l.backtests.map((b) => (
                        <div key={b.run_id} className="flex items-center gap-2">
                          <Link to={`/tools/backtester/runs/${b.run_id}`} className="font-mono text-xs text-white/75 underline-offset-2 hover:underline">
                            {shortId(b.run_id)}
                          </Link>
                          <StatusPill status={b.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <NotLinked />
                  )}
                </Td>
                <Td>
                  <span className="text-xs text-white/35">Coming soon</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Review overview page (index) ----------------

function ReviewOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TabId | null;
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "overview";

  const [data, setData] = useState<ReviewOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await reviewApi.getOverview();
      setData(overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load overview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Also refresh the local runs store so family pages stay in sync
    void useRunsStore.getState().mergeRunsFromBackendList(200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = (tab: TabId) => {
    const next = new URLSearchParams(searchParams);
    if (tab === "overview") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const patchModel = async (id: string, patch: LibraryLabelPatch) => {
    try {
      const overlay = await internalModelsApi.updateLabel(id, patch);
      setData((prev) =>
        prev ? { ...prev, models: prev.models.map((m) => (m.id === id ? mergeOverlay(m as Labelable, overlay) as unknown as ReviewModel : m)) } : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update model label");
    }
  };

  const patchDataset = async (id: string, patch: LibraryLabelPatch) => {
    try {
      const overlay = await datasetsApi.updateLabel(id, patch);
      setData((prev) =>
        prev
          ? {
              ...prev,
              datasets: prev.datasets.map((d) =>
                (d.dataset_id || d.id) === id ? (mergeOverlay(d as Labelable, overlay) as unknown as ReviewDataset) : d,
              ),
            }
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update dataset label");
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div>
          <p className="marketing-section-label">Review</p>
          <h1 className="mt-2 text-[clamp(1.1rem,2vw,1.35rem)] font-extralight tracking-[-0.02em] text-white">
            Project assets &amp; lineage
          </h1>
          <p className="mt-1 text-[13px] text-white/50">
            Models, datasets, runs and how they connect — built from recorded metadata.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white/90"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition ${
                isActive ? "bg-white/10 text-white" : "text-white/55 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <p className="py-12 text-center text-sm text-white/45">Loading overview…</p>
      ) : error && !data ? (
        <div className="py-12 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <p className="mt-2 text-xs text-white/45">The backend may be offline. Run history is still available per category below.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {RUN_FAMILIES.map((f) => (
              <Link key={f.slug} to={`/tools/run-log/${f.slug}`} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
                {f.title}
              </Link>
            ))}
          </div>
        </div>
      ) : data ? (
        <>
          {activeTab === "overview" && <OverviewTab data={data} />}
          {activeTab === "models" && <ModelsTab models={data.models} onPatch={patchModel} />}
          {activeTab === "datasets" && <DatasetsTab datasets={data.datasets} onPatch={patchDataset} />}
          {activeTab === "runs" && <RunsTab runs={data.runs} />}
          {activeTab === "lineage" && <LineageTab lineages={data.lineages} />}
        </>
      ) : null}
    </div>
  );
}

// ---------------- Per-family run list (existing behavior, unchanged) ----------------

export default function RunLog() {
  const { toolFamily } = useParams<{ toolFamily?: string }>();
  const runsById = useRunsStore((s) => s.runsById);
  const getRunRoute = useRunsStore((s) => s.getRunRoute);

  const runsByFamily = useMemo(() => {
    const map: Record<string, GlobalRun[]> = {};
    for (const f of RUN_FAMILIES) {
      map[f.slug] = [];
    }
    const sorted = Object.values(runsById).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    for (const run of sorted) {
      if (map[run.tool]) {
        map[run.tool].push(run);
      }
    }
    return map;
  }, [runsById]);

  const activeFamily = toolFamily ? RUN_FAMILIES.find((f) => f.slug === toolFamily) : null;

  if (toolFamily && !activeFamily) {
    return <Navigate to="/tools/run-log" replace />;
  }

  const handleRefresh = async () => {
    await useRunsStore.getState().mergeRunsFromBackendList(200);
    await useRunsStore.getState().reconcileRunsWithBackend({ concurrency: 4 });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0a0a0a]">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute left-10 top-20 h-96 w-96 rounded-full bg-[rgba(255,255,255,0.06)] blur-3xl" />
        <div className="absolute right-20 top-40 h-80 w-80 rounded-full bg-[rgba(255,255,255,0.15)] blur-3xl" />
        <div className="absolute bottom-20 left-1/3 h-72 w-72 rounded-full bg-[rgba(236,72,153,0.12)] blur-3xl" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
        <div className="mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden">
          {!activeFamily ? (
            <ReviewOverviewPage />
          ) : (
            <>
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
                <Link
                  to="/tools/run-log"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-[#F5F5F5] transition hover:border-white/30 hover:bg-white/[0.06]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to overview
                </Link>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-medium text-[#0a0a0a] transition-all duration-200 hover:bg-white/90 "
              >
                    <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => useRunsStore.getState().clearStaleRuns()}
                className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-[#F5F5F5]/80 transition hover:border-white/30 hover:text-white"
              >
                Clear stale runs
              </button>
              <button
                type="button"
                onClick={() => useRunsStore.getState().clearAllRuns()}
                className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-[#F5F5F5]/80 transition hover:border-[#f87171]/50 hover:text-white"
              >
                Clear all runs
              </button>
            </div>
          </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="mb-6 border-b border-white/[0.08] pb-4">
                <p className="marketing-section-label">Run log</p>
                <h1 className="mt-3 text-[clamp(1.1rem,2vw,1.35rem)] font-extralight tracking-[-0.02em] text-white">
                  {activeFamily.title}
                </h1>
                <p className="mt-2 text-[13px] text-white/50">Runs for this tool, newest first.</p>
              </div>
              {(runsByFamily[activeFamily.slug] ?? []).length === 0 ? (
                <p className="mt-6 text-sm text-[rgba(255,255,255,0.45)]">No runs in this category yet.</p>
              ) : (
                <div className="space-y-3">
                  {(runsByFamily[activeFamily.slug] ?? []).map((run) => (
                    <div
                      key={run.id}
                      className="tech-surface-muted flex items-center justify-between p-4 transition-all duration-200 hover:border-white/[0.12]"
                    >
                      <div className="flex items-center gap-3">
                        {getStatusIcon(run.status)}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-[#F5F5F5]">{getStatusText(run.status)}</span>
                            <span className="text-sm text-[#F5F5F5]/50">•</span>
                            <span className="text-sm text-[#F5F5F5]/50">ID: {run.id.slice(-8)}</span>
                            {run.tool === "analysis" && (run.parent_run_id == null || run.parent_run_id === undefined) ? (
                              <span className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
                                Standalone analysis
                              </span>
                            ) : null}
                          </div>
                          <div className="text-sm text-[#F5F5F5]/60">
                            Updated: {formatDate(run.updated_at)} · Started: {formatDate(run.created_at)}
                          </div>
                          {run.stage ? (
                            <div className="mt-1 text-xs text-[#F5F5F5]/50">
                              {run.stage}: {run.message || ""}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {run.status === "running" && (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/20">
                              <div
                                className="h-full rounded-full bg-[#e5e5e5] transition-all duration-300"
                                style={{ width: `${Math.max(5, run.progress * 100)}%` }}
                              />
                            </div>
                            <span className="min-w-[3ch] text-sm font-medium text-[#F5F5F5]">
                              {Math.round(run.progress * 100)}%
                            </span>
                          </div>
                        )}

                        {(run.status === "succeeded" ||
                          run.status === "failed" ||
                          run.status === "running" ||
                          run.status === "queued") && (
                          <Link
                            to={getRunRoute(run)}
                            state={{ fromRunHistory: `/tools/run-log/${activeFamily.slug}` }}
                            className="flex items-center gap-2 rounded-full border border-white/25 bg-white px-4 py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white/90"
                          >
                            <Eye className="h-4 w-4" />
                            {run.status === "running" || run.status === "queued" ? "Open" : "View results"}
                          </Link>
                        )}
                        {run.download_zip_url && run.status === "succeeded" ? (
                          <a
                            href={apiUrl(run.download_zip_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/20 px-3 py-2 text-sm text-white/90 transition hover:bg-white/10"
                          >
                            Download
                          </a>
                        ) : null}
                        {run.status !== "running" && run.status !== "queued" && (
                          <button
                            type="button"
                            onClick={() => useRunsStore.getState().removeRun(run.id)}
                            className="rounded-lg border border-white/15 bg-transparent p-2 text-[#F5F5F5]/70 transition hover:border-[#f87171]/60 hover:text-white"
                            title="Remove from history"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
