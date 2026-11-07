import { ArrowUpRight, Crosshair, Info, Maximize2, Minus, Network, Plus, Search, Table2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewEdge } from "@/lib/api";
import { useReview } from "../ReviewContext";
import { collapseLeafGroups, lineageOf, NODE_KIND_LABEL, RELATION_LABEL, simplifyResearchGraph, type GraphNode, type NodeKind } from "../lib/graph";
import { edgePath, LAYOUT, layoutGraph } from "../lib/graphLayout";
import { nodeActions } from "../lib/nodeActions";
import { useRunRoute } from "../components/assets";
import { DataTable, type Column } from "../components/DataTable";
import { btn, Chip, cx, EmptyState, ProvenanceBadge, ProvenanceGlyph, surface } from "../components/primitives";

const KIND_FILTERS: { id: string; label: string; kinds: NodeKind[] }[] = [
  { id: "stock", label: "Stocks", kinds: ["stock"] },
  { id: "source", label: "Label searches & generators", kinds: ["optimizer", "generator"] },
  { id: "data", label: "Datasets", kinds: ["dataset", "archive", "testset"] },
  { id: "train", label: "Training & models", kinds: ["trainer", "model"] },
  { id: "eval", label: "Analyses, test sets & backtests", kinds: ["analysis", "testdata", "backtest"] },
  { id: "bot", label: "Bots", kinds: ["bot"] },
];

const LARGE = 260;
const MIN_K = 0.15;
const MAX_K = 2.5;

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Node caption: the kind and id tail are already in the node header, so drop them from the title. */
function nodeCaption(n: GraphNode): string {
  const tail = ` · ${n.ref.id.slice(-4)}`;
  const base = n.label.endsWith(tail) ? n.label.slice(0, -tail.length) : n.label;
  return base.replace(/ · (Training|Test) set( archive)?$/, "") || base;
}

export function LineageView() {
  const { graph: rawGraph, focus, setFocus, inspect, data } = useReview();
  const [mode, setMode] = useState<"graph" | "table">("graph");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showIsolated, setShowIsolated] = useState(false);
  const [showRecovered, setShowRecovered] = useState(true);
  /** Default: research assets only (fold generator/trainer/testdata runs into their products). */
  const [showTechnicalRuns, setShowTechnicalRuns] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const graph = useMemo(() => (showTechnicalRuns ? rawGraph : simplifyResearchGraph(rawGraph)), [rawGraph, showTechnicalRuns]);

  const edges = useMemo(() => graph.edges.filter((e) => showRecovered || e.provenance === "recorded"), [graph.edges, showRecovered]);

  const visible = useMemo(() => {
    const hiddenKinds = new Set(KIND_FILTERS.filter((k) => hidden.has(k.id)).flatMap((k) => k.kinds));
    const connected = new Set<string>();
    for (const e of edges) {
      if (e.relation === "price_data") continue;
      connected.add(e.source);
      connected.add(e.target);
    }
    // a stock counts as linked only when one of the runs it feeds is linked to something else
    for (const e of edges) if (e.relation === "price_data" && connected.has(e.target)) connected.add(e.source);
    let keys = [...graph.nodes.keys()];
    if (focus && graph.nodes.has(focus)) {
      const lin = lineageOf(graph, focus);
      keys = keys.filter((k) => lin.has(k));
    } else if (!showIsolated) {
      keys = keys.filter((k) => connected.has(k));
    }
    return new Set(keys.filter((k) => !hiddenKinds.has(graph.nodes.get(k)!.kind) || k === focus));
  }, [graph, edges, focus, hidden, showIsolated]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sub = useMemo(() => {
    const vEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target));
    const pinned = new Set([selected, focus].filter((k): k is string => !!k));
    const c = collapseLeafGroups(graph.nodes, visible, vEdges, expanded, pinned);
    const out = new Map<string, ReviewEdge[]>();
    const inc = new Map<string, ReviewEdge[]>();
    for (const e of c.edges) {
      (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
      (inc.get(e.target) ?? inc.set(e.target, []).get(e.target)!).push(e);
    }
    return { nodes: c.nodes, keys: c.keys, edges: c.edges, out, in: inc };
  }, [graph.nodes, edges, visible, expanded, selected, focus]);
  const groupCount = useMemo(() => [...sub.keys].filter((k) => sub.nodes.get(k)?.group).length, [sub]);

  useEffect(() => {
    if (selected && !visible.has(selected)) setSelected(null);
  }, [selected, visible]);

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return [...graph.nodes.values()].filter((x) => `${x.label} ${x.key}`.toLowerCase().includes(n)).slice(0, 8);
  }, [q, graph.nodes]);

  const pick = (key: string) => {
    if (!visible.has(key)) setFocus(key);
    setSelected(key);
    setQ("");
  };

  const recordedCount = graph.edges.filter((e) => e.provenance === "recorded" && e.relation !== "price_data").length;
  const recoveredCount = graph.edges.filter((e) => e.provenance === "recovered").length;
  const unresolvedCount = [...graph.nodes.values()].filter((n) => n.unresolved).length;
  const unknownBots = (data?.bots ?? []).filter((b) => !b.provenance || b.provenance === "unknown").length;

  if (graph.nodes.size === 0) {
    return <EmptyState title="Nothing to connect yet" body="Lineage appears once a generator, trainer or backtest records which assets it used." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
              if (e.key === "Enter" && matches[0]) pick(matches[0].key);
            }}
            placeholder="Search stocks, runs, datasets, models…"
            aria-label="Search the lineage graph"
            className="h-9 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] pl-9 pr-3 text-[13.5px] text-white placeholder:text-white/35 transition focus:border-white/30 focus:bg-white/[0.05] focus:outline-none"
          />
          {matches.length ? (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-white/[0.12] bg-black py-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)]" role="listbox">
              {matches.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => pick(m.key)}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13.5px] text-white/85 hover:bg-white/[0.05]"
                  >
                    <span className="truncate">{m.label}</span>
                    <span className="shrink-0 text-[12.5px] text-white/40">{NODE_KIND_LABEL[m.kind]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {focus ? (
          <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/30 bg-white/[0.08] px-3 text-[13px] font-medium text-white">
            <Crosshair className="h-4 w-4" />
            Only the lineage of {truncate(graph.nodes.get(focus)?.label ?? focus, 40)}
            <button type="button" onClick={() => setFocus(null)} aria-label="Show the whole graph" className="text-white/50 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
        <div className="ml-auto flex h-9 items-center gap-0.5 rounded-lg border border-white/[0.1] p-0.5">
          <button type="button" onClick={() => setMode("graph")} aria-pressed={mode === "graph"} className={cx("inline-flex h-full items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition", mode === "graph" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white")}>
            <Network className="h-4 w-4" /> Graph
          </button>
          <button type="button" onClick={() => setMode("table")} aria-pressed={mode === "table"} className={cx("inline-flex h-full items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition", mode === "table" ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white")}>
            <Table2 className="h-4 w-4" /> Links table
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {KIND_FILTERS.map((k) => (
          <Chip key={k.id} active={!hidden.has(k.id)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(k.id)) n.delete(k.id); else n.add(k.id); return n; })}>
            {k.label}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-white/[0.1]" />
        <Chip active={showRecovered} onClick={() => setShowRecovered((v) => !v)} title="Links reconstructed after the fact">
          <ProvenanceGlyph p="recovered" /> Recovered links
        </Chip>
        <Chip active={showIsolated} onClick={() => setShowIsolated((v) => !v)} title="Assets with no recorded links">
          Unlinked assets
        </Chip>
        <Chip
          active={showTechnicalRuns}
          onClick={() => setShowTechnicalRuns((v) => !v)}
          title="Show generator, trainer and test-data runs as separate nodes (full technical lineage)"
        >
          Technical runs
        </Chip>
        {expanded.size ? (
          <Chip active={false} onClick={() => setExpanded(new Set())} title="Fold repeated sibling assets back into groups">
            Collapse groups
          </Chip>
        ) : groupCount ? (
          <span className="text-[12.5px] text-white/40">{groupCount} group{groupCount > 1 ? "s" : ""} folded · click one to expand</span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-4 text-[13px] text-white/50">
          <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" /></svg>Recorded · {recordedCount}</span>
          <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeDasharray="3 3" /></svg>Recovered · {recoveredCount}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-dashed border-white/40" />Not in workspace · {unresolvedCount}</span>
        </span>
      </div>

      {mode === "graph" ? (
        visible.size === 0 ? (
          <EmptyState
            title={graph.edges.length === 0 ? "No recorded links yet" : "No assets match the current filters"}
            body={graph.edges.length === 0 ? "Assets exist, but none of them recorded what they were built from. Enable “Unlinked assets” to see them." : undefined}
            action={!showIsolated ? <button type="button" className={btn} onClick={() => setShowIsolated(true)}>Show unlinked assets</button> : undefined}
          />
        ) : (
          <GraphCanvas
            sub={sub}
            keys={sub.keys}
            selected={selected}
            focus={focus}
            onSelect={setSelected}
            onExpand={(k) => setExpanded((s) => new Set(s).add(k))}
            onFocus={(k) => setFocus(k)}
            onDetails={(n) => inspect(n.ref.kind === "stock" ? null : (n.ref as { kind: "model" | "dataset" | "run" | "bot"; id: string }))}
          />
        )
      ) : (
        <EdgeTable edges={sub.edges} />
      )}

      <p className="max-w-5xl text-[13px] leading-relaxed text-white/40">
        {showTechnicalRuns
          ? "Technical view: generator, trainer and test-data runs appear as their own nodes."
          : "Research view: each node is a stock, dataset, model, analysis, backtest or bot. Generator, trainer and test-data runs are folded into the assets they produced — turn on Technical runs for the full chain."}{" "}
        Every link comes from metadata the tools wrote (recorded) or from an explicit, documented reconstruction such as chart-filename overlap (recovered). Stock links come from the
        symbols each run recorded in its own configuration. Nothing is inferred from matching names.
        {unknownBots ? ` ${unknownBots} bot${unknownBots > 1 ? "s were" : " was"} deployed before provenance was recorded and stay unlinked.` : ""}
        {" "}Click a node to lock its lineage and see its actions · click it again or the background to clear · double-click or F to show only its lineage · scroll to zoom · drag to pan.
      </p>
    </div>
  );
}

function EdgeTable({ edges }: { edges: ReviewEdge[] }) {
  const { graph, inspect } = useReview();
  const label = (k: string) => graph.nodes.get(k)?.label ?? k;
  const kind = (k: string) => NODE_KIND_LABEL[graph.nodes.get(k)?.kind ?? "unresolved"];
  const columns: Column<ReviewEdge>[] = [
    {
      id: "src",
      header: "From",
      sort: (e) => label(e.source),
      cell: (e) => (
        <div className="max-w-[300px]">
          <div className="truncate text-white/85">{label(e.source)}</div>
          <div className="text-[12.5px] text-white/40">{kind(e.source)}</div>
        </div>
      ),
    },
    { id: "rel", header: "Relation", sort: (e) => e.relation, cell: (e) => <span className="font-mono text-[13px] text-white/60">{RELATION_LABEL[e.relation] ?? e.relation}</span> },
    {
      id: "dst",
      header: "To",
      sort: (e) => label(e.target),
      cell: (e) => (
        <div className="max-w-[300px]">
          <div className="truncate text-white/85">{label(e.target)}</div>
          <div className="text-[12.5px] text-white/40">{kind(e.target)}</div>
        </div>
      ),
    },
    { id: "prov", header: "Provenance", sort: (e) => e.provenance, cell: (e) => <ProvenanceBadge p={e.provenance} basis={e.basis} /> },
    { id: "basis", header: "Basis", cell: (e) => <span className="text-[13px] text-white/50">{e.basis}</span> },
  ];
  if (!edges.length) return <EmptyState title="No links match the current filters" />;
  return (
    <DataTable
      ariaLabel="Provenance links"
      rows={edges}
      rowKey={(e) => `${e.source}>${e.relation}>${e.target}`}
      columns={columns}
      onActivate={(e) => {
        const n = graph.nodes.get(e.target);
        if (n && !n.unresolved && n.ref.kind !== "stock") inspect(n.ref as { kind: "model" | "dataset" | "run" | "bot"; id: string });
      }}
      minWidth={900}
    />
  );
}

interface Sub {
  nodes: Map<string, GraphNode>;
  edges: ReviewEdge[];
  out: Map<string, ReviewEdge[]>;
  in: Map<string, ReviewEdge[]>;
}

function GraphCanvas({
  sub,
  keys,
  selected,
  focus,
  onSelect,
  onExpand,
  onFocus,
  onDetails,
}: {
  sub: Sub;
  keys: Set<string>;
  selected: string | null;
  focus: string | null;
  onSelect: (key: string | null) => void;
  onExpand: (groupKey: string) => void;
  onFocus: (key: string) => void;
  onDetails: (n: GraphNode) => void;
}) {
  const { find, modelFor } = useReview();
  const runRoute = useRunRoute();
  const layout = useMemo(() => layoutGraph(sub, keys), [sub, keys]);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const large = keys.size > LARGE;

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    const byWidth = Math.min(1, (cw - 16) / layout.width);
    const whole = Math.min(byWidth, (ch - 16) / layout.height);
    // Keep nodes legible: never shrink below ~55 % just to fit everything; start at the top-left instead.
    const k = Math.max(MIN_K, Math.min(1, Math.max(whole, 0.55)));
    setView({ k, x: layout.width * k < cw ? (cw - layout.width * k) / 2 : 8, y: layout.height * k < ch ? (ch - layout.height * k) / 2 : 8 });
  }, [layout]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return { ...v, x: v.x - e.deltaX };
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f: number) => {
    const el = wrap.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f));
      return { k, x: cw / 2 - ((cw / 2 - v.x) * k) / v.k, y: ch / 2 - ((ch / 2 - v.y) * k) / v.k };
    });
  };

  const trace = useCallback(
    (k: string) => {
      const seen = new Set<string>([k]);
      const walk = (start: string, dir: "out" | "in") => {
        const stack = [start];
        while (stack.length) {
          const cur = stack.pop()!;
          for (const e of sub[dir].get(cur) ?? []) {
            const n = dir === "out" ? e.target : e.source;
            if (!seen.has(n)) {
              seen.add(n);
              stack.push(n);
            }
          }
        }
      };
      walk(k, "out");
      walk(k, "in");
      return seen;
    },
    [sub],
  );

  // A locked selection wins over hover; hover only previews while nothing is selected.
  const active = selected && keys.has(selected) ? selected : !large ? hover : null;
  const highlight = useMemo(() => (active ? trace(active) : null), [active, trace]);
  const litEdge = (e: ReviewEdge) => !!highlight && highlight.has(e.source) && highlight.has(e.target);

  const { nodeW, nodeH } = LAYOUT;
  const selNode = selected ? sub.nodes.get(selected) : null;
  const selPos = selected ? layout.pos.get(selected) : null;
  const actions = useMemo(
    () =>
      selNode
        ? nodeActions(selNode, {
            graph: sub,
            model: (id) => modelFor(id),
            run: (id) => {
              const a = find({ kind: "run", id });
              return a?.kind === "run" ? a.item : null;
            },
            dataset: (id) => {
              const a = find({ kind: "dataset", id });
              return a?.kind === "dataset" ? a.item : null;
            },
            runRoute,
          })
        : [],
    [selNode, sub, modelFor, find, runRoute],
  );

  // Relation names on the highlighted lineage only, placed at each target's input, stacked per target.
  const edgeLabels = useMemo(() => {
    if (!highlight) return [];
    const perTarget = new Map<string, Set<string>>();
    const out: { key: string; x: number; y: number; text: string }[] = [];
    for (const e of sub.edges) {
      if (!litEdge(e) || e.relation === "price_data") continue;
      const a = layout.pos.get(e.source);
      const b = layout.pos.get(e.target);
      if (!a || !b || b.x <= a.x) continue;
      const text = RELATION_LABEL[e.relation] ?? e.relation;
      const seen = perTarget.get(e.target) ?? perTarget.set(e.target, new Set()).get(e.target)!;
      if (seen.has(text)) continue;
      out.push({ key: `${e.target}>${text}`, x: b.x - 8, y: b.y + nodeH / 2 - 6 - seen.size * 13, text });
      seen.add(text);
    }
    return out;
  }, [highlight, sub.edges, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sorted so lit edges are drawn last (on top).
  const orderedEdges = useMemo(() => (highlight ? [...sub.edges].sort((a, b) => Number(litEdge(a)) - Number(litEdge(b))) : sub.edges), [sub.edges, highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cx(surface, "relative overflow-hidden")} style={{ height: "min(76vh, 860px)" }} data-help="hub-lineage">
      <div
        ref={wrap}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node],[data-actions]")) return;
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={() => {
          if (drag.current && !drag.current.moved) onSelect(null);
          drag.current = null;
        }}
      >
        <svg width="100%" height="100%" role="group" aria-label="Lineage graph">
          <defs>
            <marker id="lin-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="rgba(255,255,255,0.55)" />
            </marker>
            <marker id="lin-arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="rgba(255,255,255,0.95)" />
            </marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout.columns.map((c, i) => (
              <g key={c.index}>
                {i % 2 === 1 ? <rect x={c.x - LAYOUT.colGap / 2} y={0} width={c.width + LAYOUT.colGap} height={layout.height} fill="rgba(255,255,255,0.018)" /> : null}
                <text x={c.x} y={LAYOUT.pad - 6} fill={c.empty ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.6)"} fontSize={13} fontWeight={600}>
                  {i + 1}. {c.title}
                </text>
                {c.empty ? (
                  <text x={c.x} y={LAYOUT.pad + 14} fill="rgba(255,255,255,0.22)" fontSize={11.5}>
                    nothing here yet
                  </text>
                ) : null}
              </g>
            ))}
            {orderedEdges.map((e) => {
              const d = edgePath(e, layout);
              if (!d) return null;
              const lit = litEdge(e);
              const dim = highlight && !lit;
              const price = e.relation === "price_data";
              return (
                <path
                  key={`${e.source}>${e.relation}>${e.target}`}
                  d={d}
                  fill="none"
                  stroke={lit ? "rgba(255,255,255,0.92)" : price ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.34)"}
                  strokeOpacity={dim ? 0.12 : 1}
                  strokeWidth={lit ? 1.6 : 1}
                  strokeDasharray={e.provenance === "recovered" ? "4 3" : undefined}
                  markerEnd={lit ? "url(#lin-arrow-lit)" : "url(#lin-arrow)"}
                >
                  <title>{`${RELATION_LABEL[e.relation] ?? e.relation} · ${e.provenance} · ${e.basis}`}</title>
                </path>
              );
            })}
            {[...keys].map((k) => {
              const n = sub.nodes.get(k)!;
              const p = layout.pos.get(k);
              if (!p) return null;
              const isSel = k === selected;
              const focused = k === focus;
              const dim = highlight && !highlight.has(k);
              const lit = highlight?.has(k) && !isSel;
              const failed = n.status === "failed" || n.status === "interrupted";
              const stock = n.kind === "stock";
              return (
                <g
                  key={k}
                  data-node
                  role="button"
                  tabIndex={0}
                  aria-label={`${NODE_KIND_LABEL[n.kind]}: ${n.label}`}
                  aria-pressed={isSel}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={dim ? 0.22 : 1}
                  className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-white"
                  onMouseEnter={() => !large && setHover(k)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => (n.group ? onExpand(k) : onSelect(isSel ? null : k))}
                  onDoubleClick={() => !n.group && onFocus(k)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") n.group ? onExpand(k) : onSelect(isSel ? null : k);
                    if ((e.key === "f" || e.key === "F") && !n.group) onFocus(k);
                  }}
                >
                  <title>{`${NODE_KIND_LABEL[n.kind]} · ${n.label}${n.sublabel ? `\n${n.sublabel}` : ""}`}</title>
                  {n.group ? (
                    <>
                      <rect x={8} y={-8} width={nodeW - 16} height={nodeH} rx={10} fill="#050505" stroke="rgba(255,255,255,0.12)" />
                      <rect x={4} y={-4} width={nodeW - 8} height={nodeH} rx={10} fill="#050505" stroke="rgba(255,255,255,0.15)" />
                    </>
                  ) : null}
                  <rect
                    width={nodeW}
                    height={nodeH}
                    rx={stock ? nodeH / 2 : 10}
                    fill={isSel ? "#1c1c1c" : lit ? "#0e0e0e" : "#050505"}
                    stroke={isSel || focused ? "rgba(255,255,255,0.95)" : lit ? "rgba(255,255,255,0.55)" : n.unresolved ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)"}
                    strokeDasharray={n.unresolved ? "3 3" : undefined}
                    strokeWidth={isSel ? 1.6 : 1}
                  />
                  {n.kind === "model" ? <rect x={0} y={10} width={2.5} height={nodeH - 20} rx={1} fill="rgba(255,255,255,0.85)" /> : null}
                  <text x={stock ? 22 : 14} y={21} fill="rgba(255,255,255,0.45)" fontSize={11.5}>
                    {NODE_KIND_LABEL[n.kind]}
                  </text>
                  {n.group ? (
                    <text x={nodeW - 14} y={21} fill="rgba(255,255,255,0.6)" fontSize={11} textAnchor="end">
                      expand +{n.group.members.length}
                    </text>
                  ) : !stock ? (
                    <text x={nodeW - 24} y={21} fill="rgba(255,255,255,0.3)" fontSize={10.5} textAnchor="end" fontFamily="ui-monospace, monospace">
                      {n.ref.id.length > 8 ? n.ref.id.slice(-6) : n.ref.id}
                    </text>
                  ) : null}
                  {n.status && !n.group ? (
                    <circle cx={nodeW - 14} cy={17} r={3} fill={failed ? "rgba(248,113,113,0.85)" : n.status === "running" || n.status === "queued" ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.75)"} />
                  ) : null}
                  <text x={stock ? 22 : 14} y={42} fill={n.unresolved ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.92)"} fontSize={13} fontWeight={500}>
                    {truncate(n.group ? n.label.replace(/ · (Training|Test) set( archive)?$/, "") : nodeCaption(n), 30)}
                  </text>
                </g>
              );
            })}
            {edgeLabels.map((l) => (
              <text
                key={l.key}
                x={l.x}
                y={l.y}
                textAnchor="end"
                fontSize={11}
                fill="rgba(255,255,255,0.85)"
                stroke="#000"
                strokeWidth={3}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {l.text}
              </text>
            ))}
          </g>
        </svg>
      </div>

      {selNode && selPos ? (
        <div
          data-actions
          className="absolute z-10 w-[min(280px,80vw)] rounded-xl border border-white/[0.16] bg-black/95 p-2 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.95)] backdrop-blur"
          style={{ left: Math.max(8, view.x + selPos.x * view.k), top: view.y + (selPos.y + nodeH) * view.k + 8 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="truncate px-2 pt-0.5 text-[12px] text-white/45">
            {NODE_KIND_LABEL[selNode.kind]} · {truncate(selNode.label, 34)}
          </p>
          <p className="px-2 pb-1.5 text-[11.5px] text-white/35">
            {(sub.in.get(selNode.key) ?? []).length} input{(sub.in.get(selNode.key) ?? []).length === 1 ? "" : "s"} ·{" "}
            {(sub.out.get(selNode.key) ?? []).length} output{(sub.out.get(selNode.key) ?? []).length === 1 ? "" : "s"}
            {highlight ? ` · ${highlight.size - 1} in its lineage` : ""}
          </p>
          <div className="flex flex-col">
            {actions.map((a) =>
              a.to ? (
                <Link
                  key={a.id}
                  to={a.to}
                  className={cx("flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] transition hover:bg-white/[0.07]", a.primary ? "font-medium text-white" : "text-white/75")}
                >
                  {a.label} <ArrowUpRight className="h-3.5 w-3.5 text-white/35" />
                </Link>
              ) : (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onDetails(selNode)}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] text-white/75 transition hover:bg-white/[0.07]"
                >
                  {a.label} <Info className="h-3.5 w-3.5 text-white/35" />
                </button>
              ),
            )}
            {!actions.length ? <p className="px-2 py-1 text-[12.5px] text-white/40">Not in this workspace, so there is nothing to open.</p> : null}
          </div>
        </div>
      ) : null}

      <div className="absolute bottom-4 right-4 flex flex-col overflow-hidden rounded-lg border border-white/[0.14] bg-black/90 backdrop-blur">
        <button type="button" className="p-2 text-white/60 hover:bg-white/[0.06] hover:text-white" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className="border-y border-white/[0.1] p-2 text-white/60 hover:bg-white/[0.06] hover:text-white" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" className="p-2 text-white/60 hover:bg-white/[0.06] hover:text-white" onClick={fit} aria-label="Fit to view">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-5 font-digits text-[12.5px] tabular-nums text-white/35">
        {keys.size} nodes · {sub.edges.length} links · {Math.round(view.k * 100)}%
        {selected ? " · selection locked (click background to clear)" : large ? " · large graph: click a node to trace it" : ""}
      </div>
    </div>
  );
}
