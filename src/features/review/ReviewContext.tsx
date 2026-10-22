import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  LibraryLabelPatch,
  ReviewBot,
  ReviewDataset,
  ReviewModel,
  ReviewOverviewResponse,
  ReviewRun,
} from "@/lib/api";
import { datasetsApi, internalModelsApi, reviewApi } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { buildGraph, type AssetRefKind, type Graph } from "./lib/graph";
import { datasetName, disambiguate, modelName, runName } from "./lib/naming";

export const TABS = ["overview", "models", "datasets", "backtests", "runs", "lineage", "compare"] as const;
export type TabId = (typeof TABS)[number];

export interface AssetRef {
  kind: AssetRefKind;
  id: string;
}

export const refKey = (r: AssetRef) => `${r.kind}:${r.id}`;

export function parseRef(v: string | null): AssetRef | null {
  if (!v) return null;
  const i = v.indexOf(":");
  if (i < 0) return null;
  const kind = v.slice(0, i);
  const id = v.slice(i + 1);
  return id && (kind === "model" || kind === "dataset" || kind === "run" || kind === "bot") ? { kind, id } : null;
}

export type Asset =
  | { kind: "model"; item: ReviewModel }
  | { kind: "dataset"; item: ReviewDataset }
  | { kind: "run"; item: ReviewRun }
  | { kind: "bot"; item: ReviewBot };

interface Names {
  model: Map<string, string>;
  dataset: Map<string, string>;
  run: Map<string, string>;
  derived: Map<string, string>;
}

interface ReviewState {
  data: ReviewOverviewResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  names: Names;
  graph: Graph;
  titleOf: (ref: AssetRef) => string;
  find: (ref: AssetRef) => Asset | null;
  /** Model asset by model id or by its training run id. */
  modelFor: (id?: string | null) => ReviewModel | null;
  canLabel: (ref: AssetRef) => boolean;
  patchLabel: (ref: AssetRef, patch: LibraryLabelPatch) => Promise<void>;
  tab: TabId;
  setTab: (t: TabId) => void;
  inspected: AssetRef | null;
  inspect: (r: AssetRef | null) => void;
  compare: AssetRef[];
  toggleCompare: (r: AssetRef) => void;
  setCompare: (refs: AssetRef[]) => void;
  focus: string | null;
  setFocus: (key: string | null) => void;
  /** Open a tab and inspector together (e.g. from the lineage graph). */
  open: (tab: TabId, r?: AssetRef | null) => void;
  /** Switch to the lineage tab focused on one node. */
  showLineage: (nodeKey: string) => void;
}

const Ctx = createContext<ReviewState | null>(null);

export function useReview(): ReviewState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReview must be used inside ReviewProvider");
  return v;
}

const EMPTY: ReviewOverviewResponse = {
  summary: {
    totalRuns: 0,
    runningRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    totalModels: 0,
    totalDatasets: 0,
    totalTrainingRuns: 0,
    totalBacktests: 0,
    totalAnalyses: 0,
    totalBots: 0,
  },
  runs: [],
  models: [],
  datasets: [],
  lineages: [],
  bots: [],
  edges: [],
};

/** Keep the machine name in `auto_name` for every asset so overlays never lose it. */
function normalize(d: ReviewOverviewResponse): ReviewOverviewResponse {
  const fix = <T extends { name?: string | null; auto_name?: string | null; display_name?: string | null }>(x: T): T =>
    x.auto_name ? x : { ...x, auto_name: x.display_name ? null : x.name ?? null };
  return { ...d, models: d.models.map(fix), datasets: d.datasets.map(fix) };
}

const MAX_COMPARE = 4;

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<ReviewOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(normalize(await reviewApi.getOverview()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the research workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void useRunsStore.getState().mergeRunsFromBackendList(200);
  }, [reload]);

  const d = data ?? EMPTY;

  const index = useMemo(() => {
    const models = new Map<string, ReviewModel>();
    const modelsByRun = new Map<string, ReviewModel>();
    for (const m of d.models) {
      models.set(m.id, m);
      if (m.training_run_id) modelsByRun.set(m.training_run_id, m);
    }
    return {
      models,
      modelsByRun,
      datasets: new Map(d.datasets.map((x) => [x.id, x])),
      datasetsById: new Map(d.datasets.filter((x) => x.dataset_id).map((x) => [x.dataset_id as string, x])),
      runs: new Map(d.runs.map((x) => [x.id, x])),
      bots: new Map(d.bots.map((x) => [x.id, x])),
    };
  }, [d]);

  const names = useMemo<Names>(() => {
    const derived = new Map<string, string>();
    const model = disambiguate(d.models, (m) => modelName(m).title);
    d.models.forEach((m) => derived.set(`model:${m.id}`, modelName(m).derived));
    const modelTitles = new Map<string, string>();
    for (const m of d.models) {
      const t = model.get(m.id)!;
      modelTitles.set(m.id, t);
      if (m.training_run_id) modelTitles.set(m.training_run_id, t);
    }
    const dataset = disambiguate(d.datasets, (x) => datasetName(x).title);
    d.datasets.forEach((x) => derived.set(`dataset:${x.id}`, datasetName(x).derived));
    const run = disambiguate(d.runs, (r) => runName(r, modelTitles).title);
    d.runs.forEach((r) => derived.set(`run:${r.id}`, runName(r, modelTitles).derived));
    return { model, dataset, run, derived };
  }, [d]);

  const graph = useMemo(
    () =>
      buildGraph(d, {
        run: (r) => names.run.get(r.id) ?? r.id,
        model: (m) => names.model.get(m.id) ?? m.id,
        dataset: (x) => names.dataset.get(x.id) ?? x.id,
      }),
    [d, names],
  );

  const find = useCallback(
    (ref: AssetRef): Asset | null => {
      switch (ref.kind) {
        case "model": {
          const m = index.models.get(ref.id) ?? index.modelsByRun.get(ref.id);
          return m ? { kind: "model", item: m } : null;
        }
        case "dataset": {
          const x = index.datasets.get(ref.id) ?? index.datasetsById.get(ref.id);
          return x ? { kind: "dataset", item: x } : null;
        }
        case "run": {
          const r = index.runs.get(ref.id);
          return r ? { kind: "run", item: r } : null;
        }
        case "bot": {
          const b = index.bots.get(ref.id);
          return b ? { kind: "bot", item: b } : null;
        }
      }
    },
    [index],
  );

  const modelFor = useCallback(
    (id?: string | null) => (id ? index.models.get(id) ?? index.modelsByRun.get(id) ?? null : null),
    [index],
  );

  const titleOf = useCallback(
    (ref: AssetRef) => {
      const a = find(ref);
      if (!a) return ref.id;
      if (a.kind === "bot") return a.item.name || `Bot ${a.item.symbol}`;
      return names[a.kind].get(a.item.id) ?? ref.id;
    },
    [find, names],
  );

  const canLabel = useCallback(
    (ref: AssetRef) => {
      const a = find(ref);
      if (!a) return false;
      if (a.kind === "dataset") return !!a.item.dataset_id && a.item.representation !== "archive";
      return a.kind === "model" || a.kind === "run";
    },
    [find],
  );

  const patchLabel = useCallback(
    async (ref: AssetRef, patch: LibraryLabelPatch) => {
      const a = find(ref);
      if (!a) return;
      try {
        let overlay: Partial<ReviewModel>;
        if (a.kind === "model") overlay = await internalModelsApi.updateLabel(a.item.id, patch);
        else if (a.kind === "dataset" && a.item.dataset_id) overlay = await datasetsApi.updateLabel(a.item.dataset_id, patch);
        else if (a.kind === "run") overlay = await reviewApi.updateRunLabel(a.item.id, patch);
        else return;
        const fields = {
          display_name: overlay.display_name ?? null,
          tags: overlay.tags ?? [],
          favorite: !!overlay.favorite,
          archived: !!overlay.archived,
          notes: overlay.notes ?? null,
        };
        setData((prev) => {
          if (!prev) return prev;
          if (a.kind === "model") return { ...prev, models: prev.models.map((m) => (m.id === a.item.id ? { ...m, ...fields } : m)) };
          if (a.kind === "dataset") return { ...prev, datasets: prev.datasets.map((x) => (x.id === a.item.id ? { ...x, ...fields } : x)) };
          return { ...prev, runs: prev.runs.map((r) => (r.id === a.item.id ? { ...r, ...fields } : r)) };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save label");
      }
    },
    [find],
  );

  // ---- URL state: ?tab=&inspect=kind:id&compare=kind:id,kind:id&focus=nodeKey
  const tabParam = params.get("tab");
  const tab: TabId = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as TabId) : "overview";
  const inspected = parseRef(params.get("inspect"));
  const compare = useMemo(
    () =>
      (params.get("compare") ?? "")
        .split(",")
        .map((s) => parseRef(s))
        .filter((r): r is AssetRef => !!r)
        .slice(0, MAX_COMPARE),
    [params],
  );
  const focus = params.get("focus");

  const update = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mut(next);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setTab = useCallback((t: TabId) => update((p) => (t === "overview" ? p.delete("tab") : p.set("tab", t))), [update]);
  const inspect = useCallback((r: AssetRef | null) => update((p) => (r ? p.set("inspect", refKey(r)) : p.delete("inspect"))), [update]);
  const setFocus = useCallback((k: string | null) => update((p) => (k ? p.set("focus", k) : p.delete("focus"))), [update]);
  const setCompare = useCallback(
    (refs: AssetRef[]) =>
      update((p) => (refs.length ? p.set("compare", refs.slice(0, MAX_COMPARE).map(refKey).join(",")) : p.delete("compare"))),
    [update],
  );
  const toggleCompare = useCallback(
    (r: AssetRef) => {
      const k = refKey(r);
      const has = compare.some((c) => refKey(c) === k);
      const sameKind = compare.filter((c) => c.kind === r.kind && (r.kind !== "run" || find(c)?.kind === "run"));
      setCompare(has ? compare.filter((c) => refKey(c) !== k) : [...sameKind, r].slice(-MAX_COMPARE));
    },
    [compare, setCompare, find],
  );
  const open = useCallback(
    (t: TabId, r?: AssetRef | null) =>
      update((p) => {
        if (t === "overview") p.delete("tab");
        else p.set("tab", t);
        if (r) p.set("inspect", refKey(r));
      }),
    [update],
  );
  const showLineage = useCallback(
    (k: string) =>
      update((p) => {
        p.set("tab", "lineage");
        p.set("focus", k);
      }),
    [update],
  );

  const value: ReviewState = {
    data,
    loading,
    error,
    reload,
    names,
    graph,
    titleOf,
    find,
    modelFor,
    canLabel,
    patchLabel,
    tab,
    setTab,
    inspected,
    inspect,
    compare,
    toggleCompare,
    setCompare,
    focus,
    setFocus,
    open,
    showLineage,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
