import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, FlaskConical, Loader2, Play } from "lucide-react";
import { reviewApi, trainerApi, type ReviewOverviewResponse, type TrainerArchitecture, type TrainingSession } from "@/lib/api";
import { confirmRun, chargeRunCredits } from "@/state/creditsStore";
import { RunCost } from "@/components/RunCostHint";
import { useRunsStore } from "@/state/runsStore";
import { btn, btnPrimary, btnSm, Caveat, cx, EmptyState, Panel, StatusPill, surface } from "@/features/review/components/primitives";
import { fmtInt, fmtNum, fmtPct, MISSING } from "@/lib/viz/format";
import { ModelHealthPanel } from "@/features/trainer/ModelHealthPanel";
import {
  baselineFromSession,
  buildVariant,
  comparisonRow,
  experimentPayload,
  ORDER,
  PRESET_SELECTS,
  pricingFor,
  selectionStatus,
  VARIANT_COPY,
  type Variant,
  type VariantKey,
} from "./variants";

const ORIGIN_LABEL: Record<string, string> = {
  backtest: "a backtest",
  analysis: "an analysis",
  trainer: "training results",
  "model-health": "Model Health",
  "search-hub": "Search Hub",
};

function parseModel(p: string | null): { kind: "trained" | "uploaded" | null; id: string | null } {
  if (!p) return { kind: null, id: null };
  const [kind, ...rest] = p.split(":");
  const id = rest.join(":");
  return kind === "trained" || kind === "uploaded" ? { kind, id: id || null } : { kind: null, id: null };
}

export default function ImprovePage() {
  const [sp, setSp] = useSearchParams();
  const model = parseModel(sp.get("model"));
  const preset = sp.get("preset");
  const runId = model.kind === "trained" ? model.id : null;
  // A backtest origin must survive in-page links (Model Health actions rewrite `from`).
  const [stickyBacktest, setStickyBacktest] = useState<{ runId: string | null; origin: string } | null>(null);
  const param = sp.get("from");
  useEffect(() => {
    if (param?.startsWith("backtest:")) setStickyBacktest({ runId, origin: param });
  }, [param, runId]);
  const from = stickyBacktest && stickyBacktest.runId === runId ? stickyBacktest.origin : param;

  const [session, setSession] = useState<TrainingSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archs, setArchs] = useState<TrainerArchitecture[]>([]);
  const [overview, setOverview] = useState<ReviewOverviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<VariantKey>>(new Set());
  const [launching, setLaunching] = useState<VariantKey | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<Record<string, string>>({});

  useEffect(() => {
    trainerApi.getCatalog().then((c) => setArchs(c.architectures ?? [])).catch(() => setArchs([]));
    reviewApi.getOverview().then(setOverview).catch(() => setOverview(null));
  }, []);

  useEffect(() => {
    setSession(null);
    setLoadError(null);
    if (!runId) return;
    trainerApi
      .getProgress(runId)
      .then((r) => (r.session ? setSession(r.session) : setLoadError("This run has no recorded session.")))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load the model"));
  }, [runId]);

  useEffect(() => {
    setSelected(new Set(preset && PRESET_SELECTS[preset] ? PRESET_SELECTS[preset] : ["seed"]));
  }, [preset, runId]);

  const archLabel = useCallback((id: string) => archs.find((a) => a.id === id)?.label ?? id, [archs]);
  const baseline = useMemo(() => (session ? baselineFromSession(session, `${runId}.keras`) : null), [session, runId]);
  const variants = useMemo(
    () => (baseline ? ORDER.map((k) => buildVariant(k, baseline.request, archLabel)) : []),
    [baseline, archLabel],
  );

  const children = useMemo(
    () => (overview?.runs ?? []).filter((r) => r.tool === "trainer" && r.experiment?.parent_run_id === runId).sort((a, b) => b.created_at - a.created_at),
    [overview, runId],
  );

  const trainedModels = useMemo(
    () => (overview?.models ?? []).filter((m) => m.source === "trained" && m.training_run_id).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    [overview],
  );

  const launch = async (v: Variant) => {
    if (!runId || !baseline || launching) return;
    setLaunchError(null);
    const pricing = pricingFor(v.request, session?.dataset?.image_count ?? null);
    if (!(await confirmRun("trainer", pricing))) return;
    setLaunching(v.key);
    try {
      const res = await trainerApi.run({ ...v.request, experiment: experimentPayload(v, runId, from) });
      chargeRunCredits("trainer");
      useRunsStore.getState().registerRun({
        id: res.run_id,
        tool: "trainer",
        status: "running",
        progress: 0,
        stage: "starting",
        message: `Improve: ${VARIANT_COPY[v.key].label}`,
        route: `/tools/trainer/runs/${res.run_id}`,
      });
      setLaunched((m) => ({ ...m, [v.key]: res.run_id }));
      reviewApi.getOverview().then(setOverview).catch(() => undefined);
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Could not start the run");
    } finally {
      setLaunching(null);
    }
  };

  if (model.kind === "uploaded") {
    return (
      <Shell>
        <EmptyState
          title="Improve needs a model trained in Convolve"
          body="An uploaded .keras file does not record the dataset, split and settings it was trained with, so no controlled comparison can be built. Train a model on your dataset first, then improve it from its results."
          action={<Link to="/tools/trainer" className={btn}>Open the Trainer</Link>}
        />
      </Shell>
    );
  }

  if (!runId) {
    return (
      <Shell>
        <Panel title="Choose a model to improve" description="Improve retrains a finished model with one controlled change at a time, on the same dataset, split and seed.">
          {!overview ? (
            <p className="text-[13px] text-white/45">Loading your models…</p>
          ) : !trainedModels.length ? (
            <p className="text-[13px] text-white/45">No trained models yet.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {trainedModels.slice(0, 30).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-white/85">{m.display_name ?? m.name ?? m.id}</p>
                    <p className="font-digits text-[12px] text-white/40">{m.training_run_id}</p>
                  </div>
                  <button type="button" className={btnSm} onClick={() => setSp({ model: `trained:${m.training_run_id}` })}>
                    Improve
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <EmptyState title="Model not available" body={loadError} action={<Link to="/tools/run-log" className={btn}>Open Search Hub</Link>} />
      </Shell>
    );
  }
  if (!session || !baseline) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the model's recorded settings…</p>
      </Shell>
    );
  }

  const status = selectionStatus(session);
  const originKind = from?.split(":")[0] ?? "";
  const base = comparisonRow(session);

  return (
    <Shell>
      <section className={cx(surface, "p-5")}>
        <p className="text-[12px] uppercase tracking-wide text-white/40">Baseline</p>
        <h2 className="mt-1 text-[18px] font-medium text-white">{session.model_name ?? runId}</h2>
        <p className="mt-1 font-digits text-[12px] text-white/40">{runId}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
          <Fact k="Dataset" v={session.dataset?.name ?? session.dataset?.id ?? MISSING} />
          <Fact k="Architecture" v={archLabel(session.config?.architecture ?? "convolve-cnn-v1")} />
          <Fact k="Validation" v={`${fmtPct(session.config?.val_split ?? 0.2, 0)} · ${session.config?.validation_method ?? "chronological"}`} />
          <Fact k="Seed" v={String(session.config?.random_seed ?? 7)} />
        </dl>
        <p className="mt-3 text-[13px] text-white/60">
          <span className="text-white/80">{status.label}.</span> {status.detail}
        </p>
        {from && ORIGIN_LABEL[originKind] ? <p className="mt-1 text-[12.5px] text-white/40">Opened from {ORIGIN_LABEL[originKind]}; the origin is recorded with every experiment you launch.</p> : null}
        {originKind === "backtest" ? (
          <Caveat>
            You came here from a backtest. Models you design now are informed by that test's outcomes, so a later backtest on overlapping dates is recorded as research evaluation, not as an independent test. Confirm improvements on a later test period.
          </Caveat>
        ) : null}
        {baseline.problems.map((p) => <Caveat key={p}>{p}</Caveat>)}
        {baseline.notes.map((n) => <p key={n} className="mt-2 text-[12.5px] leading-relaxed text-amber-200/80">{n}</p>)}
      </section>

      <ModelHealthPanel session={session} runId={runId} hideImprove />

      <Panel
        title="Controlled variants"
        description="Each variant keeps the dataset, chronological split, validation share, epochs, seed and every other setting of the baseline, and changes only what is listed. Nothing starts until you press Train; each run asks you to confirm its credits first."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {variants.map((v) => {
            const on = selected.has(v.key);
            const runIdLaunched = launched[v.key];
            return (
              <article key={v.key} className={cx("rounded-xl border p-4", on ? "border-white/25 bg-white/[0.03]" : "border-white/[0.07]", !v.available && "opacity-55")}>
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      disabled={!v.available}
                      onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(v.key)) n.delete(v.key); else n.add(v.key); return n; })}
                    />
                    <span>
                      <span className="block text-[14.5px] font-medium text-white">{VARIANT_COPY[v.key].label}</span>
                      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-white/50">{VARIANT_COPY[v.key].hypothesis}</span>
                    </span>
                  </label>
                </div>
                {v.available ? (
                  <>
                    <ul className="mt-2.5 space-y-0.5 pl-6 font-digits text-[12.5px] text-white/70">
                      {v.changed.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                    {v.note ? <p className="mt-1.5 pl-6 text-[12px] text-white/45">{v.note}</p> : null}
                    {on ? (
                      <div className="mt-3 flex items-center gap-2 pl-6">
                        {runIdLaunched ? (
                          <Link to={`/tools/trainer/runs/${runIdLaunched}`} className={btnSm}>Started · open run</Link>
                        ) : (
                          <button type="button" className={cx(btnPrimary, "h-8 px-3 text-[13px]")} disabled={!!launching || baseline.problems.length > 0} onClick={() => void launch(v)}>
                            {launching === v.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                            Train <RunCost tool="trainer" params={pricingFor(v.request, session.dataset?.image_count ?? null)} />
                          </button>
                        )}
                        <span className="truncate text-[12px] text-white/35">{v.request.model_name}</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 pl-6 text-[12.5px] text-white/45">{v.reason}</p>
                )}
              </article>
            );
          })}
        </div>
        {launchError ? <p className="mt-3 text-[13px] text-red-300">{launchError}</p> : null}
      </Panel>

      <ComparisonPanel baseRunId={runId} base={base} experiments={children} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-5 pb-10">
      <div>
        <Link to="/tools/run-log" className="inline-flex items-center gap-1 text-[13px] text-white/45 hover:text-white/80">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Search Hub
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-[22px] font-medium text-white">
          <FlaskConical className="h-5 w-5 text-white/60" aria-hidden /> Improve model
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-normal uppercase tracking-wide text-white/50">Experimental</span>
        </h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-white/50">
          Controlled comparisons against a finished model: same data, same chronological split, same metrics, one change at a time. Results are compared on validation data; confirm any winner with a backtest on a later, untouched test period.
        </p>
      </div>
      {children}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-white/40">{k}</dt>
      <dd className="truncate text-white/80">{v}</dd>
    </div>
  );
}

type Row = ReturnType<typeof comparisonRow>;

function ComparisonPanel({ baseRunId, base, experiments }: { baseRunId: string; base: Row; experiments: ReviewOverviewResponse["runs"] }) {
  const [rows, setRows] = useState<Record<string, { session: TrainingSession | null; status: string }>>({});
  const ids = experiments.slice(0, 12).map((c) => c.id).join(",");
  useEffect(() => {
    let alive = true;
    for (const id of ids ? ids.split(",") : []) {
      trainerApi
        .getProgress(id)
        .then((r) => alive && setRows((m) => ({ ...m, [id]: { session: r.session ?? null, status: r.status } })))
        .catch(() => alive && setRows((m) => ({ ...m, [id]: { session: null, status: "unavailable" } })));
    }
    return () => { alive = false; };
  }, [ids]);

  return (
    <Panel
      title="Side-by-side results (validation)"
      description="Same validation period for every row. Differences smaller than the new-seed replicate's difference from the baseline are within run-to-run noise."
    >
      {!experiments.length ? (
        <p className="text-[13px] text-white/45">No experiments for this model yet. Launched variants appear here and in Search Hub, linked to this model.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left text-[12px] text-white/45">
                <th className="py-2 pr-3 font-normal">Run</th>
                <th className="py-2 pr-3 font-normal">Change</th>
                <th className="py-2 pr-3 text-right font-normal">ROC-AUC</th>
                <th className="py-2 pr-3 text-right font-normal">Balanced acc.</th>
                <th className="py-2 pr-3 text-right font-normal">Log loss</th>
                <th className="py-2 pr-3 text-right font-normal">Train − val acc.</th>
                <th className="py-2 pr-3 text-right font-normal">Saved epoch</th>
                <th className="py-2 text-right font-normal">Parameters</th>
              </tr>
            </thead>
            <tbody>
              <ResultRow label="Baseline" sub={baseRunId} change="—" row={base} />
              {experiments.slice(0, 12).map((c) => {
                const r = rows[c.id];
                const row = r?.session && r.session.stage === "completed" ? comparisonRow(r.session) : null;
                const change = (c.experiment?.changed ?? []).join("; ") || c.experiment?.preset || "—";
                return (
                  <ResultRow
                    key={c.id}
                    label={<Link className="hover:underline" to={`/tools/trainer/runs/${c.id}`}>{c.display_name ?? r?.session?.model_name ?? c.id}</Link>}
                    sub={c.id}
                    change={change}
                    row={row}
                    base={base}
                    status={row ? undefined : r?.status ?? c.status}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ResultRow({ label, sub, change, row, base, status }: { label: React.ReactNode; sub: string; change: string; row: Row | null; base?: Row; status?: string }) {
  const delta = (a: number | null | undefined, b: number | null | undefined, digits: number, higherBetter: boolean) => {
    if (a == null || b == null) return null;
    const d = a - b;
    if (Math.abs(d) < 10 ** -digits) return null;
    const good = higherBetter ? d > 0 : d < 0;
    return <span className={cx("ml-1 text-[11px]", good ? "text-emerald-300/80" : "text-red-300/80")}>{d > 0 ? "+" : ""}{d.toFixed(digits)}</span>;
  };
  return (
    <tr className="border-b border-white/[0.05] align-top">
      <td className="py-2.5 pr-3">
        <p className="text-white/85">{label}</p>
        <p className="font-digits text-[11.5px] text-white/35">{sub}</p>
      </td>
      <td className="max-w-[260px] py-2.5 pr-3 text-[12.5px] text-white/60">{change}</td>
      {row ? (
        <>
          <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/80">{fmtNum(row.auc, 3)}{base ? delta(row.auc, base.auc, 3, true) : null}</td>
          <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/80">{fmtNum(row.balancedAccuracy, 3)}{base ? delta(row.balancedAccuracy, base.balancedAccuracy, 3, true) : null}</td>
          <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/80">{fmtNum(row.logLoss, 3)}{base ? delta(row.logLoss, base.logLoss, 3, false) : null}</td>
          <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/80">{row.trainValGap == null ? MISSING : fmtPct(row.trainValGap, 1)}</td>
          <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/70">{row.savedEpoch ?? MISSING} / {row.epochsRun}</td>
          <td className="py-2.5 text-right font-digits tabular-nums text-white/70">{fmtInt(row.params)}</td>
        </>
      ) : (
        <td colSpan={6} className="py-2.5 text-right">
          <StatusPill status={status ?? "running"} />
        </td>
      )}
    </tr>
  );
}
