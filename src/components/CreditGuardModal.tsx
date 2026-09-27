import { useNavigate } from "react-router-dom";
import { Zap, X, AlertTriangle } from "lucide-react";
import { useCreditsStore, RUN_COST } from "@/state/creditsStore";

const TOOL_LABELS: Record<string, string> = {
  "training-chart-generator": "chart generation",
  trainer: "model training",
  analysis: "analysis",
  testdata: "test data generation",
  backtester: "backtest",
  "labeling-optimizer": "labeling optimizer",
  optimizer: "optimization",
  bot: "bot deployment",
};

/**
 * Global blocking warning shown when a run is attempted without enough credits.
 * No paywall — the primary action just routes to the refill page.
 */
export default function CreditGuardModal() {
  const navigate = useNavigate();
  const open = useCreditsStore((s) => s.insufficientOpen);
  const credits = useCreditsStore((s) => s.credits);
  const pendingTool = useCreditsStore((s) => s.pendingTool);
  const close = useCreditsStore((s) => s.closeInsufficient);

  if (!open) return null;

  const toolLabel = pendingTool ? TOOL_LABELS[pendingTool] ?? "this run" : "this run";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0c] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">Not enough credits</h2>
              <p className="text-xs text-white/50">Each run costs {RUN_COST} credits.</p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-white/70">
            You need <span className="font-semibold text-white">{RUN_COST} credits</span> to start {toolLabel}, but you
            currently have{" "}
            <span className={`font-semibold ${credits < RUN_COST ? "text-red-300" : "text-white"}`}>
              {credits} credit{credits === 1 ? "" : "s"}
            </span>
            . Refill to continue — it's free.
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                close();
                navigate("/credits");
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              <Zap className="h-4 w-4" />
              Refill credits
            </button>
            <button
              type="button"
              onClick={close}
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/10"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
