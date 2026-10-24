import { useNavigate } from "react-router-dom";
import { X, AlertTriangle } from "lucide-react";
import { useCreditsStore } from "@/state/creditsStore";

const TOOL_LABELS: Record<string, string> = {
  "training-chart-generator": "chart generation",
  trainer: "model training",
  analysis: "analysis",
  testdata: "test data generation",
  backtester: "a backtest",
  "labeling-optimizer": "the labeling optimizer",
};

/** Shown when the server refuses (or would refuse) a run for lack of credits. */
export default function CreditGuardModal() {
  const navigate = useNavigate();
  const open = useCreditsStore((s) => s.insufficientOpen);
  const balance = useCreditsStore((s) => s.balance);
  const pendingTool = useCreditsStore((s) => s.pendingTool);
  const shortfall = useCreditsStore((s) => s.shortfall);
  const costOf = useCreditsStore((s) => s.costOf);
  const close = useCreditsStore((s) => s.closeInsufficient);

  if (!open) return null;

  const toolLabel = pendingTool ? TOOL_LABELS[pendingTool] ?? "this run" : "this run";
  const cost = shortfall?.cost ?? (pendingTool ? costOf(pendingTool) : null);
  const have = shortfall?.balance ?? balance;
  const go = (to: string) => {
    close();
    navigate(to);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-guard-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0c] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
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
            <h2 id="credit-guard-title" className="text-lg font-semibold text-white">
              Not enough credits
            </h2>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-white/70">
            {cost != null && have != null ? (
              <>
                Starting {toolLabel} needs <span className="font-semibold text-white">{cost} credits</span>. Your balance is{" "}
                <span className="font-semibold text-red-300">{have}</span>.
              </>
            ) : (
              <>Your balance does not cover {toolLabel}.</>
            )}{" "}
            Nothing was started and nothing was charged. Paid plans are not available yet; see the plans page for what is
            planned, or contact us if you need more credits now.
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => go("/pricing")}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              View plans
            </button>
            <button
              type="button"
              onClick={() => go("/account?tab=usage")}
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/10"
            >
              Usage &amp; credits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
