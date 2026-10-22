import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { GlobalRun, ReviewDataset, ReviewModel, ReviewRun } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { useReview, type AssetRef } from "../ReviewContext";
import { shortId } from "../lib/format";
import { btnSm, cx, Missing } from "./primitives";

/** Primary title with secondary identifier (immutable id, or derived name when renamed). */
export function AssetTitle({ refv, id, archived }: { refv: AssetRef; id?: string | null; archived?: boolean }) {
  const { titleOf, names } = useReview();
  const title = titleOf(refv);
  const derived = names.derived.get(`${refv.kind}:${refv.id}`);
  const asset = useReview().find(refv);
  const renamed = asset && "display_name" in asset.item && !!asset.item.display_name;
  return (
    <div className="min-w-0">
      <div className={cx("truncate text-[14px] font-medium", archived ? "text-white/40" : "text-white/90")} title={title}>
        {title}
      </div>
      <div className="truncate font-mono text-[12px] text-white/35" title={id ?? refv.id}>
        {renamed && derived ? `${derived} · ` : ""}
        {shortId(id ?? refv.id, 10)}
      </div>
    </div>
  );
}

/** Inline link that opens another asset in the inspector. */
export function AssetLink({ refv, label, className }: { refv: AssetRef; label?: string; className?: string }) {
  const { inspect, titleOf, find } = useReview();
  const present = !!find(refv);
  const text = label ?? titleOf(refv);
  if (!present) {
    return (
      <span className="font-mono text-[12.5px] text-white/35" title="Referenced, but not present in this workspace">
        {shortId(refv.id, 10)}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => inspect(refv)}
      className={cx("max-w-full truncate text-left text-[13.5px] text-white/80 underline decoration-white/15 underline-offset-[3px] hover:text-white hover:decoration-white/50", className)}
      title={text}
    >
      {text}
    </button>
  );
}

export function useRunRoute() {
  const getRunRoute = useRunsStore((s) => s.getRunRoute);
  return (r: Pick<ReviewRun, "id" | "tool" | "status"> & Partial<ReviewRun>) => getRunRoute(r as unknown as GlobalRun);
}

export function OpenInTool({ to, label = "Open in tool" }: { to: string; label?: string }) {
  return (
    <Link
      to={to}
      className={btnSm}
    >
      {label} <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );
}

export function backtestRouteForModel(m: ReviewModel): string {
  if (m.source === "trained" && m.training_run_id) return `/tools/backtester?modelRunId=${encodeURIComponent(m.training_run_id)}`;
  if (m.source === "uploaded") return `/tools/backtester?modelId=${encodeURIComponent(m.id)}`;
  return "/tools/backtester";
}

export function deployRouteForModel(m: ReviewModel): string {
  return m.source === "trained" && m.training_run_id
    ? `/tools/deploy?trainingRunId=${encodeURIComponent(m.training_run_id)}`
    : `/tools/deploy?modelId=${encodeURIComponent(m.id)}`;
}

export function datasetActions(d: ReviewDataset): { to: string; label: string }[] {
  const out: { to: string; label: string }[] = [];
  if (d.representation === "archive" && d.generator_run_id) out.push({ to: `/tools/generator/runs/${encodeURIComponent(d.generator_run_id)}`, label: "Generator run" });
  if (d.kind === "training" && d.representation !== "archive") out.push({ to: "/tools/trainer", label: "Train on it" });
  if ((d.kind === "test" || d.kind === "unknown") && d.dataset_id) out.push({ to: `/tools/backtester?datasetId=${encodeURIComponent(d.dataset_id)}`, label: "Backtest on it" });
  return out;
}

export function Symbols({ value }: { value?: string | null }) {
  if (!value) return <Missing />;
  const list = value.split(/[,\s]+/).filter(Boolean);
  return (
    <span className="font-mono text-[13px] text-white/75" title={list.join(", ")}>
      {list.length > 3 ? `${list.slice(0, 3).join(", ")} +${list.length - 3}` : list.join(", ")}
    </span>
  );
}
