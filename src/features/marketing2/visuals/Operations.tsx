import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAIN, backtest, fleet, grid, training } from "../data";
import { EASE, ProvenanceTag, linePath, scale } from "../ui";

/* ------------------------------------------------------------------ demo fleet */

type Status = "running" | "paused" | "stopped" | "error";

const STATUS_STYLE: Record<Status, { dot: string; text: string }> = {
  running: { dot: "bg-[#9be7b4]", text: "text-[#9be7b4]" },
  paused: { dot: "bg-[#e8c27a]", text: "text-[#e8c27a]" },
  stopped: { dot: "bg-white/35", text: "text-white/45" },
  error: { dot: "bg-[#e88a80]", text: "text-[#e88a80]" },
};

const TIMEFRAMES = ["1D", "4H", "1D", "1H", "1D", "4H", "1H", "1D", "1D", "1W", "4H", "1D"];
const SCHEDULES: Record<string, string> = {
  "1H": "Hourly, market hours",
  "4H": "Every 4 hours",
  "1D": "Daily at 15:45 ET",
  "1W": "Fridays at 15:45 ET",
};

function rng(seed: number) {
  let a = seed + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Bot {
  name: string;
  symbol: string;
  tf: string;
  model: string;
  realModel: boolean;
  status: Status;
  ret: number;
  spark: number[];
  schedule: string;
  threshold: number;
  maxDd: number;
  trades: number;
  log: { t: string; action: "BUY" | "SELL" | "HOLD" | "SKIP"; p: number }[];
}

const BOTS: Bot[] = fleet.bots.map((b, i) => {
  const r = rng(i + 7);
  const tf = TIMEFRAMES[i % TIMEFRAMES.length];
  const real = b.symbol === "MSFT";
  const status: Status = b.name === "JPM carry" ? "stopped" : b.status === "active" ? "running" : b.status === "paused" ? "paused" : "error";
  const known = b.spark.filter((v): v is number => v != null);
  const spark = known.length > 1 ? known : [0, 0];
  const span = spark[spark.length - 1] - spark[0] || 1;
  let peak = -Infinity;
  let dd = 0;
  for (const v of spark) {
    const eq = 1 + ((v - spark[0]) / span) * b.ret;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, (peak - eq) / peak);
  }
  const threshold = real ? backtest.threshold : Math.round((0.45 + r() * 0.2) * 100) / 100;
  let holding = false;
  const log = fleet.t
    .slice(-6)
    .reverse()
    .map((t) => {
      const p = Math.round((0.25 + r() * 0.55) * 100) / 100;
      let action: Bot["log"][number]["action"];
      if (p >= threshold) action = holding ? "HOLD" : "BUY";
      else action = holding ? "SELL" : "SKIP";
      holding = action === "BUY" || action === "HOLD";
      return { t, action, p };
    });
  return {
    name: b.name,
    symbol: b.symbol,
    tf,
    model: real ? CHAIN.modelName.replace(".keras", "") : `${b.symbol.split(/[.-]/)[0]}-${tf.toLowerCase()}-v${1 + Math.floor(r() * 4)}`,
    realModel: real,
    status,
    ret: b.ret,
    spark,
    schedule: SCHEDULES[tf],
    threshold,
    maxDd: dd,
    trades: 6 + Math.floor(r() * 30),
    log,
  };
});

const COUNTS = BOTS.reduce<Record<Status, number>>((a, b) => ({ ...a, [b.status]: a[b.status] + 1 }), { running: 0, paused: 0, stopped: 0, error: 0 });

const fmtT = (iso: string) =>
  new Date(`${iso}:00Z`).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;

function Spark({ v, w = 84, h = 22, strong = false }: { v: number[]; w?: number; h?: number; strong?: boolean }) {
  const d = useMemo(() => {
    const x = scale(0, v.length - 1, 1, w - 1);
    const y = scale(Math.min(...v), Math.max(...v), h - 2, 2);
    return linePath(v.map((p, i) => [x(i), y(p)]));
  }, [v, w, h]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full" aria-hidden>
      <path d={d} fill="none" stroke={strong ? "#fff" : "rgba(255,255,255,0.55)"} strokeWidth={strong ? 1.5 : 1.1} />
    </svg>
  );
}

function FleetChart({ bot }: { bot: Bot }) {
  const W = 640;
  const H = 150;
  const d = useMemo(() => {
    const v = fleet.net_pnl.map((p) => p ?? 0);
    const x = scale(0, v.length - 1, 0, W);
    const y = scale(Math.min(0, ...v), Math.max(...v), H - 14, 8);
    const line = linePath(v.map((p, i) => [x(i), y(p)]));
    return { line, area: `${line}L${W},${H - 14}L0,${H - 14}Z`, last: v[v.length - 1], zero: y(0) };
  }, []);
  const sel = useMemo(() => {
    const v = bot.spark;
    const x = scale(0, v.length - 1, 0, W);
    const y = scale(Math.min(...v), Math.max(...v), H - 20, 20);
    return linePath(v.map((p, i) => [x(i), y(p)]));
  }, [bot]);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] text-white/40">Fleet net P&L · 30 days</div>
          <div className="text-[22px] font-medium tracking-tight text-white tabular-nums">+${d.last.toFixed(0)}</div>
        </div>
        <div className="flex gap-3 font-mono text-[9.5px] text-white/40">
          <span>— fleet</span>
          <span className="text-[#b9d3ff]">— {bot.name}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block h-auto w-full" role="img" aria-label="Demo fleet net profit and the selected bot's equity shape">
        <defs>
          <linearGradient id="m2-ops-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={d.zero} y2={d.zero} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 4" />
        <path d={d.area} fill="url(#m2-ops-area)" />
        <path d={d.line} fill="none" stroke="#fff" strokeWidth="1.5" />
        <AnimatePresence mode="wait">
          <motion.path key={bot.name} d={sel} fill="none" stroke="#b9d3ff" strokeWidth="1.3" strokeDasharray="4 3" initial={{ opacity: 0 }} animate={{ opacity: 0.9 }} exit={{ opacity: 0 }} />
        </AnimatePresence>
        <text x="0" y={H - 2} fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="ui-monospace, monospace">
          {fmtT(fleet.t[0])}
        </text>
        <text x={W} y={H - 2} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="ui-monospace, monospace">
          {fmtT(fleet.t[fleet.t.length - 1])}
        </text>
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------------- lineage */

interface ChainNode {
  kind: string;
  title: string;
  id: string;
  real: boolean;
}

function chainFor(bot: Bot): ChainNode[] {
  if (bot.realModel) {
    return [
      { kind: "Label rule", title: `+${grid.tp * 100}% / −${grid.sl * 100}% / ${grid.horizon} bars`, id: "entered manually", real: true },
      { kind: "Dataset", title: `${grid.count.toLocaleString("en-US")} chart images`, id: CHAIN.dataset, real: true },
      { kind: "Model", title: CHAIN.modelName, id: CHAIN.trainingRun, real: true },
      { kind: "Analysis", title: "Interpretability lab", id: CHAIN.labSession.replace("lab_", ""), real: true },
      { kind: "Backtest", title: `${pct(backtest.metrics.total_return)} net · ${training.symbol}`, id: CHAIN.backtest, real: true },
      { kind: "Bot", title: bot.name, id: "demo paper bot", real: false },
    ];
  }
  return [
    { kind: "Label rule", title: `${bot.symbol} rule`, id: "demo", real: false },
    { kind: "Dataset", title: `${bot.symbol} · ${bot.tf} images`, id: "demo", real: false },
    { kind: "Model", title: bot.model, id: "demo", real: false },
    { kind: "Analysis", title: "Interpretability lab", id: "demo", real: false },
    { kind: "Backtest", title: `${bot.symbol} backtest`, id: "demo", real: false },
    { kind: "Bot", title: bot.name, id: "demo paper bot", real: false },
  ];
}

function Lineage({ bot }: { bot: Bot }) {
  const reduce = useReducedMotion();
  const [focus, setFocus] = useState<number | null>(null);
  const nodes = chainFor(bot);
  const lit = (i: number) => focus == null || i <= focus;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          Lineage of <span className="text-white/80">{bot.name}</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[9.5px] text-white/40">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[3px] border border-white/50" /> recorded run
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[3px] border border-dashed border-white/40" /> demo
          </span>
        </div>
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 lg:gap-0" onMouseLeave={() => setFocus(null)}>
        {nodes.map((n, i) => (
          <li key={`${bot.name}-${n.kind}`} className="relative lg:pr-4">
            <motion.button
              type="button"
              onMouseEnter={() => setFocus(i)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: lit(i) ? 1 : 0.35, y: 0 }}
              transition={{ duration: 0.35, ease: EASE, delay: reduce ? 0 : i * 0.05 }}
              className={cn(
                "w-full rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                n.real ? "border-white/25 bg-white/[0.04]" : "border-dashed border-white/25",
                focus === i && "border-white/70 bg-white/[0.07]"
              )}
            >
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/40">{n.kind}</div>
              <div className="mt-1 truncate text-[12.5px] text-white">{n.title}</div>
              <div className="mt-0.5 truncate font-mono text-[9.5px] text-white/40">{n.id}</div>
            </motion.button>
            {i < nodes.length - 1 ? (
              <ArrowRight className={cn("absolute right-0 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 transition-colors lg:block", lit(i + 1) ? "text-white/55" : "text-white/15")} aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11.5px] text-white/40">
        {bot.realModel
          ? "Hover a step to see its ancestry. Everything up to the backtest is a recorded local run; the bot itself is a demo."
          : "Demo bot: its chain is illustrative. Select MSFT breakout to see a chain of recorded runs."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- dashboard */

export function Operations() {
  const [sel, setSel] = useState(0);
  const bot = BOTS[sel];
  return (
    <div className="space-y-6">
      <div className="rounded-[18px] border border-white/[0.09] bg-[#08090b] p-4 sm:p-5">
        <Lineage bot={bot} />
      </div>

      <div className="overflow-hidden rounded-[18px] border border-white/[0.09] bg-[#08090b]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/[0.07] px-4 py-3 sm:px-5">
          <span className="text-[13px] font-medium text-white">Deploy · Bot operations</span>
          <span className="rounded-full border border-dashed border-white/40 px-2.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/75">
            Demo data · simulated paper bots
          </span>
          <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-white/55">
            {(Object.keys(COUNTS) as Status[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_STYLE[k].dot)} />
                {COUNTS[k]} {k}
              </span>
            ))}
            <span className="text-white/35">
              24 h: {fleet.runs_24h.ok} runs · {fleet.runs_24h.error} errors
            </span>
          </div>
        </div>

        <div className="grid lg:grid-cols-12">
          <div className="min-w-0 border-white/[0.07] p-4 sm:p-5 lg:col-span-8 lg:border-r">
            <FleetChart bot={bot} />
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left sm:min-w-[620px] text-[12px]">
                <thead>
                  <tr className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/35">
                    <th className="pb-2 font-normal">Bot</th>
                    <th className="pb-2 font-normal">Asset</th>
                    <th className="hidden pb-2 font-normal sm:table-cell">Model</th>
                    <th className="pb-2 font-normal">Status</th>
                    <th className="pb-2 text-right font-normal">30 d</th>
                    <th className="hidden w-[96px] pb-2 pl-4 font-normal sm:table-cell">Equity</th>
                  </tr>
                </thead>
                <tbody>
                  {BOTS.map((b, i) => (
                    <tr
                      key={b.name}
                      onClick={() => setSel(i)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(i)}
                      tabIndex={0}
                      aria-selected={i === sel}
                      className={cn(
                        "cursor-pointer border-t border-white/[0.05] transition-colors focus:outline-none focus-visible:bg-white/[0.06]",
                        i === sel ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                      )}
                    >
                      <td className="py-2 pl-1 text-white">{b.name}</td>
                      <td className="py-2 font-mono text-[11px] text-white/60">
                        {b.symbol} · {b.tf}
                      </td>
                      <td className="hidden py-2 font-mono text-[11px] text-white/60 sm:table-cell">
                        {b.model}
                        {b.realModel ? <span className="ml-1.5 rounded bg-white/10 px-1 text-[9px] text-white/70">real model</span> : null}
                      </td>
                      <td className={cn("py-2 text-[11.5px]", STATUS_STYLE[b.status].text)}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_STYLE[b.status].dot)} />
                          {b.status}
                        </span>
                      </td>
                      <td className={cn("py-2 text-right font-mono tabular-nums", b.ret >= 0 ? "text-white/85" : "text-[#e88a80]")}>{pct(b.ret)}</td>
                      <td className="hidden py-2 pl-4 sm:table-cell">
                        <Spark v={b.spark} strong={i === sel} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="min-w-0 p-4 sm:p-5 lg:col-span-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={bot.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[17px] font-medium text-white">{bot.name}</div>
                    <div className="font-mono text-[10.5px] text-white/45">
                      {bot.symbol} · {bot.tf} · {bot.model}
                    </div>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[11px]", STATUS_STYLE[bot.status].text)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_STYLE[bot.status].dot)} />
                    {bot.status}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-white/[0.07] py-3">
                  {[
                    ["Return", pct(bot.ret)],
                    ["Max DD", `−${(bot.maxDd * 100).toFixed(1)}%`],
                    ["Trades", String(bot.trades)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[10.5px] text-white/40">{k}</dt>
                      <dd className="text-[15px] font-medium text-white tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>

                <dl className="mt-3 space-y-1.5 text-[12px]">
                  {[
                    ["Schedule", bot.schedule],
                    ["Entry threshold", `p ≥ ${bot.threshold.toFixed(2)}`],
                    ["Wallet", "Paper · no brokerage"],
                    ["Monitoring", bot.status === "error" ? "Data feed failed · retrying" : bot.status === "running" ? "Healthy · last run on time" : "Not scheduled"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-white/40">{k}</dt>
                      <dd className={cn("text-right text-white/80", k === "Monitoring" && bot.status === "error" && "text-[#e88a80]")}>{v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/35">Execution history</div>
                <ul className="mt-1.5 divide-y divide-white/[0.05] font-mono text-[11px]">
                  {bot.log.map((l) => (
                    <li key={l.t} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-white/40">{fmtT(l.t)}</span>
                      <span className="text-white/50">p {l.p.toFixed(2)}</span>
                      <span
                        className={cn(
                          "w-11 rounded px-1 text-center text-[10px]",
                          l.action === "BUY" ? "bg-[#9be7b4]/15 text-[#9be7b4]" : l.action === "SELL" ? "bg-[#e88a80]/15 text-[#e88a80]" : "text-white/40"
                        )}
                      >
                        {l.action}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <ProvenanceTag kind="illustrative" detail="Bots, P&L and executions are simulated demo data. The model and backtest in the MSFT chain are real." />
    </div>
  );
}
