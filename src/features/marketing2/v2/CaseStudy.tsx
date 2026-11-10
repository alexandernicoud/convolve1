import { cn } from "@/lib/utils";
import { backtest, CHAIN } from "../data";
import { ProvenanceTag, Reveal } from "../ui";
import { FACTS } from "./facts";

const SERIES = [
  { key: "s", label: "Model strategy", value: FACTS.totalReturn, stroke: "var(--convolve-chart-accent)", width: 2.4 },
  { key: "spy", label: "SPY", value: FACTS.spy, stroke: "rgba(255,255,255,0.7)", width: 1.5 },
  { key: "und", label: `${FACTS.symbol} buy and hold`, value: FACTS.underlying, stroke: "rgba(255,255,255,0.42)", width: 1.5 },
  { key: "mix", label: "Exposure-matched mix", value: FACTS.exposureMatched, stroke: "rgba(255,255,255,0.28)", width: 1.5, dash: "4 4" },
] as const;

function Equity() {
  const pts = backtest.series;
  const W = 640;
  const H = 280;
  const pad = { l: 44, r: 12, t: 14, b: 26 };
  const vals = pts.flatMap((p) => [p.s, p.spy, p.und, p.mix]);
  const lo = Math.min(...vals) * 0.98;
  const hi = Math.max(...vals) * 1.02;
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = [0.9, 1, 1.2, 1.4].filter((v) => v >= lo && v <= hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Growth of 1 from ${FACTS.period[0]} to ${FACTS.period[1]}: model ${FACTS.totalReturn}, SPY ${FACTS.spy}, ${FACTS.symbol} ${FACTS.underlying}, exposure-matched mix ${FACTS.exposureMatched}.`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 1 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)"} />
          <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)" fontFamily="ui-monospace, monospace">
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {[0, pts.length - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i ? "end" : "start"} fontSize="10" fill="rgba(255,255,255,0.4)" fontFamily="ui-monospace, monospace">
          {pts[i].d}
        </text>
      ))}
      {[...SERIES].reverse().map((s) => (
        <path
          key={s.key}
          d={pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={s.stroke}
          strokeWidth={s.width}
          strokeDasharray={"dash" in s ? s.dash : undefined}
        />
      ))}
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="border-t border-white/[0.08] pt-3">
      <div className="text-[12px] text-white/45">{label}</div>
      <div className={cn("mt-1 font-mono text-[20px] tabular-nums tracking-[-0.01em]", tone === "bad" ? "text-[#e9b0aa]" : "text-white")}>{value}</div>
    </div>
  );
}

const LESSONS = [
  {
    stage: "Training",
    text: `Validation loss was lowest at epoch ${FACTS.bestEpoch} (validation accuracy ${FACTS.bestValAcc}). By epoch ${FACTS.epochsTrained} training accuracy had reached ${FACTS.lastTrainAcc} while validation loss rose to ${FACTS.lastValLoss}: the network was memorising, and early stopping kept the epoch-${FACTS.bestEpoch} weights.`,
  },
  {
    stage: "Lab",
    text: `${FACTS.deadChannels}, and ${FACTS.deadUnits.charAt(0).toLowerCase()}${FACTS.deadUnits.slice(1)}. ${FACTS.separating}`,
  },
  {
    stage: "Backtest",
    text: `At the validation-locked threshold of ${FACTS.threshold}, the model made ${FACTS.trades} trades with a ${FACTS.winRate} win rate. Its probability ranking was not distinguishable from random, and results got worse under higher slippage.`,
  },
];

/** The real MSFT chain, reported as it came out: the model did not find an edge, and the tools showed why. */
export function CaseStudy() {
  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-10">
      <Reveal className="lg:col-span-5">
        <div className="flex flex-wrap gap-2">
          <ProvenanceTag kind="real" detail={`${FACTS.symbol} · model ${CHAIN.modelFingerprint} · backtest ${CHAIN.backtest}`} />
        </div>
        <p className="mt-6 text-[17px] leading-[1.65] text-white/70">
          We labelled {FACTS.charts} {FACTS.symbol} charts with a {FACTS.rule.tp} take-profit and {FACTS.rule.sl} stop-loss over {FACTS.rule.horizon} bars,
          trained a {FACTS.params}-parameter CNN and tested it on {FACTS.testN} charts it had never seen. It lost money. Convolve is built to
          make that visible early, and to show where it went wrong.
        </p>
        <ol className="mt-8 space-y-5">
          {LESSONS.map((l, i) => (
            <li key={l.stage} className="grid grid-cols-[2rem_1fr] gap-3">
              <span className="font-mono text-[12px] text-white/40">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-[14px] font-medium text-white/90">{l.stage}</div>
                <p className="mt-1 text-[14.5px] leading-[1.6] text-white/55">{l.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>
      <Reveal className="lg:col-span-7" delay={0.1}>
        <figure className="rounded-[18px] border border-white/[0.12] bg-[#08090b] p-4 sm:p-6">
          <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[14px] text-white/85">Growth of 1 on the test period, after costs</span>
            <span className="font-mono text-[11px] text-white/40">
              {FACTS.period[0]} → {FACTS.period[1]}
            </span>
          </figcaption>
          <Equity />
          <ul className="mt-4 grid gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-white/60">
                <span className="h-0.5 w-4 shrink-0" style={{ background: s.stroke }} aria-hidden />
                <span className="min-w-0 truncate">{s.label}</span>
                <span className="ml-auto font-mono tabular-nums text-white/85">{s.value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total return" value={FACTS.totalReturn} tone="bad" />
            <Stat label="Max drawdown" value={FACTS.maxDrawdown} />
            <Stat label="Sharpe" value={FACTS.sharpe} tone="bad" />
            <Stat label="Trades" value={FACTS.trades} />
          </div>
        </figure>
        <p className="mt-5 text-[14px] leading-[1.6] text-white/50">
          The next step is not a better chart of the same result. It is a different label rule, more symbols or a smaller network, each run
          as a controlled experiment against this model in Improve.
        </p>
      </Reveal>
    </div>
  );
}
