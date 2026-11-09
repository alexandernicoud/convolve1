import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronDown, FlaskConical, Loader2 } from "lucide-react";
import {
  improveApi,
  internalModelsApi,
  trainerApi,
  type ImproveExperiment,
  type ImproveSession,
  type InternalModel,
  type TrainerArchitecture,
  type TrainingSession,
} from "@/lib/api";
import { confirmRun, chargeRunCredits } from "@/state/creditsStore";
import { useRunsStore } from "@/state/runsStore";
import { btn, btnPrimary, btnSm, Caveat, cx, EmptyState, StatusPill, surface } from "@/features/review/components/primitives";
import { findingBadge, type Finding } from "@/features/research/findings";
import { modelHealth, skillVerdict } from "@/features/trainer/health";
import { fmtNum, fmtPct, MISSING } from "@/lib/viz/format";
import { baselineFromSession, buildVariant, experimentPayload, nextReplicate, pricingFor, selectionStatus, VARIANT_COPY, type Variant, type VariantKey } from "./variants";
import { byGroup, experimentTitle, isActive } from "./workspace";
import { ACTION_TITLE, PURPOSES, recommend, type Recommendation } from "./recommend";
import { Fact, ModelPicker, modelName, NoiseStrip, ResultsTable, Shell, TIMEFRAME } from "./ImproveParts";
import { ExperimentCard, RunningCard } from "./ExperimentCard";
import { ConfigureExperiment } from "./ConfigureExperiment";

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

type Tab = "running" | "awaiting" | "completed" | "kept" | "archived" | "failed";

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
  const [library, setLibrary] = useState<InternalModel[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [config, setConfig] = useState<Variant | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const experimentsRef = useRef<HTMLElement>(null);
  const exploreRef = useRef<HTMLElement>(null);

  useEffect(() => {
    trainerApi.getCatalog().then((c) => setArchs(c.architectures ?? [])).catch(() => setArchs([]));
    internalModelsApi.list().then(({ models }) => setLibrary(models)).catch(() => setLibrary([]));
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
    setTab(null);
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
  const findings = useMemo(() => (session && anchorId ? modelHealth(session, anchorId) : []), [session, anchorId]);
  const rec = useMemo(
    () =>
      ws && baseline
        ? recommend({ findings, experiments: ws.experiments, noise: ws.noise, available: (k) => !!variantFor(k)?.available, preset })
        : null,
    [ws, baseline, findings, variantFor, preset],
  );

  const cost = (v: Variant) => pricingFor(v.request, session?.dataset?.image_count ?? null);

  const launch = async (v: Variant) => {
    if (!anchorId || !baseline || launching) return;
    setLaunchError(null);
    // The credit confirmation is its own modal; close the configuration first so it is not blocked.
    setConfig(null);
    if (!(await confirmRun("trainer", cost(v)))) {
      setConfig(v);
      return;
    }
    setLaunching(true);
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
      setTab("running");
      experimentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Could not start the run");
      setConfig(v);
    } finally {
      setLaunching(false);
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
  if (!ws || !session || !baseline || !rec) {
    return (
      <Shell>
        <div className="grid gap-4 lg:grid-cols-2" aria-busy>
          <div className={cx(surface, "h-64 animate-pulse")} />
          <div className={cx(surface, "h-64 animate-pulse")} />
        </div>
        <p className="flex items-center gap-2 text-[13px] text-white/45">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Diagnosing the model…
        </p>
      </Shell>
    );
  }

  const groups = byGroup(ws.experiments);
  const status = selectionStatus({ experiment: (ws.anchor.experiment ?? null) as TrainingSession["experiment"] });
  const originKind = from?.split(":")[0] ?? "";
  const blocked = baseline.problems.length > 0;
  const seedVariant = variantFor("seed");
  const lib = library.find((m) => m.training_run_id === anchorId);
  const originalName = lib ? modelName(lib) : (ws.anchor.display_name ?? ws.anchor.name ?? "Original model").replace(/\.keras$/i, "");
  const redirected = redirectedFrom ? ws.experiments.find((e) => e.run_id === redirectedFrom) : null;
  const validation = `${fmtPct(session.config?.val_split ?? 0.2, 0)} of charts, ${session.config?.validation_method ?? "chronological"} split`;
  const configure = (k: VariantKey) => {
    const v = variantFor(k);
    if (v) setConfig(v);
  };

  const finished = ws.experiments.filter((e) => e.group === "awaiting_decision" || e.group === "kept" || e.group === "archived");
  const lists: Record<Tab, ImproveExperiment[]> = {
    running: [...groups.running, ...groups.queued],
    awaiting: groups.awaiting_decision,
    completed: finished,
    kept: groups.kept,
    archived: groups.archived,
    failed: groups.failed,
  };
  const current: Tab = tab ?? (lists.awaiting.length ? "awaiting" : lists.running.length ? "running" : "completed");
  const tabs: { id: Tab; label: string }[] = [
    { id: "running", label: "Running" },
    { id: "awaiting", label: "Awaiting decision" },
    { id: "completed", label: "Completed" },
    { id: "kept", label: "Kept" },
    { id: "archived", label: "Archived" },
    ...(lists.failed.length ? [{ id: "failed" as Tab, label: "Failed" }] : []),
  ];

  return (
    <Shell>
      {redirectedFrom ? (
        <div className={cx(surface, "flex flex-wrap items-center justify-between gap-3 p-4 text-[13px] text-white/75")}>
          <p className="text-[13px]">
            <span className="text-white/90">{redirected ? experimentTitle(redirected, VARIANT_COPY) : "That model"}</span> is an experiment. Experiments are always
            compared with their original model, so this is the original's workspace.
          </p>
          {redirected?.lifecycle === "kept" ? (
            <Link className={btnSm} to={`/tools/improve?model=${encodeURIComponent(`trained:${redirectedFrom}`)}&anchor=self`}>
              Start a new session with this kept model as the original
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* 1 · Selected model and diagnosis */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <OriginalPanel
          name={originalName}
          lib={lib}
          ws={ws}
          session={session}
          archLabel={archLabel}
          findings={findings}
          anchorId={anchorId!}
          status={status}
          asAnchor={asAnchor}
        />
        <RecommendationPanel
          rec={rec}
          blocked={blocked}
          launching={launching}
          onConfigure={() => configure(rec.key)}
          onAlternative={configure}
          onExplore={() => exploreRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      </div>

      {blocked || ws.selection.status === "test_results" || originKind === "backtest" ? (
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 py-3 text-[12.5px] leading-relaxed text-amber-100/80">
          {baseline.problems.map((p) => (
            <p key={p} className="text-[12.5px] flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {p} Experiments cannot be started for this model.
            </p>
          ))}
          {ws.selection.status === "test_results" ? (
            <p className="text-[12.5px]">
              A backtest result was inspected while designing experiments in this session. A later backtest on overlapping dates is research evaluation, not independent
              confirmation.
            </p>
          ) : originKind === "backtest" ? (
            <p className="text-[12.5px]">You came here from a backtest. Experiments you design now are informed by that test; confirm improvements on a later test period.</p>
          ) : null}
        </div>
      ) : null}

      {/* 2 · My experiments */}
      <section ref={experimentsRef} className={cx(surface, "scroll-mt-24 p-5")} data-help="improve-decision">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-medium text-white">My experiments</h2>
            <p className="mt-0.5 text-[12.5px] text-white/45">Each result is compared with the original. Nothing is kept or archived until you confirm.</p>
          </div>
          {active ? (
            <span className="flex items-center gap-1.5 text-[12px] text-white/45">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> updating automatically
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Experiment status">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={current === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "convolve-press shrink-0 rounded-full border px-3 py-1 text-[12.5px] transition",
                current === t.id ? "accent-btn border-transparent font-medium" : lists[t.id].length ? "border-white/20 text-white/75 hover:border-white/40" : "border-white/[0.07] text-white/35",
              )}
            >
              {t.label} · {lists[t.id].length}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <NoiseStrip ws={ws} seed={seedVariant} cost={seedVariant ? cost(seedVariant) : null} launching={launching} blocked={blocked} onConfigure={setConfig} />
        </div>

        <div key={current} className="animate-fade-in mt-4">
          {!lists[current].length ? (
            <p className="rounded-xl border border-dashed border-white/[0.1] px-4 py-6 text-center text-[13px] text-white/45">
              {ws.experiments.length
                ? `No ${tabs.find((t) => t.id === current)?.label.toLowerCase()} experiments.`
                : "No experiments yet. Start with the recommended experiment above; its result will appear here."}
            </p>
          ) : current === "running" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {lists.running.map((e) => (
                <RunningCard key={e.run_id} e={e} />
              ))}
            </div>
          ) : current === "failed" ? (
            <ul className="divide-y divide-white/[0.06]">
              {lists.failed.map((e) => (
                <li key={e.run_id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link to={`/tools/trainer/runs/${e.run_id}`} className="truncate text-[14px] text-white/80 hover:underline">
                    {experimentTitle(e, VARIANT_COPY)}
                  </Link>
                  <StatusPill status={e.status} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {lists[current].map((e) => {
                const k = (e.variant_key as VariantKey | null) ?? null;
                return (
                  <ExperimentCard
                    key={e.run_id}
                    e={e}
                    ws={ws}
                    busy={launching || blocked}
                    onDone={() => void refresh()}
                    onSeedOriginal={() => seedVariant && setConfig(seedVariant)}
                    onRepeat={k && k in VARIANT_COPY ? () => configure(k) : null}
                  />
                );
              })}
            </div>
          )}
        </div>
        {launchError && !config ? <p className="mt-3 text-[13px] text-red-300">{launchError}</p> : null}
      </section>

      {/* 3 · Explore more experiments */}
      <section ref={exploreRef} className="scroll-mt-24 space-y-3" data-help="improve-variants" id="explore">
        <div>
          <h2 className="text-[17px] font-medium text-white">Explore more experiments</h2>
          <p className="mt-0.5 max-w-3xl text-[12.5px] text-white/45">
            Each changes one thing and keeps the dataset, split and every other setting identical. Prefer a few motivated experiments: trying many and picking the best
            number overfits to the validation data.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PURPOSES.map((p) => (
            <div key={p.id} className={cx(surface, "flex flex-col p-4")}>
              <p className="text-[14.5px] font-medium text-white">{p.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-white/45">{p.blurb}</p>
              <ul className="mt-3 space-y-2">
                {p.keys.map((k) => {
                  const v = variantFor(k)!;
                  const runs = ws.experiments.filter((e) => e.variant_key === k && e.group !== "failed").length;
                  const isRec = rec.key === k;
                  return (
                    <li key={k} className={cx("rounded-lg border px-3 py-2.5", isRec ? "border-[rgba(var(--convolve-accent-rgb),0.45)] bg-white/[0.03]" : "border-white/[0.07]")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13.5px] text-white/90">
                            {VARIANT_COPY[k].label}
                            {isRec ? <span className="accent-text ml-2 text-[11px] font-medium">Recommended</span> : null}
                          </p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-white/45">
                            {v.available ? v.changed.join(" · ") || "Same settings" : v.reason}
                          </p>
                          {runs ? <p className="mt-0.5 text-[11.5px] text-white/40">Run {runs}× in this session</p> : null}
                        </div>
                        {v.available ? (
                          <button type="button" className={cx(btnSm, "shrink-0")} disabled={launching || blocked} onClick={() => setConfig(v)}>
                            {runs ? "Repeat" : "Configure"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 4 · Advanced research details */}
      <details className={cx(surface, "group p-5")} data-help="improve-advanced">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span>
            <span className="block text-[15px] font-medium text-white">Advanced research details</span>
            <span className="block text-[12.5px] text-white/45">Full metrics table, seed evidence, provenance, selection history and integrity notes</span>
          </span>
          <ChevronDown className="h-4 w-4 text-white/50 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-5 space-y-6">
          <ResultsTable ws={ws} />
          <div className="grid gap-5 md:grid-cols-2">
            <div className="text-[12.5px]">
              <p className="text-[14px] font-medium text-white">Seed evidence</p>
              <p className="text-[12.5px] mt-1 text-white/60">
                {ws.noise.baseline_runs} of {ws.noise.required} required runs of the original settings
                {ws.noise.seed_sd != null ? ` · ROC-AUC seed spread ${fmtNum(ws.noise.seed_sd, 3)}` : ""}.
              </p>
              <ul className="mt-1 font-digits text-[11.5px] text-white/40">
                {ws.noise.baseline_run_ids.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            </div>
            <div className="text-[12.5px]">
              <p className="text-[14px] font-medium text-white">Provenance</p>
              <dl className="mt-1 space-y-0.5 text-white/60">
                <div>
                  Original run: <span className="font-digits text-white/75">{anchorId}</span>
                </div>
                <div>
                  Dataset: <span className="font-digits text-white/75">{session.dataset?.id ?? MISSING}</span>
                </div>
                <div>Session: <span className="font-digits text-white/75">{ws.session_id}</span></div>
                <div>
                  {status.label}. {status.detail}
                </div>
                {from && ORIGIN_LABEL[originKind] ? <div>Opened from {ORIGIN_LABEL[originKind]}; recorded with every experiment you launch.</div> : null}
              </dl>
            </div>
            <div className="text-[12.5px]">
              <p className="text-[14px] font-medium text-white">Test-set selection history</p>
              {ws.selection.history?.length ? (
                <ul className="mt-1 space-y-0.5 text-white/60">
                  {ws.selection.history.map((h, i) => (
                    <li key={i}>
                      {h.kind}: {h.first_decision ?? "?"} to {h.last_decision ?? "?"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] mt-1 text-white/50">No test results were inspected in this session; experiments are selected on validation data only.</p>
              )}
            </div>
            <div className="text-[12.5px]">
              <p className="text-[14px] font-medium text-white">Integrity notes</p>
              <ul className="mt-1 space-y-1 text-white/60">
                {[...baseline.problems, ...baseline.notes].map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>Every experiment uses the original's dataset and validation split; verdicts use validation ROC-AUC with a seed-noise and sampling margin.</li>
                <li>Validation improvements are not trading results. Confirm a kept model with a backtest on a later, untouched period.</li>
              </ul>
            </div>
          </div>
        </div>
      </details>

      <ConfigureExperiment
        variant={config}
        base={baseline.request}
        pricing={config ? cost(config) : null}
        originalName={originalName}
        datasetName={session.dataset?.name ?? (lib?.symbols ? `Same ${lib.symbols} charts` : (session.dataset?.id ?? MISSING))}
        validation={validation}
        recommendation={rec}
        archLabel={archLabel}
        launching={launching}
        error={launchError}
        onClose={() => {
          setConfig(null);
          setLaunchError(null);
        }}
        onRun={(v) => void launch(v)}
      />
    </Shell>
  );
}

const SEVERITY_DOT: Record<string, string> = {
  problem: "bg-red-300/80",
  warning: "bg-amber-300/80",
  info: "bg-white/40",
  ok: "bg-emerald-300/70",
};

function OriginalPanel({
  name,
  lib,
  ws,
  session,
  archLabel,
  findings,
  anchorId,
  status,
  asAnchor,
}: {
  name: string;
  lib: InternalModel | undefined;
  ws: ImproveSession;
  session: TrainingSession;
  archLabel: (id: string) => string;
  findings: Finding[];
  anchorId: string;
  status: ReturnType<typeof selectionStatus>;
  asAnchor: boolean;
}) {
  const skill = skillVerdict(findings);
  const issues = findings.filter((f) => f.severity === "problem" || f.severity === "warning").slice(0, 3);
  const a = ws.anchor.metrics;
  const meta = [
    lib?.symbols?.split(/[,\s]+/).filter(Boolean).slice(0, 4).join(", "),
    lib?.timeframe ? TIMEFRAME[lib.timeframe] ?? lib.timeframe : null,
    session.dataset?.name,
  ].filter(Boolean);
  return (
    <section className={cx(surface, "flex flex-col p-5")} data-help="improve-anchor">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] uppercase tracking-wide text-white/40">{asAnchor ? "Original model · new session" : "Original model · fixed reference"}</p>
          <h2 className="mt-1 truncate text-[20px] font-medium text-white">{name}</h2>
          {meta.length ? <p className="mt-0.5 truncate text-[12.5px] text-white/50">{meta.join(" · ")}</p> : null}
        </div>
        <Link to="/tools/improve" className="shrink-0 text-[12.5px] text-white/45 hover:text-white/80">
          Change model
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
        <Fact k="Validation ROC-AUC" v={fmtNum(a?.roc_auc, 3)} />
        <Fact k="Balanced accuracy" v={fmtNum(a?.balanced_accuracy, 3)} />
        <Fact k="Train − val gap" v={a?.train_val_gap == null ? MISSING : fmtPct(a.train_val_gap, 1)} />
        <Fact k="Architecture" v={archLabel(session.config?.architecture ?? "convolve-cnn-v1")} />
      </dl>

      <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5" data-help="model-health">
        <p className="text-[12px] uppercase tracking-wide text-white/40">Model Health</p>
        <p className="mt-1 text-[14px] font-medium text-white">{skill.headline}</p>
        {issues.length ? (
          <ul className="mt-2 space-y-1.5">
            {issues.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-[12.5px]">
                <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", SEVERITY_DOT[f.severity])} aria-hidden />
                <span className="min-w-0 text-white/75">
                  {f.title}
                  {findingBadge(f) ? <span className="ml-1.5 text-white/40">· {findingBadge(f)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12.5px] text-white/55">No problems or warnings in the recorded training run.</p>
        )}
        <Link to={`/tools/trainer/runs/${anchorId}`} className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] text-white/55 hover:text-white">
          Full Model Health and training results <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <p className="mt-3 text-[12px] text-white/40">{status.label}. Every experiment in this session is compared with this model; it is never replaced automatically.</p>
    </section>
  );
}

const KIND_LABEL: Record<Recommendation["kind"], string> = {
  diagnosis: "Based on Model Health",
  evidence: "Needed to judge your results",
  exploratory: "Exploratory",
  done: "Strengthen the evidence",
};

function RecommendationPanel({
  rec,
  blocked,
  launching,
  onConfigure,
  onAlternative,
  onExplore,
}: {
  rec: Recommendation;
  blocked: boolean;
  launching: boolean;
  onConfigure: () => void;
  onAlternative: (k: VariantKey) => void;
  onExplore: () => void;
}) {
  return (
    <section
      className={cx(surface, "relative flex flex-col overflow-hidden border-[rgba(var(--convolve-accent-rgb),0.35)] p-5")}
      data-help="improve-recommendation"
      aria-label="Recommended next experiment"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[rgba(var(--convolve-accent-rgb),0.08)] to-transparent" aria-hidden />
      <div className="relative flex items-center gap-2 text-[11.5px] uppercase tracking-wide text-white/45">
        <FlaskConical className="accent-text h-4 w-4" aria-hidden /> Recommended next experiment
        <span className="rounded-full border border-white/15 px-2 py-px text-[10.5px] normal-case tracking-normal text-white/55">{KIND_LABEL[rec.kind]}</span>
      </div>
      <h2 className="relative mt-2 text-[22px] font-medium leading-tight text-white">{rec.title}</h2>

      <div className="relative mt-4 space-y-3 text-[13px] leading-relaxed">
        {rec.observed ? (
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-wide text-white/40">
              Observed{rec.evidence ? <span className="ml-1.5 normal-case tracking-normal text-white/35">· {rec.evidence}</span> : null}
            </p>
            <p className="text-[13.5px] mt-0.5 text-white/75">{rec.observed}</p>
          </div>
        ) : null}
        <div>
          <p className="text-[11.5px] font-medium uppercase tracking-wide text-white/40">{rec.key === "seed" ? "Why" : "Why it may help · hypothesis"}</p>
          <p className="text-[13.5px] mt-0.5 text-white/75">{rec.hypothesis}</p>
        </div>
        {rec.key !== "seed" ? <p className="text-[12px] text-white/40">An experiment tests this; it does not guarantee an improvement.</p> : null}
      </div>

      <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-5">
        <button type="button" className={cx(btnPrimary, "h-10 px-5")} disabled={blocked || launching} onClick={onConfigure}>
          Configure Recommended Experiment <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={cx(btn, "h-10")} onClick={onExplore}>
          Explore All Experiments
        </button>
      </div>
      {rec.alternatives.length ? (
        <p className="relative mt-3 text-[12px] text-white/45">
          Also tests this:{" "}
          {rec.alternatives.map((k, i) => (
            <span key={k}>
              {i ? ", " : ""}
              <button type="button" className="text-white/70 underline-offset-2 hover:text-white hover:underline" disabled={blocked} onClick={() => onAlternative(k)}>
                {ACTION_TITLE[k].replace(/^Test /, "")}
              </button>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}