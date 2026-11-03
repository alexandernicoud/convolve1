/**
 * Layered layout for the Search Hub lineage graph.
 *
 * Columns are the eight workflow tools; tools that produce an artifact get a run lane and an
 * artifact lane. Within each weakly connected component, nodes are ordered per lane by
 * barycentre sweeps (crossing reduction), then placed vertically by isotonic regression: each
 * node moves as close as possible to the mean height of its neighbours while keeping its order
 * and a minimum gap, so parents end up centred on their children. Linear-ish per sweep, so
 * hundreds of nodes lay out instantly.
 */
import type { ReviewEdge } from "@/lib/api";
import { COLUMNS, PLACE, parseKey, type Graph, type GraphNode, type NodeKind } from "./graph";

export const LAYOUT = { nodeW: 224, nodeH: 58, laneGap: 52, colGap: 112, rowGap: 30, compGap: 64, pad: 40, header: 34 };

export interface Layout {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  /** One entry per workflow column, including empty ones, so the columns are always the same. */
  columns: { index: number; title: string; x: number; width: number; empty: boolean }[];
  /** Vertical trunk x for sources that fan out to several later nodes. */
  fanOut: Map<string, number>;
  /** Vertical trunk x for targets that several earlier nodes feed into. */
  fanIn: Map<string, number>;
}

type Place = { col: number; lane: 0 | 1 };

export function placeOf(n: GraphNode): Place {
  if (n.kind !== "unresolved") return PLACE[n.kind];
  const k = parseKey(n.key).kind;
  if (k === "model") return PLACE.model;
  if (k === "dataset") return PLACE.dataset;
  if (k === "bot") return PLACE.bot;
  return PLACE.unresolved;
}

const laneIndex = (p: Place) => p.col * 2 + p.lane;

/** Least-squares nondecreasing fit with a minimum spacing between consecutive values. */
export function spacedFit(desired: number[], gap: number): number[] {
  const a = desired.map((d, i) => d - i * gap);
  const blocks: { sum: number; n: number }[] = [];
  for (const v of a) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sum / prev.n <= last.sum / last.n) break;
      blocks.pop();
      prev.sum += last.sum;
      prev.n += last.n;
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let j = 0; j < b.n; j++) out.push(b.sum / b.n);
  return out.map((v, i) => v + i * gap);
}

function weakComponents(keys: string[], adj: Map<string, string[]>): string[][] {
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const start of keys) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      for (const n of adj.get(k) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

export function layoutGraph(g: Pick<Graph, "nodes" | "edges">, keys: Set<string>): Layout {
  const { nodeW, nodeH, laneGap, colGap, rowGap, compGap, pad, header } = LAYOUT;
  const S = nodeH + rowGap;
  const list = [...keys].filter((k) => g.nodes.has(k));
  const lane = new Map(list.map((k) => [k, laneIndex(placeOf(g.nodes.get(k)!))]));
  const edges = g.edges.filter((e) => keys.has(e.source) && keys.has(e.target) && e.source !== e.target);

  const pred = new Map<string, string[]>();
  const succ = new Map<string, string[]>();
  const adj = new Map<string, string[]>();
  const push = <K,>(m: Map<K, string[]>, k: K, v: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  for (const e of edges) {
    const forward = lane.get(e.target)! > lane.get(e.source)!;
    push(forward ? succ : pred, e.source, e.target);
    push(forward ? pred : succ, e.target, e.source);
    push(adj, e.source, e.target);
    push(adj, e.target, e.source);
  }

  // ---- columns and lane x positions (all eight columns, empty ones keep one lane)
  const usedLanes = new Set(lane.values());
  const laneX = new Map<number, number>();
  const columns: Layout["columns"] = [];
  let x = pad;
  COLUMNS.forEach((title, col) => {
    const lanes = [col * 2, col * 2 + 1].filter((l) => usedLanes.has(l));
    const n = Math.max(1, lanes.length);
    const width = n * nodeW + (n - 1) * laneGap;
    lanes.forEach((l, i) => laneX.set(l, x + i * (nodeW + laneGap)));
    columns.push({ index: col, title, x, width, empty: lanes.length === 0 });
    x += width + colGap;
  });
  const width = x - colGap + pad;

  // ---- components: linked ones first (largest, then most recent); all single nodes share one block
  const ts = (k: string) => g.nodes.get(k)?.ts ?? 0;
  const comps = weakComponents(list, adj);
  const linked = comps.filter((c) => c.length > 1).sort((a, b) => b.length - a.length || Math.max(...b.map(ts)) - Math.max(...a.map(ts)));
  const singles = comps.filter((c) => c.length === 1).flat();
  const blocks = singles.length ? [...linked, singles] : linked;

  const pos = new Map<string, { x: number; y: number }>();
  let top = pad + header;
  for (const block of blocks) {
    const byLane = new Map<number, string[]>();
    for (const k of block) push(byLane, lane.get(k)!, k);
    const lanes = [...byLane.keys()].sort((a, b) => a - b);
    const order = new Map<string, number>();
    const mean = (ns: string[] | undefined, f: (k: string) => number | undefined) => {
      const v = (ns ?? []).map(f).filter((n): n is number => n != null);
      return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
    };

    // initial order: newest first, then barycentre of already-placed predecessors
    for (const l of lanes) {
      const col = byLane.get(l)!;
      col.sort((a, b) => ts(b) - ts(a));
      const key = (k: string) => mean(pred.get(k), (p) => order.get(p)) ?? Number.MAX_SAFE_INTEGER;
      col.sort((a, b) => key(a) - key(b));
      col.forEach((k, i) => order.set(k, i));
    }
    // crossing reduction: alternate down (predecessors) and up (successors) sweeps
    for (let it = 0; it < 8; it++) {
      const down = it % 2 === 0;
      for (const l of down ? lanes : [...lanes].reverse()) {
        const col = byLane.get(l)!;
        const key = new Map(col.map((k) => [k, mean(down ? pred.get(k) : succ.get(k), (p) => order.get(p)) ?? order.get(k)!]));
        col.sort((a, b) => key.get(a)! - key.get(b)! || order.get(a)! - order.get(b)!);
        col.forEach((k, i) => order.set(k, i));
      }
    }

    // vertical placement: pull towards neighbours, keep order and spacing
    const y = new Map<string, number>();
    for (const l of lanes) byLane.get(l)!.forEach((k, i) => y.set(k, i * S));
    const center = (k: string) => y.get(k)! + nodeH / 2;
    for (let it = 0; it < 14; it++) {
      const mode = it < 10 ? (it % 2 === 0 ? "down" : "up") : it % 2 === 0 ? "both" : "up";
      for (const l of mode === "down" ? lanes : [...lanes].reverse()) {
        const col = byLane.get(l)!;
        const desired = col.map((k) => {
          const ns = mode === "down" ? pred.get(k) : mode === "up" ? succ.get(k) : [...(pred.get(k) ?? []), ...(succ.get(k) ?? [])];
          const m = mean(ns, center);
          return m == null ? y.get(k)! : m - nodeH / 2;
        });
        spacedFit(desired, S).forEach((v, i) => y.set(col[i], v));
      }
    }
    const minY = Math.min(...block.map((k) => y.get(k)!));
    let maxY = 0;
    for (const k of block) {
      const yy = top + y.get(k)! - minY;
      pos.set(k, { x: laneX.get(lane.get(k)!)!, y: yy });
      maxY = Math.max(maxY, yy + nodeH);
    }
    top = maxY + compGap;
  }

  // ---- trunks: a source fanning out (or target fanning in) gets its own vertical spine
  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();
  const bySourceLane = new Map<number, string[]>();
  const byTargetLane = new Map<number, string[]>();
  for (const k of list) {
    if ((succ.get(k)?.length ?? 0) > 1) push(bySourceLane, lane.get(k)!, k);
    const ins = (pred.get(k) ?? []).length;
    if (ins > 1) push(byTargetLane, lane.get(k)!, k);
  }
  for (const ks of bySourceLane.values()) {
    ks.sort((a, b) => pos.get(a)!.y - pos.get(b)!.y).forEach((k, i) => fanOut.set(k, pos.get(k)!.x + nodeW + 16 + (i % 4) * 8));
  }
  for (const ks of byTargetLane.values()) {
    ks.sort((a, b) => pos.get(a)!.y - pos.get(b)!.y).forEach((k, i) => fanIn.set(k, pos.get(k)!.x - 16 - (i % 4) * 8));
  }

  return { pos, width, height: Math.max(top - compGap + pad, pad * 2 + header + nodeH), columns, fanOut, fanIn };
}

/** SVG path for one edge: orthogonal with rounded corners along a trunk, otherwise a smooth curve. */
export function edgePath(e: ReviewEdge, l: Layout): string | null {
  const { nodeW, nodeH } = LAYOUT;
  const a = l.pos.get(e.source);
  const b = l.pos.get(e.target);
  if (!a || !b) return null;
  if (b.x <= a.x) {
    const x1 = a.x + nodeW / 2;
    const y1 = a.y + nodeH;
    const x2 = b.x + nodeW / 2;
    const y2 = b.y - 2;
    return `M${x1},${y1} C${x1},${y1 + 40} ${x2},${y2 - 40} ${x2},${y2}`;
  }
  const x1 = a.x + nodeW;
  const y1 = a.y + nodeH / 2;
  const x2 = b.x - 2;
  const y2 = b.y + nodeH / 2;
  const trunk = l.fanOut.get(e.source) ?? l.fanIn.get(e.target);
  if (trunk == null || Math.abs(y2 - y1) < 1) {
    if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} H${x2}`;
    const dx = Math.min(80, Math.max(30, (x2 - x1) / 2));
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  const r = Math.min(10, Math.abs(y2 - y1) / 2);
  const s = y2 > y1 ? 1 : -1;
  return `M${x1},${y1} H${trunk - r} Q${trunk},${y1} ${trunk},${y1 + s * r} V${y2 - s * r} Q${trunk},${y2} ${trunk + r},${y2} H${x2}`;
}

export function columnOf(kind: NodeKind): string {
  return COLUMNS[PLACE[kind].col];
}
