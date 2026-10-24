import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useInView, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { Cpu, Database, LayoutDashboard, LineChart, Rocket, ScanSearch, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import logoMark from "@/assets/convolve-mark.png";
import { PRODUCT_PIPELINE_ITEMS } from "@/components/products/productPipelineLinks";
import { CHAIN, asset, backtest, fleet, grid, labmaps } from "../data";
import { linePath, scale } from "../ui";

export interface Stage {
  id: string;
  name: string;
  line: string;
  artifact: string;
  icon: LucideIcon;
  href: string;
}

const href = (id: string) => PRODUCT_PIPELINE_ITEMS.find((p) => p.id === id)?.href ?? "/products";

export const STAGES: Stage[] = [
  { id: "generate", name: "Generate", line: "Prices into labelled chart images", artifact: "Dataset", icon: Database, href: href("generate") },
  { id: "train", name: "Train", line: "Fit a CNN, keep the best epoch", artifact: "Model", icon: Cpu, href: href("train") },
  { id: "analyze", name: "Analyze", line: "See what the model attends to", artifact: "Attention maps", icon: ScanSearch, href: href("analyze") },
  { id: "test", name: "Test", line: "Backtest on data it never saw", artifact: "Backtest report", icon: LineChart, href: href("test") },
  { id: "optimize", name: "Optimize", line: "Search label rules", artifact: "Label rule", icon: SlidersHorizontal, href: href("optimize") },
  { id: "deploy", name: "Deploy", line: "Run a model as a paper bot", artifact: "Running bot", icon: Rocket, href: href("deploy") },
  { id: "dashboard", name: "Dashboard", line: "Every run, output and bot, linked", artifact: "One surface", icon: LayoutDashboard, href: href("dashboard") },
];

const HUB = STAGES.length - 1;

export type Region = "nav" | "monitor" | "runs" | "history" | "bots" | "lineage";

/* ------------------------------------------------------------------ dashboard surface */

const DW = 960;
const DH = 600;

/** Renders a fixed 960 × 600 design and scales it to the container, so the mock UI stays crisp at any width. */
function Scaled({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.6);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setK(el.clientWidth / DW);
    const ro = new ResizeObserver(([e]) => setK(e.contentRect.width / DW));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="relative aspect-[16/10] w-full overflow-hidden">
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: DW, height: DH, transform: `scale(${k})` }}>
        {children}
      </div>
    </div>
  );
}

function Panel({ lit, dim, className, left, children }: { lit: boolean; dim: boolean; className?: string; left?: number; children: ReactNode }) {
  return (
    <div
      className={cn(
        "absolute rounded-[10px] border bg-[#0b0c0f] transition-[opacity,border-color,box-shadow] duration-700",
        lit ? "border-white/40" : "border-white/[0.08]",
        className
      )}
      style={{ opacity: dim && !lit ? 0.38 : 1, left }}
    >
      {children}
    </div>
  );
}

const fmtUsd = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}`;
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;

export function DashboardSurface({ stage = null, region = null }: { stage?: number | null; region?: Region | null }) {
  const sid = stage == null ? null : STAGES[stage].id;
  const focused = stage != null || region != null;
  const all = stage === HUB;
  const lit = (stages: string[], r?: Region) => all || (sid != null && stages.includes(sid)) || (r != null && region === r);
  const dim = focused && !all;

  const pnl = useMemo(() => {
    const v = fleet.net_pnl.map((p) => p ?? 0);
    const x = scale(0, v.length - 1, 0, 470);
    const y = scale(Math.min(0, ...v), Math.max(...v), 150, 10);
    const l = linePath(v.map((p, i) => [x(i), y(p)]));
    return { l, area: `${l}L470,150L0,150Z`, last: v[v.length - 1] };
  }, []);
  const eq = useMemo(() => {
    const s = backtest.series;
    const all2 = s.flatMap((r) => [r.s, r.spy]);
    const x = scale(0, s.length - 1, 4, 96);
    const y = scale(Math.min(...all2), Math.max(...all2), 56, 6);
    return { s: linePath(s.map((r, i) => [x(i), y(r.s)])), spy: linePath(s.map((r, i) => [x(i), y(r.spy)])) };
  }, []);
  const running = fleet.bots.filter((b) => b.status === "active").length;
  const sample = labmaps.samples[labmaps.trace_index];

  const research: { stage: string; kind: string; title: string; id: string }[] = [
    { stage: "optimize", kind: "Label search", title: "INTC · 125,000 rules scored", id: "optimizer" },
    { stage: "generate", kind: "Generator", title: `${grid.count.toLocaleString("en-US")} images → dataset ${CHAIN.dataset}`, id: CHAIN.generatorRun },
    { stage: "train", kind: "Training", title: `${CHAIN.modelName} · best epoch 5`, id: CHAIN.trainingRun },
    { stage: "analyze", kind: "Analysis", title: "Grad-CAM, occlusion, representation", id: CHAIN.labSession.replace("lab_", "") },
    { stage: "test", kind: "Backtest", title: `${pct(backtest.metrics.total_return)} net vs. benchmarks`, id: CHAIN.backtest },
  ];
  const chain: [string, string][] = [
    ["optimize", "Label rule"],
    ["generate", "Dataset"],
    ["train", "Model"],
    ["analyze", "Analysis"],
    ["test", "Backtest"],
    ["deploy", "Bot"],
  ];
  const upTo = sid == null ? -1 : all ? 99 : chain.findIndex(([s]) => s === sid);

  return (
    <Scaled>
      <div className="relative h-full w-full bg-[#060709] font-sans text-white">
        {/* sidebar */}
        <div
          className={cn(
            "absolute bottom-0 left-0 top-0 flex w-[60px] flex-col items-center gap-2 border-r py-3 transition-[border-color,opacity] duration-700",
            lit([], "nav") ? "border-white/35" : "border-white/[0.07]"
          )}
          style={{ opacity: dim && !lit([], "nav") && region != null ? 0.38 : 1 }}
        >
          <img src={logoMark} alt="" className="mb-2 h-6 w-6 object-contain" />
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            const on = stage === i || (all && i === HUB);
            return (
              <div
                key={s.id}
                className={cn("flex h-[50px] w-[46px] flex-col items-center justify-center gap-1 rounded-[9px] transition-colors duration-500", on ? "bg-white/[0.1] text-white" : "text-white/40")}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
                <span className="text-[8.5px] uppercase tracking-[0.08em]">{s.name}</span>
              </div>
            );
          })}
        </div>

        {/* top bar */}
        <div className="absolute left-[60px] right-0 top-0 flex h-[44px] items-center gap-3 border-b border-white/[0.07] px-4">
          <span className="text-[14px] font-medium">Overview</span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/45">workspace · MSFT research</span>
          <span className="ml-auto rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/60">Search runs…</span>
          <span className="rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-black">New run</span>
        </div>

        {/* KPIs */}
        {[
          { x: 72, stages: ["deploy"], label: "Bots running", value: String(running), note: "illustrative" },
          { x: 294, stages: ["deploy"], label: "Fleet P&L · 30 d", value: fmtUsd(pnl.last), note: "illustrative" },
          { x: 516, stages: ["test"], label: "Last backtest", value: pct(backtest.metrics.total_return), note: `${CHAIN.backtest} · real` },
          { x: 738, stages: ["generate"], label: "Dataset", value: grid.count.toLocaleString("en-US"), note: `${CHAIN.dataset} · real` },
        ].map((c) => (
          <Panel key={c.label} lit={lit(c.stages, "monitor")} dim={dim} left={c.x} className="top-[54px] h-[72px] w-[210px] px-3 py-2">
            <div className="text-[10px] text-white/45">{c.label}</div>
            <div className="mt-0.5 text-[20px] font-medium tracking-tight tabular-nums">{c.value}</div>
            <div className="font-mono text-[9px] text-white/35">{c.note}</div>
          </Panel>
        ))}

        {/* fleet chart */}
        <Panel lit={lit(["deploy"], "bots")} dim={dim} className="left-[72px] top-[134px] h-[246px] w-[490px] p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-white/50">Fleet net P&L</span>
            <span className="rounded-full border border-dashed border-white/30 px-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-white/55">demo</span>
          </div>
          <svg viewBox="0 0 470 160" className="mt-2 h-[198px] w-full">
            <defs>
              <linearGradient id="m2-ds-a" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.1" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="m2-ds-l" x1="0" x2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.6)" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
            </defs>
            {[40, 80, 120].map((y) => (
              <line key={y} x1="0" x2="470" y1={y} y2={y} stroke="rgba(255,255,255,0.05)" />
            ))}
            <path d={pnl.area} fill="url(#m2-ds-a)" />
            <path d={pnl.l} fill="none" stroke="url(#m2-ds-l)" strokeWidth="1.8" />
          </svg>
        </Panel>

        {/* research runs */}
        <Panel lit={lit(["generate", "train", "analyze", "test", "optimize"], "runs")} dim={dim} className="left-[574px] top-[134px] h-[246px] w-[374px] p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-white/50">Research runs</span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-white/40">recorded</span>
          </div>
          <ul className="mt-1.5 space-y-[3px]">
            {research.map((r) => {
              const on = all || sid === r.stage || region === "runs";
              return (
                <li key={r.kind} className={cn("rounded-[7px] border px-2 py-[3px] transition-colors duration-500", on ? "border-white/25 bg-white/[0.06]" : "border-transparent")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("text-[11.5px]", on ? "text-white" : "text-white/70")}>{r.kind}</span>
                    <span className="truncate font-mono text-[9px] text-white/35">{r.id}</span>
                  </div>
                  <div className="truncate text-[10.5px] text-white/45">{r.title}</div>
                </li>
              );
            })}
          </ul>
        </Panel>

        {/* bots table */}
        <Panel lit={lit(["deploy"], "bots")} dim={dim} className="left-[72px] top-[392px] h-[196px] w-[340px] p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-white/50">Bots</span>
            <span className="rounded-full border border-dashed border-white/30 px-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-white/55">demo</span>
          </div>
          <table className="mt-2 w-full text-[11px]">
            <tbody>
              {fleet.bots.slice(0, 6).map((b) => (
                <tr key={b.name} className="border-t border-white/[0.05]">
                  <td className="py-[4px] text-white/85">{b.name}</td>
                  <td className="py-[4px] font-mono text-[10px] text-white/45">{b.symbol}</td>
                  <td className="py-[4px]">
                    <span className={cn("inline-block h-1.5 w-1.5 rounded-full", b.status === "active" ? "bg-[#9be7b4]" : b.status === "paused" ? "bg-[#e8c27a]" : "bg-[#e88a80]")} />
                  </td>
                  <td className={cn("py-[4px] text-right font-mono tabular-nums", b.ret >= 0 ? "text-white/80" : "text-[#e88a80]")}>{pct(b.ret)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* outputs */}
        <Panel lit={lit(["generate", "analyze", "test"], "history")} dim={dim} className="left-[424px] top-[392px] h-[196px] w-[290px] p-3">
          <span className="text-[11px] text-white/50">Recent outputs</span>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { s: "generate", label: "Chart image", node: <img src={asset(sample.input)} alt="" className="h-full w-full" /> },
              {
                s: "analyze",
                label: "Grad-CAM",
                node: (
                  <>
                    <img src={asset(sample.input)} alt="" className="absolute inset-0 h-full w-full opacity-30" />
                    <img src={asset(sample.gradcam)} alt="" className="absolute inset-0 h-full w-full" />
                  </>
                ),
              },
              {
                s: "test",
                label: "Equity",
                node: (
                  <svg viewBox="0 0 100 62" className="h-full w-full">
                    <path d={eq.spy} fill="none" stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
                    <path d={eq.s} fill="none" stroke="#a6ecc8" strokeWidth="1.5" />
                  </svg>
                ),
              },
            ].map((o) => (
              <div key={o.label}>
                <div
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-[6px] border bg-[#050506] transition-colors duration-500",
                    all || sid === o.s || region === "history" ? "border-white/40" : "border-white/[0.08]"
                  )}
                >
                  {o.node}
                </div>
                <div className="mt-1 text-[9.5px] text-white/45">{o.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 font-mono text-[9.5px] text-white/40">
            <div>dataset {CHAIN.dataset} · {grid.count.toLocaleString("en-US")} images</div>
            <div>backtest {CHAIN.backtest} · threshold {backtest.threshold}</div>
          </div>
        </Panel>

        {/* lineage */}
        <Panel lit={lit([], "lineage") || all} dim={dim} className="left-[726px] top-[392px] h-[196px] w-[222px] p-3">
          <span className="text-[11px] text-white/50">Lineage</span>
          <ol className="relative mt-2 space-y-[6px]">
            <span className="absolute bottom-2 left-[4px] top-2 w-px bg-white/10" aria-hidden />
            {chain.map(([s, label], i) => {
              const on = region === "lineage" || i <= upTo;
              return (
                <li key={s} className="relative flex items-center gap-2.5 pl-0">
                  <span className={cn("relative z-[1] h-[9px] w-[9px] rounded-full border transition-colors duration-500", on ? "border-white bg-white/50" : "border-white/25 bg-[#0b0c0f]")} />
                  <span className={cn("text-[11px] transition-colors duration-500", on ? "text-white" : "text-white/40")}>{label}</span>
                  {s === "deploy" ? <span className="ml-auto font-mono text-[8.5px] text-white/30">demo</span> : null}
                </li>
              );
            })}
          </ol>
        </Panel>

        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.035),transparent_38%)]" />
      </div>
    </Scaled>
  );
}

/* ------------------------------------------------------------------ device frame */

export function Laptop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div className="relative mx-auto w-[90%] rounded-t-[14px] rounded-b-[3px] border border-white/[0.14] bg-[#0d0e11] p-[1.3%] pb-[1.6%] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.95)]">
        <span aria-hidden className="absolute left-1/2 top-[0.5%] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-white/15" />
        <div className="overflow-hidden rounded-[5px] border border-black">{children}</div>
      </div>
      <div className="relative mx-auto h-[12px] w-full rounded-b-[12px] rounded-t-[2px] border-x border-b border-white/[0.08] bg-gradient-to-b from-[#2b2d32] via-[#18191c] to-[#0b0c0e]">
        <span aria-hidden className="absolute left-1/2 top-0 h-[4px] w-[13%] -translate-x-1/2 rounded-b-[5px] bg-[#0b0c0e]" />
      </div>
      <div aria-hidden className="mx-auto h-5 w-[78%] bg-[radial-gradient(closest-side,rgba(0,0,0,0.75),transparent)]" />
    </div>
  );
}

/* ------------------------------------------------------------------ composition */

const ROW = 58;
const GAP = 6;
const LIST_H = STAGES.length * (ROW + GAP) - GAP;

function Connectors({ active }: { active: number }) {
  const W = 90;
  const mid = LIST_H / 2;
  return (
    <svg viewBox={`0 0 ${W} ${LIST_H}`} width={W} height={LIST_H} className="block" aria-hidden>
      <defs>
        <linearGradient id="m2-ps-c" x1="0" x2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <style>{`@keyframes m2psDash{to{stroke-dashoffset:-24}}`}</style>
      {STAGES.map((s, i) => {
        const y = i * (ROW + GAP) + ROW / 2;
        const ey = mid + (i - 3) * 7;
        const on = active === i || active === HUB;
        return (
          <path
            key={s.id}
            d={`M0 ${y} C ${W * 0.55} ${y}, ${W * 0.45} ${ey}, ${W} ${ey}`}
            fill="none"
            stroke={on ? "url(#m2-ps-c)" : "rgba(255,255,255,0.1)"}
            strokeWidth={on ? 1.5 : 1}
            strokeDasharray={on ? "6 6" : undefined}
            style={on ? { animation: "m2psDash 1.6s linear infinite" } : undefined}
            className="transition-[stroke] duration-500"
          />
        );
      })}
      <circle cx={W - 2} cy={mid} r="3" fill="#ffffff" opacity={active >= 0 ? 0.8 : 0.3} />
    </svg>
  );
}

function StageList({ active, onHover, compact = false }: { active: number; onHover: (i: number | null) => void; compact?: boolean }) {
  return (
    <ol className={cn(compact ? "grid grid-cols-2 gap-2 sm:grid-cols-4" : "flex flex-col")} style={compact ? undefined : { gap: GAP }} onMouseLeave={() => onHover(null)}>
      {STAGES.map((s, i) => {
        const Icon = s.icon;
        const on = active === i || (active === HUB && i === HUB);
        const hub = i === HUB;
        return (
          <li key={s.id} className={cn(compact && hub && "col-span-2 sm:col-span-1")}>
            <Link
              to={s.href}
              onMouseEnter={() => onHover(i)}
              onFocus={() => onHover(i)}
              className={cn(
                "group flex items-center gap-3 rounded-[12px] border px-3 transition-[border-color,background-color] duration-500",
                compact ? "py-2.5" : "",
                on ? "border-white/30 bg-white/[0.06]" : "border-white/[0.08] bg-[#08090b] hover:border-white/20",
                hub && "border-dashed"
              )}
              style={compact ? undefined : { height: ROW }}
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border transition-colors duration-500", on ? "border-white/40 text-white" : "border-white/10 text-white/50")}>
                <Icon className="h-4 w-4" strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[9.5px] text-white/30">{String(i + 1).padStart(2, "0")}</span>
                  <span className={cn("text-[14px] transition-colors duration-500", on ? "text-white" : "text-white/75")}>{s.name}</span>
                </span>
                {!compact ? <span className="block truncate text-[11.5px] text-white/40">{s.line}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** Seven stages converging into one dashboard. `scroll`: the page scroll walks the stages; `auto`: cycles while visible. */
export function ProductStack({ mode = "scroll" }: { mode?: "scroll" | "auto" }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [driven, setDriven] = useState(reduce ? HUB : 0);
  const [hover, setHover] = useState<number | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.55"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (mode !== "scroll" || reduce) return;
    setDriven(Math.min(HUB, Math.max(0, Math.floor(v * STAGES.length))));
  });
  const inView = useInView(ref, { margin: "0px 0px -20% 0px" });
  useEffect(() => {
    if (mode !== "auto" || reduce || !inView || hover != null) return;
    const id = window.setInterval(() => setDriven((d) => (d + 1) % STAGES.length), 2600);
    return () => window.clearInterval(id);
  }, [mode, reduce, inView, hover]);
  const active = hover ?? driven;

  return (
    <div ref={ref}>
      <div className="hidden items-center gap-0 lg:grid lg:grid-cols-[minmax(0,300px)_90px_minmax(0,1fr)]">
        <StageList active={active} onHover={setHover} />
        <Connectors active={active} />
        <Laptop>
          <DashboardSurface stage={active} />
        </Laptop>
      </div>
      <div className="space-y-6 lg:hidden">
        <StageList active={active} onHover={setHover} compact />
        <Laptop>
          <DashboardSurface stage={active} />
        </Laptop>
      </div>
      <p className="mt-6 max-w-2xl font-mono text-[10.5px] leading-relaxed text-white/35">
        Illustrative dashboard. Research runs come from the real MSFT run; bots and fleet P&L are simulated.
      </p>
    </div>
  );
}
