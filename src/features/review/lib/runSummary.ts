import type { ReviewRun } from "@/lib/api";
import { int, isNum, pctFrac, pctUnits } from "./format";

/** One-line result summary per tool; null when nothing was recorded. */
export function runSummary(r: ReviewRun): string | null {
  if (r.status === "failed" || r.status === "interrupted") {
    const msg = (r.error || r.message || "").split("\n")[0].trim();
    return msg ? msg.slice(0, 140) : null;
  }
  switch (r.tool) {
    case "backtester": {
      const p = r.backtest?.performance;
      if (!p) return null;
      const parts = [isNum(p.return_pct) ? `net ${pctUnits(p.return_pct, 2, true)}` : null, isNum(p.trades) ? `${int(p.trades)} trades` : null];
      return parts.filter(Boolean).join(" · ") || null;
    }
    case "trainer": {
      const m = r.training?.metrics;
      if (!m) return null;
      const parts = [
        isNum(m.val_accuracy) ? `val acc ${pctFrac(m.val_accuracy)}` : null,
        isNum(m.epochs_trained) ? `${m.epochs_trained} ep` : null,
      ];
      return parts.filter(Boolean).join(" · ") || null;
    }
    case "labeling-optimizer": {
      const b = r.optimizer?.best;
      if (!b) return null;
      const parts = [
        isNum(b.best_tp) && isNum(b.best_sl) ? `best TP ${pctFrac(b.best_tp, 1)} / SL ${pctFrac(b.best_sl, 1)}` : null,
        isNum(b.best_cagr) ? `CAGR ${pctUnits(b.best_cagr, 1)} (in-sample)` : null,
      ];
      return parts.filter(Boolean).join(" · ") || null;
    }
    case "training-chart-generator": {
      const dist = r.generator?.label_distribution;
      const total = dist ? Object.values(dist).reduce((s, v) => s + (isNum(v) ? v : 0), 0) : null;
      return total ? `${int(total)} labelled charts` : null;
    }
    case "analysis":
      return isNum(r.analysis?.artifact_count) ? `${r.analysis!.artifact_count} artifacts` : null;
    default:
      return null;
  }
}
