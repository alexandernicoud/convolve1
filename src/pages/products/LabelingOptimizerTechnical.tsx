import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { labelingOptimizerApi } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { Slider } from "@/components/ui/slider";

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
  })
  .refine(
    (data) => {
      const startDate = new Date(data.start);
      const endDate = new Date(data.end);
      return startDate < endDate;
    },
    { message: "Start date must be before end date", path: ["end"] }
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
  });

type FormData = z.infer<typeof formSchema>;

const rangeSliderClass =
  "w-full py-1 [&_[data-orientation=horizontal]]:w-full [&_.bg-primary]:bg-white [&_[role=slider]]:border-white/40 [&_[role=slider]]:bg-[#0a0a0a]";

export default function LabelingOptimizerTechnical() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      start: "2020-01-01",
      end: "2025-01-01",
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
    },
  });

  const tpMin = watch("tp_min_pct");
  const tpMax = watch("tp_max_pct");
  const slMin = watch("sl_min_pct");
  const slMax = watch("sl_max_pct");

  const onSubmit = async (data: FormData) => {
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
      });

      useRunsStore.getState().registerRun({
        id: response.run_id,
        tool: "labeling-optimizer",
        status: "running",
        progress: 0,
        stage: "starting",
        message: "Initializing labeling optimizer...",
        route: `/products/labeling-optimizer/runs/${response.run_id}`,
      });

      navigate(`/products/labeling-optimizer/run/${response.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start optimization");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.35)] focus:border-[rgba(255,255,255,0.06)] focus:outline-none focus:ring-1 focus:ring-[rgba(255,255,255,0.06)]";
  const labelClass = "mb-1 block text-[11px] font-medium text-[rgba(255,255,255,0.65)]";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-25">
        <div className="absolute left-10 top-16 h-72 w-72 rounded-full bg-[rgba(255,255,255,0.06)] blur-3xl" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-[rgba(255,255,255,0.15)] blur-3xl" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden px-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)]">
            <div className="shrink-0 border-b border-white/[0.06] px-4 py-2.5 md:px-5">
              <p className="text-[12px] leading-snug text-[rgba(255,255,255,0.78)] md:text-[13px]">
                Symbol &amp; dates drive the run; extra fields are saved with the run (see note below).
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:space-y-4 md:px-6 md:py-4">
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a3a3a3]">Data</h3>
                  <div className="grid gap-2.5 md:grid-cols-2 md:gap-3">
                    <div className="md:col-span-2">
                      <label className={labelClass}>Symbol</label>
                      <input {...register("symbol")} type="text" placeholder="INTC" className={inputClass} />
                      {errors.symbol && <p className="mt-0.5 text-xs text-red-400">{errors.symbol.message}</p>}
                    </div>
                    <div>
                      <label className={labelClass}>Start date</label>
                      <input {...register("start")} type="date" className={inputClass} />
                      {errors.start && <p className="mt-0.5 text-xs text-red-400">{errors.start.message}</p>}
                    </div>
                    <div>
                      <label className={labelClass}>End date</label>
                      <input {...register("end")} type="date" className={inputClass} />
                      {errors.end && <p className="mt-0.5 text-xs text-red-400">{errors.end.message}</p>}
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelClass}>Bar timeframe</label>
                      <select {...register("timeframe")} className={inputClass}>
                        <option value="1d">1 day</option>
                        <option value="1wk">1 week</option>
                        <option value="1mo">1 month</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                    TP &amp; SL ranges (0–50%)
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[rgba(255,255,255,0.65)]">Take-profit sweep</span>
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
                        <p className="mt-1 text-xs text-red-400">{errors.tp_max_pct?.message ?? errors.tp_min_pct?.message}</p>
                      )}
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[rgba(255,255,255,0.65)]">Stop-loss sweep</span>
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
                        <p className="mt-1 text-xs text-red-400">{errors.sl_max_pct?.message ?? errors.sl_min_pct?.message}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">Horizon &amp; grid</h3>
                  <div className="grid gap-2.5 md:grid-cols-2 md:gap-3">
                    <div>
                      <label className={labelClass}>Horizon min (bars)</label>
                      <input {...register("horizon_min")} type="number" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Horizon max (bars)</label>
                      <input {...register("horizon_max")} type="number" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>TP grid steps</label>
                      <input {...register("grid_tp_steps")} type="number" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>SL grid steps</label>
                      <input {...register("grid_sl_steps")} type="number" className={inputClass} />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a3a3a3]">Constraints</h3>
                  <div className="grid gap-2.5 md:grid-cols-2 md:gap-3">
                    <div>
                      <label className={labelClass}>Minimum trades</label>
                      <input {...register("min_trades")} type="number" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Fee rate (% per side)</label>
                      <input {...register("fee_rate_pct")} type="number" step="0.01" className={inputClass} />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelClass}>Objective</label>
                      <select {...register("objective")} className={inputClass}>
                        <option value="max_cagr">Maximize CAGR</option>
                        <option value="max_sharpe">Maximize Sharpe</option>
                        <option value="max_winrate">Maximize win rate</option>
                        <option value="min_drawdown">Minimize max drawdown</option>
                      </select>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <p className="text-xs text-red-300">{error}</p>
                  </div>
                )}
              </div>

              <div className="shrink-0 space-y-2 border-t border-white/[0.08] bg-black/50 px-4 py-4 md:px-6">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-white/25 bg-white px-4 py-2.5 text-sm font-medium text-[#0a0a0a] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Starting…
                    </>
                  ) : (
                    <>
                      Run labeling optimizer
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
                <p className="text-[10px] leading-snug text-[rgba(255,255,255,0.42)]">
                  Engine uses symbol + dates only; other values are stored on the run. Results view unchanged.
                </p>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
