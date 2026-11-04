import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Play, Star } from "lucide-react";
import { improveApi, trainerApi, type ImproveSession, type TrainerArchitecture, type TrainingSession } from "@/lib/api";
import { confirmRun, chargeRunCredits } from "@/state/creditsStore";
import { RunCost } from "@/components/RunCostHint";
import { useRunsStore } from "@/state/runsStore";
import { btn, btnPrimary, btnSm, Caveat, cx, EmptyState, Panel, StatusPill, surface } from "@/features/review/components/primitives";
import { fmtNum, fmtPct, MISSING } from "@/lib/viz/format";
import {
  baselineFromSession,
  buildVariant,
  experimentPayload,
  nextReplicate,
  ORDER,
  PRESET_SELECTS,
  pricingFor,
  selectionStatus,
  VARIANT_COPY,
  type Variant,
  type VariantKey,
} from "./variants";
import { byGroup, changeLines, GROUP_COPY, GROUP_ORDER, isActive, VERDICT_COPY } from "./workspace";
import { DecisionCard, Fact, ModelPicker, NoisePanel, ResultsTable, RestoreButton, Shell } from "./ImproveParts";

const ORIGIN_LABEL: Record<string, string> = {
  backtest: "a backtest",
  analysis: "an analysis",
  trainer: "training results",
  "model-health": "Model Health",
  "search-hub": "Search Hub",
};

const POLL_MS = 5000;

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
  const asAnchor = sp.get("anchor") === "self";
  const runId = model.kind === "trained" ? model.id : null;
  // A backtest origin must survive in-page links and the switch to the original model.
  const [stickyBacktest, setStickyBacktest] = useState<string | null>(null);
  const param = sp.get("from");
  useEffect(() => {
    if (param?.startsWith("backtest:")) setStickyBacktest(param);
  }, [param]);
  const from = stickyBacktest ?? param;

  const [ws, setWs] = useState<ImproveSession | null>(null);
  const [redirectedFrom, setRedirectedFrom] = useState<string | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archs, setArchs] = useState<TrainerArchitecture[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    trainerApi.getCatalog().then((c) => setArchs(c.architectures ?? [])).catch(() => setArchs([]));
  }, []);

  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      const next = await improveApi.session(runId, asAnchor);
      setWs(next);
      setLoadError(null);
      if (next.opened_from_variant && next.anchor.run_id !== runId) {
        // Never silently treat a variant as the baseline: open the original's workspace and say so.
        setRedirectedFrom(runId);
        setSp(
          (cur) => {
            const n = new URLSearchParams(cur);
            n.set("model", `trained:${next.anchor.run_id}`);
            n.delete("anchor");
            return n;
          },
          { replace: true },
        );
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the model");
    }
  }, [runId, asAnchor, setSp]);

  useEffect(() => {
    setWs(null);
    void refresh();
  }, [refresh]);

  const anchorId = ws?.anchor.run_id ?? null;
  useEffect(() => {
    setSession(null);
    if (!anchorId) return;
    trainerApi
      .getProgress(anchorId)
      .then((r) => (r.session ? setSession(r.session) : setLoadError("The original model has no recorded session.")))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load the original model"));
  }, [anchorId]);

  const active = ws ? isActive(ws.experiments) : false;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(t);
  }, [active, refresh]);

  const archLabel = useCallback((id: string) => archs.find((a) => a.id === id)?.label ?? id, [archs]);
  const baseline = useMemo(() => (session ? baselineFromSession(session, `${anchorId}.keras`) : null), [session, anchorId]);
  const variantFor = useCallback(
    (key: VariantKey) => (baseline ? buildVariant(key, baseline.request, archLabel, nextReplicate(key, ws?.experiments ?? [])) : null),
    [baseline, archLabel, ws],
  );

  const launch = async (v: Variant) => {
    if (!anchorId || !baseline || launching) return;
    setLaunchError(null);
    const pricing = pricingFor(v.request, session?.dataset?.image_count ?? null);
    if (!(await confirmRun("trainer", pricing))) return;
    setLaunching(`${v.key}:${v.replicate}`);
    try {
      const res = await trainerApi.run({ ...v.request, experiment: experimentPayload(v, anchorId, from) });
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
      await refresh();
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

  if (!runId) return <ModelPicker onPick={(id) => setSp({ model: `trained:${id}` })} />;

  if (loadError && !ws) {
    return (
      <Shell>
        <EmptyState title="Model not available" body={loadError} action={<Link to="/tools/improve" className={btn}>Choose another model</Link>} />
      </Shell>
    );
  }
  if (!ws || !session || !baseline) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-[13px] text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the improvement workspace…
        </p>
      </Shell>
    );
  }

  const groups = byGroup(ws.experiments);
  const status = selectionStatus({ experiment: (ws.anchor.experiment ?? null) as TrainingSession["experiment"] });
  const originKind = from?.split(":")[0] ?? "";
  const recommended = new Set<VariantKey>(preset && PRESET_SELECTS[preset] ? PRESET_SELECTS[preset] : []);
  const seedVariant = variantFor("seed");
  const variants = ORDER.filter((k) => k !== "seed")
    .map((k) => variantFor(k)!)
    .sort((x, y) => Number(recommended.has(y.key)) - Number(recommended.has(x.key)));
  const cost = (v: Variant) => pricingFor(v.request, session.dataset?.image_count ?? null);
  const blocked = baseline.problems.length > 0;
  const a = ws.anchor.metrics;
  const redirected = redirectedFrom ? ws.experiments.find((e) => e.run_id === redirectedFrom) : null;

  return (
    <Shell>
      {redirectedFrom ? (
        <div className={cx(surface, "flex flex-wrap items-center justify-between gap-3 p-4 text-[13px] text-white/75")}>
          <p>
            <span className="text-white/90">{redirected?.display_name ?? redirected?.name ?? redirectedFrom}</span> is an experiment. Every experiment is compared with the
            original model, so this is the original's workspace.
          </p>
          {redirected?.lifecycle === "kept" ? (
            <Link className={btnSm} to={`/tools/improve?model=${encodeURIComponent(`trained:${redirectedFrom}`)}&anchor=self`}>
              Start a new session with this kept model as the original
            </Link>
          ) : null}
        </div>
      ) : null}

      <section className={cx(surface, "p-5")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-wide text-white/40">Original model · fixed baseline</p>
            <h2 className="mt-1 text-[18px] font-medium text-white">{ws.anchor.display_name ?? ws.anchor.name ?? anchorId}</h2>
            <p className="mt-1 font-digits text-[12px] text-white/40">{anchorId}</p>
          </div>
          <Link to={`/tools/trainer/runs/${anchorId}`} className={btnSm}>
            Open training results
          </Link>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
          <Fact k="Dataset" v={session.dataset?.name ?? session.dataset?.id ?? MISSING} />
          <Fact k="Architecture" v={archLabel(session.config?.architecture ?? "convolve-cnn-v1")} />
          <Fact k="Validation" v={`${fmtPct(session.config?.val_split ?? 0.2, 0)} · ${session.config?.validation_method ?? "chronological"}`} />
          <Fact k="Seed" v={String(session.config?.random_seed ?? 7)} />
          <Fact k="ROC-AUC" v={fmtNum(a?.roc_auc, 3)} />
          <Fact k="PR-AUC" v={fmtNum(a?.pr_auc, 3)} />
          <Fact k="Log loss" v={fmtNum(a?.log_loss, 3)} />
          <Fact k="Train − val acc." v={a?.train_val_gap == null ? MISSING : fmtPct(a.train_val_gap, 1)} />
        </dl>
        <p className="mt-3 text-[13px] text-white/60">
          <span className="text-white/80">{status.label}.</span> {status.detail}
        </p>
        {ws.selection.status === "test_results" ? (
          <Caveat>
            A backtest result was inspected while designing experiments in this session. Every experiment here inherits that history, so a later backtest on
            overlapping dates is research evaluation, not independent confirmation.
          </Caveat>
        ) : null}
        {from && ORIGIN_LABEL[originKind] ? (
          <p className="mt-1 text-[12.5px] text-white/40">Opened from {ORIGIN_LABEL[originKind]}; the origin is recorded with every experiment you launch.</p>
        ) : null}
        {originKind === "backtest" ? (
          <Caveat>You came here from a backtest. Experiments you design now are informed by that test's outcomes; confirm improvements on a later test period.</Caveat>
        ) : null}
        {baseline.problems.map((p) => (
          <Caveat key={p}>{p}</Caveat>
        ))}
        {baseline.notes.map((n) => (
          <p key={n} className="mt-2 text-[12.5px] leading-relaxed text-amber-200/80">
            {n}
          </p>
        ))}
      </section>

      <NoisePanel ws={ws} seed={seedVariant} cost={seedVariant ? cost(seedVariant) : null} launching={launching} blocked={blocked} onLaunch={(v) => void launch(v)} />

      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {GROUP_ORDER.map((g) => (
          <span key={g} className={cx("rounded-full border px-2.5 py-1", ws.counts[g] ? "border-white/20 text-white/80" : "border-white/[0.06] text-white/35")}>
            {GROUP_COPY[g]} · {ws.counts[g] ?? 0}
          </span>
        ))}
        {active ? (
          <span className="flex items-center gap-1 text-white/45">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> refreshing every {POLL_MS / 1000}s
          </span>
        ) : null}
      </div>

      {groups.awaiting_decision.length ? (
        <Panel
          title="Awaiting your decision"
          description="Each completed experiment is compared with the original model. Nothing is kept or archived until you confirm; archived experiments can be restored."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {groups.awaiting_decision.map((e) => {
              const repeat = e.variant_key ? variantFor(e.variant_key as VariantKey) : null;
              return (
                <DecisionCard
                  key={e.run_id}
                  e={e}
                  onDone={() => void refresh()}
                  onRepeat={() => repeat && void launch(repeat)}
                  repeatCost={repeat ? cost(repeat) : null}
                  launching={!!launching || blocked}
                />
              );
            })}
          </div>
        </Panel>
      ) : null}

      {groups.running.length + groups.queued.length ? (
        <Panel title="In progress" description="Status refreshes automatically; you can leave this page and come back.">
          <ul className="divide-y divide-white/[0.06]">
            {[...groups.running, ...groups.queued].map((e) => (
              <li key={e.run_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link to={`/tools/trainer/runs/${e.run_id}`} className="truncate text-[14px] text-white/85 hover:underline">
                    {e.display_name ?? e.name ?? e.run_id}
                  </Link>
                  <p className="truncate text-[12px] text-white/45">{changeLines(e).join("; ") || "—"}</p>
                </div>
                <StatusPill status={e.status} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <ResultsTable ws={ws} />

      <Panel
        title="Available experiments"
        description="Each experiment keeps the original's dataset, chronological split, validation share, epochs, seed and every other setting, and changes only what is listed. Nothing starts until you press Train; each run asks you to confirm its credits first."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {variants.map((v) => (
            <article
              key={v.key}
              className={cx("rounded-xl border p-4", recommended.has(v.key) ? "border-white/25 bg-white/[0.03]" : "border-white/[0.07]", !v.available && "opacity-55")}
            >
              <p className="text-[14.5px] font-medium text-white">
                {VARIANT_COPY[v.key].label}
                {recommended.has(v.key) ? (
                  <span className="ml-2 rounded-full border border-emerald-300/30 px-2 py-0.5 text-[11px] font-normal text-emerald-200/90">Recommended</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/50">{VARIANT_COPY[v.key].hypothesis}</p>
              {v.available ? (
                <>
                  <ul className="mt-2.5 space-y-0.5 font-digits text-[12.5px] text-white/70">
                    {v.changed.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  {v.note ? <p className="mt-1.5 text-[12px] text-white/45">{v.note}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className={cx(btnPrimary, "h-8 px-3 text-[13px]")} disabled={!!launching || blocked} onClick={() => void launch(v)}>
                      {launching === `${v.key}:${v.replicate}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                      {v.replicate > 0 ? `Run again (seed ${v.request.random_seed})` : "Train"} <RunCost tool="trainer" params={cost(v)} />
                    </button>
                    <span className="truncate text-[12px] text-white/35">{v.request.model_name}</span>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-[12.5px] text-white/45">{v.reason}</p>
              )}
            </article>
          ))}
        </div>
        {launchError ? <p className="mt-3 text-[13px] text-red-300">{launchError}</p> : null}
      </Panel>

      {(["kept", "archived", "failed"] as const).map((g) =>
        groups[g].length ? (
          <Panel
            key={g}
            title={GROUP_COPY[g]}
            description={g === "archived" ? "Hidden from your library and tools. Files are kept; Restore puts an experiment back up for decision." : undefined}
          >
            <ul className="divide-y divide-white/[0.06]">
              {groups[g].map((e) => (
                <li key={e.run_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/tools/trainer/runs/${e.run_id}`} className="text-[14px] text-white/85 hover:underline">
                      {e.display_name ?? e.name ?? e.run_id}
                    </Link>
                    {e.decision?.preferred ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-amber-200/90">
                        <Star className="h-3 w-3" aria-hidden /> preferred version
                      </span>
                    ) : null}
                    <p className="truncate text-[12px] text-white/45">
                      {changeLines(e).join("; ") || "—"} · {VERDICT_COPY[e.verdict.verdict]?.label}
                    </p>
                  </div>
                  {g === "archived" ? (
                    <RestoreButton runId={e.run_id} onDone={() => void refresh()} />
                  ) : g === "failed" ? (
                    <StatusPill status={e.status} />
                  ) : (
                    <Link className={btnSm} to={`/tools/improve?model=${encodeURIComponent(`trained:${e.run_id}`)}&anchor=self`}>
                      New session from this model
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null,
      )}
    </Shell>
  );
}
