import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { labelingOptimizerApi } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { confirmRun, chargeRunCredits } from "@/state/creditsStore";
import { RunCost, RunCostHint } from "@/components/RunCostHint";
import { Slider } from "@/components/ui/slider";
import FieldTip from "@/components/generator/FieldTip";
import StepSection from "@/components/generator/StepSection";
import SymbolBasket from "@/components/generator/SymbolBasket";
import TestPeriodTimeline from "@/components/generator/TestPeriodTimeline";
import { isoDateString, parseIsoDate, startOfLocalDay } from "@/lib/generatorDates";

const formSchema = z
  .object({
    symbol: z.string().min(1, "Symbol is required").toUpperCase(),
    start: z.string().min(1, "Start date is required"),
    end: z.string().min(1, "End date is required"),
    timeframe: z.enum(["1d", "1wk", "1mo"]),
    tp_min_pct: z.coerce.number().min(0).max(50),
    tp_max_pct: z.coerce.number().min(0).max(50),
    sl_min_pct: z.coerce.number().min(0).max(50),
    sl_max_pct: z.coerce.number().min(0).max(50),
    horizon_min: z.coerce.number().int().min(1).max(500),
    horizon_max: z.coerce.number().int().min(1).max(500),
    min_trades: z.coerce.number().int().min(1).max(5000),
    grid_tp_steps: z.coerce.number().int().min(5).max(80),
    grid_sl_steps: z.coerce.number().int().min(5).max(80),
    fee_rate_pct: z.coerce.number().min(0).max(1),
    objective: z.enum(["max_cagr", "max_sharpe", "max_winrate", "min_drawdown"]),
    reserve_eval: z.boolean(),
    selection_end: z.string(),
  })
  .refine(
    (data) => {
      const startDate = new Date(data.start);
      const endDate = new Date(data.end);
      return startDate < endDate;
    },
    { message: "Start date must be before end date", path: ["end"] },
  )
  .refine((data) => data.tp_min_pct < data.tp_max_pct, {
    message: "TP min must be less than TP max",
    path: ["tp_max_pct"],
  })
  .refine((data) => data.sl_min_pct < data.sl_max_pct, {
    message: "SL min must be less than SL max",
    path: ["sl_max_pct"],
  })
  .refine((data) => data.horizon_min <= data.horizon_max, {
    message: "Horizon min cannot exceed max",
    path: ["horizon_max"],
  })
  .refine((data) => !data.reserve_eval || researchEndProblem(data.start, data.end, data.selection_end) == null, (data) => ({
    message: researchEndProblem(data.start, data.end, data.selection_end) ?? "",
    path: ["selection_end"],
  }));

/** Same limits as the API (LO_MIN_RESEARCH_DAYS / LO_MIN_EVALUATION_DAYS). */
const MIN_RESEARCH_DAYS = 365;
const MIN_EVALUATION_DAYS = 60;

function researchEndProblem(start: string, end: string, sel: string): string | null {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  const r = parseIsoDate(sel);
  if (!s || !e || !r) return "Pick the last day of the research period";
  const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
  if (days(s, r) < MIN_RESEARCH_DAYS) return `The research period needs at least ${MIN_RESEARCH_DAYS} days`;
  if (days(r, e) < MIN_EVALUATION_DAYS) return `Leave at least ${MIN_EVALUATION_DAYS} days after it for evaluation`;
  return null;
}

function defaultResearchEnd(start: string, end: string): string {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (!s || !e) return end;
  return isoDateString(new Date(s.getTime() + (e.getTime() - s.getTime()) * 0.8));
}

type FormData = z.infer<typeof formSchema>;

const rangeSliderClass =
  "w-full py-1 [&_[data-orientation=horizontal]]:w-full [&_.bg-primary]:bg-white [&_[role=slider]]:border-white/40 [&_[role=slider]]:bg-[#0a0a0a]";

function defaultYesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDateString(d);
}

function defaultFiveYearsAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return isoDateString(d);
}

export default function LabelingOptimizerTechnical() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["INTC"]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      symbol: "INTC",
      start: defaultFiveYearsAgoIso(),
      end: defaultYesterdayIso(),
      timeframe: "1d",
      tp_min_pct: 1,
      tp_max_pct: 25,
      sl_min_pct: 1,
      sl_max_pct: 15,
      horizon_min: 1,
      horizon_max: 200,
      min_trades: 50,
      grid_tp_steps: 25,
      grid_sl_steps: 25,
      fee_rate_pct: 0.1,
      objective: "max_cagr",
      reserve_eval: false,
      selection_end: "",
    },
  });

  const tpMin = watch("tp_min_pct");
  const tpMax = watch("tp_max_pct");
  const slMin = watch("sl_min_pct");
  const slMax = watch("sl_max_pct");
  const startIso = watch("start");
  const endIso = watch("end");
  const reserveEval = watch("reserve_eval");
  const selectionEnd = watch("selection_end");
  const todayIsoMax = useMemo(() => isoDateString(startOfLocalDay(new Date())), []);

  const pricingParams = useMemo(() => ({ start: startIso, end: endIso }), [startIso, endIso]);

  const onSubmit = async (data: FormData) => {
    if (!(await confirmRun("labeling-optimizer", { start: data.start, end: data.end }))) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await labelingOptimizerApi.startRun({
        symbol: data.symbol,
        start: data.start,
        end: data.end,
        timeframe: data.timeframe,
        tp_min_pct: data.tp_min_pct,
        tp_max_pct: data.tp_max_pct,
        sl_min_pct: data.sl_min_pct,
        sl_max_pct: data.sl_max_pct,
        horizon_min: data.horizon_min,
        horizon_max: data.horizon_max,
        min_trades: data.min_trades,
        grid_tp_steps: data.grid_tp_steps,
        grid_sl_steps: data.grid_sl_steps,
        fee_rate_pct: data.fee_rate_pct,
        objective: data.objective,
        ...(data.reserve_eval ? { selection_end: data.selection_end } : {}),
      });
      chargeRunCredits("labeling-optimizer");

      useRunsStore.getState().registerRun({
        id: response.run_id,
        tool: "labeling-optimizer",
        status: "running",
        progress: 0,
        stage: "starting",
        message: "Initializing labeling optimizer...",
        route: `/products/labeling-optimizer/run/${response.run_id}`,
      });

      navigate(`/products/labeling-optimizer/run/${response.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start optimization");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-white/12 bg-[#0a0a0a]/70 px-4 py-3 text-base text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/50";
  const labelClass = "mb-2 flex items-center text-sm font-medium text-[#F5F5F5]/75";

  return (
    <div className="relative pb-8 text-white">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
              <span className="font-medium text-white">Three steps:</span> pick a symbol → set the calendar
              window → tune the TP/SL/horizon search grid, then run.
            </div>

            <StepSection
              step={1}
              title="Choose symbol"
              description="Search Yahoo Finance the same way as the chart generator. This run uses a single ticker."
            >
              <SymbolBasket
                selectedSymbols={selectedSymbols}
                maxSymbols={1}
                tipText="Search by company or ticker (e.g. Intel, INTC). Pick a suggestion or press Enter. Choosing another ticker replaces the current one."
                onAdd={(sym) => {
                  setSelectedSymbols([sym]);
                  setValue("symbol", sym, { shouldValidate: true, shouldDirty: true });
                }}
                onRemove={() => {
                  setSelectedSymbols([]);
                  setValue("symbol", "", { shouldValidate: true, shouldDirty: true });
                }}
              />
              {errors.symbol && <p className="mt-2 text-xs text-red-400">{errors.symbol.message}</p>}
            </StepSection>

            <StepSection
              step={2}
              title="Set the analysis window"
              description="Drag the timeline handles or type dates — both stay in sync. Bars inside this range feed the labeling sweep."
            >
              <TestPeriodTimeline
                testStartIso={startIso}
                testEndIso={endIso}
                onTestStartChange={(iso) => setValue("start", iso, { shouldValidate: true, shouldDirty: true })}
                onTestEndChange={(iso) => setValue("end", iso, { shouldValidate: true, shouldDirty: true })}
                heading="Analysis period — drag handles"
                bandLabel="Analysis period"
                helperText={
                  <>
                    The <span className="text-sky-200/90">blue band</span> is the calendar span the optimizer
                    loads for{" "}
                    <strong className="text-white/85">{selectedSymbols[0] || "your symbol"}</strong>. Drag either
                    handle or edit the date fields below.
                  </>
                }
              />

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-help="opt-window">
                <div>
                  <label className={labelClass}>
                    Start date <span className="text-[#e5e5e5]">*</span>
                    <FieldTip text="Same as the left timeline handle. Edit here or drag — both stay in sync." />
                  </label>
                  <input
                    type="date"
                    value={startIso}
                    max={endIso}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                      setValue("start", v, { shouldValidate: true, shouldDirty: true });
                      const s = parseIsoDate(v);
                      const en = parseIsoDate(endIso);
                      if (s && en && s > en) {
                        setValue("end", v, { shouldValidate: true, shouldDirty: true });
                      }
                    }}
                    className={`${inputClass} font-mono`}
                  />
                  {errors.start && <p className="mt-1 text-xs text-red-400">{errors.start.message}</p>}
                </div>
                <div>
                  <label className={labelClass}>
                    End date <span className="text-[#e5e5e5]">*</span>
                    <FieldTip text="Same as the right timeline handle. Cannot be after today." />
                  </label>
                  <input
                    type="date"
                    value={endIso}
                    min={startIso}
                    max={todayIsoMax}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                      setValue("end", v, { shouldValidate: true, shouldDirty: true });
                      const s = parseIsoDate(startIso);
                      const en = parseIsoDate(v);
                      if (s && en && s > en) {
                        setValue("start", v, { shouldValidate: true, shouldDirty: true });
                      }
                    }}
                    className={`${inputClass} font-mono`}
                  />
                  {errors.end && <p className="mt-1 text-xs text-red-400">{errors.end.message}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>
                    Bar timeframe
                    <FieldTip text="Candle size for the price series the optimizer sweeps over (daily, weekly, or monthly)." />
                  </label>
                  <select {...register("timeframe")} className={inputClass}>
                    <option value="1d">1 day</option>
                    <option value="1wk">1 week</option>
                    <option value="1mo">1 month</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm text-white/75">
                    <input
                      type="checkbox"
                      checked={reserveEval}
                      onChange={(e) => {
                        setValue("reserve_eval", e.target.checked, { shouldValidate: true });
                        if (e.target.checked && !selectionEnd) setValue("selection_end", defaultResearchEnd(startIso, endIso), { shouldValidate: true });
                      }}
                      className="accent-white"
                    />
                    Reserve a later evaluation period
                    <FieldTip text="Candidates are ranked on the research period only. The bars after the research end are scored separately and shown next to each candidate; they never change the ranking." />
                  </label>
                  {reserveEval ? (
                    <div className="mt-3 max-w-xs">
                      <label className={labelClass}>Research period ends</label>
                      <input
                        type="date"
                        value={selectionEnd}
                        min={startIso}
                        max={endIso}
                        onChange={(e) => setValue("selection_end", e.target.value, { shouldValidate: true, shouldDirty: true })}
                        className={`${inputClass} font-mono`}
                      />
                      {errors.selection_end ? (
                        <p className="mt-1 text-xs text-red-400">{errors.selection_end.message}</p>
                      ) : (
                        <p className="mt-1 text-xs text-white/45">
                          Research {startIso} → {selectionEnd}; evaluation from the next trading day to {endIso}.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </StepSection>

            <StepSection
              step={3}
              title="Search grid & constraints"
              description="Define the TP/SL and horizon ranges to sweep, plus filters that discard thin strategies."
            >
              <div className="space-y-5" data-help="opt-grid">
                <p className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-amber-100/85">
                  The current engine searches a fixed grid on daily bars: take-profit 0.5–40% and stop-loss 0.5–20% (25 steps
                  each), horizons 1–200 bars, at least 50 trades, 0.1% fee per side. The fields below are saved with the run
                  for reference but do not change the search yet; only the symbol and date window do.
                </p>
                <div>
                  <div className="mb-3 flex items-center text-sm font-medium text-white/80">
                    Take-profit &amp; stop-loss ranges
                    <FieldTip text="Percent move from entry. The optimizer samples a grid between min and max for each side." />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="flex items-center text-[11px] text-[rgba(255,255,255,0.65)]">
                          Take-profit sweep
                          <FieldTip text="Upper profit target band (%). Wider ranges explore more labeling regimes but take longer." />
                        </span>
                        <span className="font-mono text-[11px] text-[#a3a3a3]">
                          {tpMin.toFixed(1)}% — {tpMax.toFixed(1)}%
                        </span>
                      </div>
                      <Slider
                        className={rangeSliderClass}
                        min={0}
                        max={50}
                        step={0.5}
                        minStepsBetweenThumbs={1}
                        value={[tpMin, tpMax]}
                        onValueChange={(v) => {
                          setValue("tp_min_pct", v[0], { shouldValidate: true, shouldDirty: true });
                          setValue("tp_max_pct", v[1], { shouldValidate: true, shouldDirty: true });
                        }}
                      />
                      {(errors.tp_min_pct || errors.tp_max_pct) && (
                        <p className="mt-1 text-xs text-red-400">
                          {errors.tp_max_pct?.message ?? errors.tp_min_pct?.message}
                        </p>
                      )}
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="flex items-center text-[11px] text-[rgba(255,255,255,0.65)]">
                          Stop-loss sweep
                          <FieldTip text="Lower loss threshold band (%). Paired with TP to score each labeling combination." />
                        </span>
                        <span className="font-mono text-[11px] text-[#a3a3a3]">
                          {slMin.toFixed(1)}% — {slMax.toFixed(1)}%
                        </span>
                      </div>
                      <Slider
                        className={rangeSliderClass}
                        min={0}
                        max={50}
                        step={0.5}
                        minStepsBetweenThumbs={1}
                        value={[slMin, slMax]}
                        onValueChange={(v) => {
                          setValue("sl_min_pct", v[0], { shouldValidate: true, shouldDirty: true });
                          setValue("sl_max_pct", v[1], { shouldValidate: true, shouldDirty: true });
                        }}
                      />
                      {(errors.sl_min_pct || errors.sl_max_pct) && (
                        <p className="mt-1 text-xs text-red-400">
                          {errors.sl_max_pct?.message ?? errors.sl_min_pct?.message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={labelClass}>
                      Horizon min (bars)
                      <FieldTip text="Shortest forward window (in bars) allowed when scoring a TP/SL pair." />
                    </label>
                    <input {...register("horizon_min")} type="number" className={inputClass} />
                    {errors.horizon_min && (
                      <p className="mt-1 text-xs text-red-400">{errors.horizon_min.message}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>
                      Horizon max (bars)
                      <FieldTip text="Longest forward window (in bars). Larger maxs explore slower labels." />
                    </label>
                    <input {...register("horizon_max")} type="number" className={inputClass} />
                    {errors.horizon_max && (
                      <p className="mt-1 text-xs text-red-400">{errors.horizon_max.message}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>
                      TP grid steps
                      <FieldTip text="How many evenly spaced take-profit values to evaluate between TP min and max." />
                    </label>
                    <input {...register("grid_tp_steps")} type="number" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>
                      SL grid steps
                      <FieldTip text="How many evenly spaced stop-loss values to evaluate between SL min and max." />
                    </label>
                    <input {...register("grid_sl_steps")} type="number" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>
                      Minimum trades
                      <FieldTip text="Discard labeling configs that produce fewer closed trades than this floor — reduces noisy winners." />
                    </label>
                    <input {...register("min_trades")} type="number" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>
                      Fee rate (% per side)
                      <FieldTip text="Round-trip friction applied per trade side when ranking results (e.g. 0.1 = 0.1%)." />
                    </label>
                    <input {...register("fee_rate_pct")} type="number" step="0.01" className={inputClass} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>
                      Objective
                      <FieldTip text="Primary metric used to rank labeling configs after the sweep completes." />
                    </label>
                    <select {...register("objective")} className={inputClass}>
                      <option value="max_cagr">Maximize CAGR</option>
                      <option value="max_sharpe">Maximize Sharpe</option>
                      <option value="max_winrate">Maximize win rate</option>
                      <option value="min_drawdown">Minimize max drawdown</option>
                    </select>
                  </div>
                </div>
              </div>
            </StepSection>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <button
                type="submit"
                data-help="opt-run"
                disabled={isSubmitting || selectedSymbols.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/25 bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a]" />
                    Starting…
                  </>
                ) : (
                  <>
                    Optimize labels <RunCost tool="labeling-optimizer" params={pricingParams} />
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
              <RunCostHint tool="labeling-optimizer" params={pricingParams} className="text-center" />
            </div>
      </form>
    </div>
  );
}
