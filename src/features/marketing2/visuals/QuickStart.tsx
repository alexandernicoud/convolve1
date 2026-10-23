import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { estimateMinTrainingPhaseDaysForCharts } from "@/lib/generatorDates";
import { Kicker } from "../ui";

type Tf = "1d" | "1wk";
const PICKS = ["MSFT", "NVDA", "AAPL", "SPY"];
const MONTHS = [3, 6, 12];
const STEPS = ["Generate", "Train", "Analyse", "Backtest", "Deploy"];

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-full border border-white/[0.12] bg-black/30 p-1" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cn("rounded-full px-4 py-1.5 text-[13.5px] transition-colors", v === value ? "bg-white text-black" : "text-white/60 hover:text-white")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-3">{children}</div>
      <p className="mt-2 text-[12.5px] text-white/35">{hint}</p>
    </div>
  );
}

/** Pick a symbol, timeframe, window and chart count; the Generator opens with them filled in. */
export function QuickStart() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState("MSFT");
  const [tf, setTf] = useState<Tf>("1d");
  const [months, setMonths] = useState(6);
  const [charts, setCharts] = useState(1000);
  const [lit, setLit] = useState(-1);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  const sym = symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  const days = estimateMinTrainingPhaseDaysForCharts(charts, tf);
  const years = days / 365;
  const images = charts * 2;
  const train = Math.round(images * 0.8);
  const href = `/tools/generator?${new URLSearchParams({ symbols: sym, tf, months: String(months), charts: String(charts) })}`;

  const start = () => {
    if (!sym || lit >= 0) return;
    if (reduce) {
      navigate(href);
      return;
    }
    let i = 0;
    setLit(0);
    const tick = () => {
      i += 1;
      if (i < STEPS.length) {
        setLit(i);
        timer.current = window.setTimeout(tick, 260);
      } else timer.current = window.setTimeout(() => navigate(href), 420);
    };
    timer.current = window.setTimeout(tick, 260);
  };

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#08090b] p-6 sm:p-10 lg:p-14">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]"
        style={{
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
          padding: "1px",
        }}
      >
        <div
          className="absolute left-[-25%] top-1/2 -mt-[75%] aspect-square w-[150%] motion-safe:animate-[spin_10s_linear_infinite]"
          style={{ background: "conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.35) 40deg, rgba(255,255,255,0.15) 80deg, transparent 130deg, transparent 360deg)" }}
        />
      </div>

      <div className="relative grid gap-12 lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-7">
          <Kicker>Quick start</Kicker>
          <h2 className="mt-6 text-[clamp(1.9rem,2.7vw,3rem)] font-normal leading-[1.08] tracking-[-0.032em] text-white">
            Start engineering
            <br />
            <span className="text-white/45">right on the spot.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16.5px] leading-relaxed text-white/55">
            Pick a symbol, a window and how many charts you want. The Generator opens with them filled in.
          </p>

          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <Field label="Symbol" hint="Any ticker your data source covers.">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g. NVDA"
                aria-label="Symbol"
                className="w-full rounded-xl border border-white/[0.14] bg-black/40 px-4 py-3 font-mono text-[17px] uppercase tracking-wide text-white outline-none transition-colors placeholder:normal-case placeholder:text-white/30 focus:border-white/40"
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {PICKS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSymbol(s)}
                    className={cn("rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors", sym === s ? "border-white/60 text-white" : "border-white/[0.1] text-white/45 hover:text-white")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Charts per label" hint="Twice this many images in total.">
              <div className="flex items-baseline gap-3">
                <span className="w-[5ch] text-[28px] font-extralight tabular-nums text-white">{charts.toLocaleString("en-US")}</span>
              </div>
              <input
                type="range"
                min={200}
                max={5000}
                step={100}
                value={charts}
                onChange={(e) => setCharts(Number(e.target.value))}
                aria-label="Charts per label"
                className="mt-2 w-full accent-white"
              />
            </Field>
            <Field label="Bars" hint="Daily or weekly candles.">
              <Segmented<Tf> label="Timeframe" value={tf} onChange={setTf} options={[["1d", "Daily"], ["1wk", "Weekly"]]} />
            </Field>
            <Field label="Window per chart" hint="How much history each image shows.">
              <Segmented<number> label="Window" value={months} onChange={setMonths} options={MONTHS.map((m) => [m, `${m} mo`])} />
            </Field>
          </div>
        </div>

        <div className="flex flex-col lg:col-span-5">
          <div className="flex-1 rounded-[20px] border border-white/[0.09] bg-black/40 p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/40">
              <span>Run plan</span>
              <span className="normal-case tracking-normal text-white/30">estimate</span>
            </div>
            <div className="mt-5 text-[clamp(1.8rem,2.4vw,2.4rem)] font-light tracking-[-0.03em] text-white">
              {sym || "—"}
              <span className="text-white/35"> · {tf === "1d" ? "1D" : "1W"} · {months} mo</span>
            </div>
            <dl className="mt-6 divide-y divide-white/[0.07] border-y border-white/[0.07] text-[14px]">
              {[
                ["Chart images", `up to ${images.toLocaleString("en-US")} · 224 × 224`],
                ["Train / validation", `≈ ${train.toLocaleString("en-US")} / ${(images - train).toLocaleString("en-US")}`],
                ["History needed", `≈ ${years >= 1 ? `${years.toFixed(1)} years` : `${days} days`}`],
                ["Default label rule", "+2% before −1% within 7 bars"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-white/45">{k}</dt>
                  <dd className="text-right tabular-nums text-white/85">{v}</dd>
                </div>
              ))}
            </dl>
            <ol className="mt-6 flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <li key={s} className="flex flex-1 flex-col items-center gap-2">
                  <span
                    className={cn(
                      "h-1 w-full rounded-full transition-colors duration-300",
                      lit >= i ? "bg-white/70" : "bg-white/[0.1]"
                    )}
                  />
                  <span className={cn("font-mono text-[10px] transition-colors duration-300", lit >= i ? "text-white" : "text-white/35")}>{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <button
            type="button"
            onClick={start}
            disabled={!sym}
            className="group relative mt-5 inline-flex w-full items-center justify-center gap-3 overflow-hidden rounded-full bg-white px-8 py-4 text-[16px] font-medium text-black transition-[background-color,transform,opacity] hover:bg-white/90 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
          >
            {lit >= 0 ? "Opening the Generator…" : "Start engineering"}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </button>
          <p className="mt-3 text-center font-mono text-[10.5px] text-white/30">Nothing runs until you press Generate in the app.</p>
        </div>
      </div>
    </div>
  );
}
