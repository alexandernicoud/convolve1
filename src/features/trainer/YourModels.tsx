import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { internalModelsApi, type InternalModel } from "@/lib/api";
import { cx, PanelTitle, surface } from "@/features/review/components/primitives";
import { fmtDateTime } from "@/lib/viz/format";
import { createdMs, libraryModels } from "./libraryModels";

const action = "rounded-lg border border-white/12 px-2 py-1 text-[12px] text-white/65 transition hover:border-white/30 hover:text-white";

/** Saved trained models from the server-side library, so a finished model is always one click away. */
export function YourModels({ limit = 6 }: { limit?: number }) {
  const [models, setModels] = useState<InternalModel[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    internalModelsApi
      .list()
      .then((r) => alive && setModels(r.models))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const rows = models ? libraryModels(models) : [];
  if (failed || (models && rows.length === 0)) return null;

  return (
    <section className={cx(surface, "px-5 py-5")}>
      <div className="flex items-center justify-between">
        <PanelTitle>Your models</PanelTitle>
        <Link to="/tools/run-log?tab=models" className="text-[13px] text-white/55 transition hover:text-white">
          Model library →
        </Link>
      </div>
      {!models ? (
        <p className="mt-3 text-[13px] text-white/40">Loading…</p>
      ) : (
        <ul className="mt-3">
          {rows.slice(0, limit).map((m) => {
            const run = m.training_run_id!;
            const ref = encodeURIComponent(`trained:${run}`);
            return (
              <li key={m.model_id} className="border-t border-white/[0.06] py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link to={`/tools/trainer/runs/${encodeURIComponent(run)}`} className="min-w-0 truncate text-[13.5px] text-white/85 hover:text-white">
                    {m.display_name || m.name || run}
                  </Link>
                  <span className="shrink-0 text-[12px] text-white/40">
                    {m.lifecycle === "kept" ? "Kept · " : ""}
                    {createdMs(m) ? fmtDateTime(createdMs(m)) : ""}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Link to={`/tools/analysis?model=${ref}`} className={action}>Analyze</Link>
                  <Link to={`/tools/backtester?modelRunId=${encodeURIComponent(run)}`} className={action}>Backtest</Link>
                  <Link to={`/tools/deploy?trainingRunId=${encodeURIComponent(run)}`} className={action}>Deploy</Link>
                  <Link to={`/tools/improve?model=${ref}&from=trainer`} className={action}>Improve</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
