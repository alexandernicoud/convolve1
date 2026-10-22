import { Crosshair, Maximize2, Minus, Network, Plus, Search, Table2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewEdge } from "@/lib/api";
import { useReview } from "../ReviewContext";
import {
  LAYOUT,
  layoutGraph,
  lineageOf,
  NODE_KIND_LABEL,
  RELATION_LABEL,
  stageTitle,
  type GraphNode,
  type NodeKind,
} from "../lib/graph";
import { DataTable, type Column } from "../components/DataTable";
import { btn, Chip, cx, EmptyState, ProvenanceBadge, ProvenanceGlyph, surface } from "../components/primitives";

const KIND_FILTERS: { id: string; label: string; kinds: NodeKind[] }[] = [
  { id: "data", label: "Datasets", kinds: ["dataset", "archive", "testset"] },
  { id: "source", label: "Generator & search", kinds: ["generator", "optimizer"] },
  { id: "train", label: "Training", kinds: ["trainer"] },
  { id: "model", label: "Models", kinds: ["model"] },
  { id: "eval", label: "Test sets, analyses & backtests", kinds: ["testdata", "analysis", "backtest"] },
  { id: "bot", label: "Bots", kinds: ["bot"] },
];

const LARGE = 220;
const MIN_K = 0.2;
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
  const { graph, focus, setFocus, inspect, inspected, data } = useReview();
  const [mode, setMode] = useState<"graph" | "table">("graph");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showIsolated, setShowIsolated] = useState(false);
  const [showRecovered, setShowRecovered] = useState(true);
  const [q, setQ] = useState("");

  const edges = useMemo(
    () => graph.edges.filter((e) => showRecovered || e.provenance === "recorded"),
    [graph.edges, showRecovered],
  );

  const visible = useMemo(() => {
    const hiddenKinds = new Set(KIND_FILTERS.filter((k) => hidden.has(k.id)).flatMap((k) => k.kinds));
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    let keys = [...graph.nodes.keys()];
    if (focus && graph.nodes.has(focus)) {
      const lin = lineageOf(graph, focus);
      keys = keys.filter((k) => lin.has(k));
    } else if (!showIsolated) {
      keys = keys.filter((k) => connected.has(k));
    }
    return new Set(keys.filter((k) => !hiddenKinds.has(graph.nodes.get(k)!.kind) || k === focus));
  }, [graph, edges, focus, hidden, showIsolated]);

  const sub = useMemo(() => {
    const vEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target));
    const out = new Map<string, ReviewEdge[]>();
    const inc = new Map<string, ReviewEdge[]>();
    for (const e of vEdges) {
      (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
      (inc.get(e.target) ?? inc.set(e.target, []).get(e.target)!).push(e);
    }
    return { nodes: graph.nodes, edges: vEdges, out, in: inc };
  }, [graph.nodes, edges, visible]);

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return [...graph.nodes.values()].filter((x) => `${x.label} ${x.key}`.toLowerCase().includes(n)).slice(0, 8);
  }, [q, graph.nodes]);

  const recordedCount = graph.edges.filter((e) => e.provenance === "recorded").length;
  const recoveredCount = graph.edges.length - recordedCount;
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
              if (e.key === "Enter" && matches[0]) {
                setFocus(matches[0].key);
                setQ("");
              }
            }}
            placeholder="Find an asset and focus its lineage"
            aria-label="Find asset in lineage"
            className="h-9 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] pl-9 pr-3 text-[13.5px] text-white placeholder:text-white/35 transition focus:border-white/30 focus:bg-white/[0.05] focus:outline-none"
          />
          {matches.length ? (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-white/[0.12] bg-black py-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)]" role="listbox">
              {matches.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocus(m.key);
                      setQ("");
                    }}
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
            Lineage of {truncate(graph.nodes.get(focus)?.label ?? focus, 40)}
            <button type="button" onClick={() => setFocus(null)} aria-label="Clear focus" className="text-white/50 hover:text-white">
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
            keys={visible}
            selectedKey={inspected ? `${inspected.kind}:${inspected.id}` : null}
            focus={focus}
            onSelect={(n) => inspect(n.ref)}
            onFocus={(k) => setFocus(k)}
          />
        )
      ) : (
        <EdgeTable edges={sub.edges} />
      )}

      <p className="max-w-5xl text-[13px] leading-relaxed text-white/40">
        Every link comes from metadata the tools wrote (recorded) or from an explicit, documented reconstruction such as chart-filename overlap (recovered). Nothing is inferred in the browser.
        {unknownBots ? ` ${unknownBots} bot${unknownBots > 1 ? "s were" : " was"} deployed before provenance was recorded and stay unlinked.` : ""}
        {" "}Click a node to inspect · double-click or F to focus its lineage · scroll to zoom · drag to pan.
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
        if (n && !n.unresolved) inspect(n.ref);
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
  selectedKey,
  focus,
  onSelect,
  onFocus,
}: {
  sub: Sub;
  keys: Set<string>;
  selectedKey: string | null;
  focus: string | null;
  onSelect: (n: GraphNode) => void;
  onFocus: (key: string) => void;
}) {
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
    // Tall graphs stay legible: keep near-full scale and start at the top rather than shrinking to fit.
    const k = Math.max(MIN_K, whole, Math.min(0.85, byWidth));
    setView({ k, x: (cw - layout.width * k) / 2, y: k > whole ? 8 : Math.max(8, (ch - layout.height * k) / 2) });
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

  const highlight = useMemo(() => {
    const k = hover ?? selectedKey;
    if (!k || !keys.has(k)) return null;
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
  }, [hover, selectedKey, keys, sub]);

  const { nodeW, nodeH } = LAYOUT;

  return (
    <div className={cx(surface, "relative overflow-hidden")} style={{ height: "min(72vh, 780px)" }}>
      <div
        ref={wrap}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node]")) return;
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
          drag.current = null;
        }}
      >
        <svg width="100%" height="100%" role="group" aria-label="Lineage graph">
          <defs>
            <marker id="lin-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="rgba(255,255,255,0.55)" />
            </marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout.columns.map((c) => (
              <text key={c.stage} x={c.x + 2} y={16} fill="rgba(255,255,255,0.5)" fontSize={12.5} fontWeight={500}>
                {stageTitle(c.stage)}
              </text>
            ))}
            {sub.edges.map((e) => {
              const a = layout.pos.get(e.source);
              const b = layout.pos.get(e.target);
              if (!a || !b) return null;
              const forward = b.x > a.x;
              const x1 = forward ? a.x + nodeW : a.x + nodeW / 2;
              const y1 = forward ? a.y + nodeH / 2 : a.y + nodeH;
              const x2 = forward ? b.x - 2 : b.x + nodeW / 2;
              const y2 = forward ? b.y + nodeH / 2 : b.y - 2;
              const dx = Math.max(30, (x2 - x1) / 2);
              const d = forward
                ? `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
                : `M${x1},${y1} C${x1},${y1 + 30} ${x2},${y2 - 30} ${x2},${y2}`;
              const lit = highlight ? highlight.has(e.source) && highlight.has(e.target) : false;
              const dim = highlight && !lit;
              return (
                <path
                  key={`${e.source}>${e.relation}>${e.target}`}
                  d={d}
                  fill="none"
                  stroke={lit ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.32)"}
                  strokeOpacity={dim ? 0.25 : 1}
                  strokeWidth={lit ? 1.4 : 1}
                  strokeDasharray={e.provenance === "recovered" ? "4 3" : undefined}
                  markerEnd="url(#lin-arrow)"
                >
                  <title>{`${RELATION_LABEL[e.relation] ?? e.relation} · ${e.provenance} · ${e.basis}`}</title>
                </path>
              );
            })}
            {[...keys].map((k) => {
              const n = sub.nodes.get(k)!;
              const p = layout.pos.get(k);
              if (!p) return null;
              const selected = k === selectedKey;
              const focused = k === focus;
              const dim = highlight && !highlight.has(k);
              const failed = n.status === "failed" || n.status === "interrupted";
              return (
                <g
                  key={k}
                  data-node
                  role="button"
                  tabIndex={0}
                  aria-label={`${NODE_KIND_LABEL[n.kind]}: ${n.label}`}
                  aria-pressed={selected}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={dim ? 0.28 : 1}
                  className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-white"
                  onMouseEnter={() => !large && setHover(k)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => !n.unresolved && onSelect(n)}
                  onDoubleClick={() => onFocus(k)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !n.unresolved) onSelect(n);
                    if (e.key === "f" || e.key === "F") onFocus(k);
                  }}
                >
                  <title>{`${NODE_KIND_LABEL[n.kind]} · ${n.label}${n.sublabel ? `\n${n.sublabel}` : ""}`}</title>
                  <rect
                    width={nodeW}
                    height={nodeH}
                    rx={10}
                    fill={selected ? "#161616" : "#050505"}
                    stroke={selected || focused ? "rgba(255,255,255,0.9)" : n.unresolved ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)"}
                    strokeDasharray={n.unresolved ? "3 3" : undefined}
                    strokeWidth={selected ? 1.3 : 1}
                  />
                  {n.kind === "model" ? <rect x={0} y={10} width={2.5} height={nodeH - 20} rx={1} fill="rgba(255,255,255,0.85)" /> : null}
                  <text x={14} y={21} fill="rgba(255,255,255,0.45)" fontSize={11.5}>
                    {NODE_KIND_LABEL[n.kind]}
                  </text>
                  <text x={nodeW - 24} y={21} fill="rgba(255,255,255,0.3)" fontSize={10.5} textAnchor="end" fontFamily="ui-monospace, monospace">
                    {n.ref.id.length > 8 ? n.ref.id.slice(-6) : n.ref.id}
                  </text>
                  {n.status ? (
                    <circle cx={nodeW - 14} cy={17} r={3} fill={failed ? "rgba(248,113,113,0.85)" : n.status === "running" || n.status === "queued" ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.75)"} />
                  ) : null}
                  <text x={14} y={42} fill={n.unresolved ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.92)"} fontSize={13} fontWeight={500}>
                    {truncate(nodeCaption(n), 32)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
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
        {large ? " · large graph: hover tracing off, use focus" : ""}
      </div>
    </div>
  );
}
