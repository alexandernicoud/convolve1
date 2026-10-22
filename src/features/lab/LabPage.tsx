import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { cx, KV, Panel, surface } from "@/features/review/components/primitives";
import { datasetsApi, internalModelsApi, type DatasetListItem, type InternalModel } from "@/lib/api";
import { fmtInt } from "@/lib/viz/format";
import { labApi, type ExperimentKind, type LabContext, type ModelKind, type ModelRef } from "./api";
import { inputCls, LabCtx, type LabShared } from "./components";
import { useLabSession } from "./useLabSession";
import ImageExplorer from "./ImageExplorer";
import AtlasView from "./AtlasView";
import SensitivityView from "./SensitivityView";
import FeaturesView from "./FeaturesView";
import RepresentationView from "./RepresentationView";
import FindingsView from "./FindingsView";

const TABS = [
  { id: "explorer", label: "Image explorer" },
  { id: "atlas", label: "Attention atlas" },
  { id: "sensitivity", label: "Sensitivity" },
  { id: "features", label: "Features" },
  { id: "representation", label: "Representation" },
  { id: "findings", label: "Findings" },
] as const;

const modelKey = (m: InternalModel) => `${m.kind}:${m.kind === "trained" ? m.training_run_id ?? m.model_id : m.model_id}`;

function datasetLabel(d: DatasetListItem): string {
  const market = [d.symbols, d.timeframe].filter(Boolean).join(" ");
  const period = d.period_start && d.period_end ? `${String(d.period_start).slice(0, 10)} → ${String(d.period_end).slice(0, 10)}` : null;
  const head = d.display_name || market || d.name;
  return [head, period, d.total_images ? `${fmtInt(d.total_images)} images` : null, d.dataset_id].filter(Boolean).join(" · ");
}

function parseModel(v: string | null): { kind: ModelKind; id: string } | null {
  if (!v) return null;
  const i = v.indexOf(":");
  const kind = v.slice(0, i);
  const id = v.slice(i + 1);
  return (kind === "trained" || kind === "uploaded") && id ? { kind, id } : null;
}

export default function LabPage() {
  const [sp, setSp] = useSearchParams();
  const model = parseModel(sp.get("model"));
  const datasetId = sp.get("dataset");
  const sessionId = sp.get("session");
  const tab = sp.get("tab") ?? "explorer";
  const imageId = sp.get("image");

  const [models, setModels] = useState<InternalModel[]>([]);
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [context, setContext] = useState<LabContext | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);

  const patch = useCallback(
    (changes: Record<string, string | null>, replace = false) => {
      setSp(
        (cur) => {
          const next = new URLSearchParams(cur);
          for (const [k, v] of Object.entries(changes)) (v == null ? next.delete(k) : next.set(k, v));
          return next;
        },
        { replace },
      );
    },
    [setSp],
  );

  useEffect(() => {
    internalModelsApi.list().then(({ models }) => setModels(models)).catch(() => {});
    datasetsApi.list().then(({ datasets }) => setDatasets(datasets)).catch(() => {});
  }, []);

  // Entry points: ?trainer_run=<id> (from a training session) and ?session=<id> (from run history).
  useEffect(() => {
    const tr = sp.get("trainer_run");
    if (tr && !model) patch({ trainer_run: null, model: `trained:${tr}` }, true);
  }, [sp, model, patch]);

  useEffect(() => {
    if (!sessionId || model) return;
    labApi
      .session(sessionId)
      .then(({ session }) => patch({ model: `${session.model.kind}:${session.model.id}`, dataset: session.dataset_id }, true))
      .catch(() => setCtxErr("This lab session was not found or belongs to another account."));
  }, [sessionId, model, patch]);

  const ref: ModelRef | null = useMemo(() => (model ? { model_kind: model.kind, model_id: model.id, dataset_id: datasetId } : null), [model?.kind, model?.id, datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ref) {
      setContext(null);
      return;
    }
    let alive = true;
    setCtxLoading(true);
    labApi
      .context(ref)
      .then((c) => {
        if (!alive) return;
        setContext(c);
        setCtxErr(null);
        if (!ref.dataset_id && c.default_dataset_id) patch({ dataset: c.default_dataset_id }, true);
      })
      .catch((e) => alive && (setContext(null), setCtxErr(e instanceof Error ? e.message : "Could not load this model")))
      .finally(() => alive && setCtxLoading(false));
    return () => {
      alive = false;
    };
  }, [ref, patch]);

  // Reattach to the newest session for this model + dataset after navigation or refresh.
  useEffect(() => {
    if (!model || !datasetId || sessionId) return;
    let alive = true;
    labApi
      .sessions({ model_kind: model.kind, model_id: model.id })
      .then(({ sessions }) => {
        const hit = sessions.find((s) => s.dataset_id === datasetId);
        if (alive && hit) patch({ session: hit.session_id }, true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [model?.kind, model?.id, datasetId, sessionId, patch]); // eslint-disable-line react-hooks/exhaustive-deps

  const session = useLabSession(sessionId);

  const run = useCallback(
    async (kind: ExperimentKind, params: Record<string, unknown>) => {
      if (!ref) return;
      const res = await labApi.submit(ref, { session_id: sessionId, kind, params });
      if (res.session_id !== sessionId) patch({ session: res.session_id }, true);
      else await session.refresh();
    },
    [ref, sessionId, patch, session],
  );

  const shared: LabShared | null = useMemo(
    () =>
      ref && context
        ? {
            ref,
            context,
            sessionId,
            session,
            run,
            cancel: async (jobId: string) => {
              if (sessionId) await labApi.cancel(sessionId, jobId).catch(() => {});
              await session.refresh();
            },
            openImage: (id: string) => patch({ tab: "explorer", image: id }),
            goTab: (t: string) => patch({ tab: t }),
          }
        : null,
    [ref, context, sessionId, session, run, patch],
  );

  const trainingDataset = context?.default_dataset_id ?? null;
  const selectedModel = model ? `${model.kind}:${model.id}` : "";

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          <p className="text-[13px] text-white/45">Analysis</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-tight text-white">CNN interpretability lab</h1>
          <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-white/55">
            Where does the model's evidence sit, does that evidence actually drive its output, and how are its internal features organised? Every result records its sample,
            seed and method so it can be reproduced.
          </p>
        </div>
        <Link to="/tools/analysis/legacy" className="text-[13px] text-white/45 underline-offset-4 transition hover:text-white hover:underline">
          One-shot analysis report (previous version)
        </Link>
      </header>

      <section className={cx(surface, "grid gap-4 px-5 py-4 md:grid-cols-2")}>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[12.5px] text-white/55">Model</span>
          <select className={inputCls} value={selectedModel} onChange={(e) => patch({ model: e.target.value || null, dataset: null, session: null, image: null })}>
            <option value="">Select a model…</option>
            {selectedModel && !models.some((m) => modelKey(m) === selectedModel) ? <option value={selectedModel}>{model?.id}</option> : null}
            {models.map((m) => (
              <option key={modelKey(m)} value={modelKey(m)}>
                {m.kind === "trained" ? "Trained" : "Uploaded"} · {m.display_name || m.name || m.model_id}
                {m.symbols ? ` · ${m.symbols}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[12.5px] text-white/55">Images</span>
          <select className={inputCls} value={datasetId ?? ""} disabled={!model} onChange={(e) => patch({ dataset: e.target.value || null, session: null, image: null })}>
            <option value="">{model ? "Select a dataset…" : "Select a model first"}</option>
            {datasetId && !datasets.some((d) => d.dataset_id === datasetId) ? <option value={datasetId}>{datasetId}</option> : null}
            {datasets.map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {datasetLabel(d)}
                {d.dataset_id === trainingDataset ? " · trained on this" : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      {ctxErr ? <p className="rounded-xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3 text-[13.5px] text-red-200/90">{ctxErr}</p> : null}

      {!model ? (
        <Panel title="Choose a model">
          <p className="pl-4 text-[14px] leading-relaxed text-white/50">
            Pick a trained or uploaded model. Trained models open on the dataset they were trained on, so validation (held-out) images can be told apart from training images.
          </p>
        </Panel>
      ) : !context ? (
        <div className={cx(surface, "h-32 animate-pulse")} aria-busy={ctxLoading} />
      ) : (
        <>
          <ContextStrip context={context} sessionId={sessionId} />
          {!context.dataset ? (
            <Panel title="Choose images">
              <p className="pl-4 text-[14px] text-white/50">This model has no recorded training dataset. Pick a dataset of charts in the same format.</p>
            </Panel>
          ) : shared ? (
            <LabCtx.Provider value={shared}>
              <nav className="flex gap-1 overflow-x-auto border-b border-white/[0.08]" aria-label="Lab modules">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch({ tab: t.id })}
                    aria-current={tab === t.id ? "page" : undefined}
                    className={cx(
                      "relative whitespace-nowrap px-3.5 py-2.5 text-[14px] transition",
                      tab === t.id ? "text-white after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-white" : "text-white/50 hover:text-white/85",
                    )}
                  >
                    {t.label}
                    {t.id !== "explorer" && t.id !== "findings" ? <TabDot kind={t.id} /> : null}
                  </button>
                ))}
              </nav>
              {session.error ? <p className="text-[13px] text-red-300/90">{session.error}</p> : null}
              {tab === "explorer" ? <ImageExplorer imageId={imageId} onSelect={(id) => patch({ image: id }, !imageId)} /> : null}
              {tab === "atlas" ? <AtlasView /> : null}
              {tab === "sensitivity" ? <SensitivityView /> : null}
              {tab === "features" ? <FeaturesView /> : null}
              {tab === "representation" ? <RepresentationView /> : null}
              {tab === "findings" ? <FindingsView /> : null}
            </LabCtx.Provider>
          ) : null}
        </>
      )}
    </div>
  );

  function TabDot({ kind }: { kind: string }) {
    const kinds: ExperimentKind[] = kind === "sensitivity" ? ["sensitivity", "faithfulness"] : kind === "representation" ? ["embedding"] : [kind as ExperimentKind];
    const states = kinds.map((k) => session.forKind(k));
    const live = states.some((s) => s.latest && (s.latest.status === "queued" || s.latest.status === "running"));
    const done = states.some((s) => s.resultJob);
    if (!live && !done) return null;
    return <span className={cx("ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", live ? "animate-pulse bg-white" : "bg-white/45")} title={live ? "Running" : "Has results"} />;
  }
}

function ContextStrip({ context, sessionId }: { context: LabContext; sessionId: string | null }) {
  const m = context.model;
  const d = context.dataset;
  const splitLabel: Record<string, string> = {
    recorded: "Recorded by the trainer",
    reconstructed: "Reconstructed (unverified)",
    unknown: "Unknown",
    not_applicable: "Not applicable",
  };
  return (
    <Panel title="Context" description="Shared by every module below.">
      <KV
        cols={3}
        rows={[
          ["Input", `${m.input_size.join(" × ")} px RGB`],
          ["Preprocessing", "Decode RGB · AREA resize · ÷255", m.preprocessing],
          ["Output", m.head === "sigmoid" ? "Sigmoid (2 classes)" : `Softmax (${m.n_classes} classes)`],
          ["Conv layers", m.conv_layers.map((c) => c.name).join(" · ")],
          ["Images", d ? `${fmtInt(d.n_images)}${d.truncated ? " (first 20,000 indexed)" : ""}` : null],
          ["Labels", d ? Object.entries(d.labels).map(([k, v]) => `${k}: ${fmtInt(v)}`).join(" · ") : null],
          ["Window ends", d?.date_range ? `${d.date_range[0]} → ${d.date_range[1]}` : null],
          ["Validation membership", d ? `${splitLabel[d.split.status]}${d.split.n_validation != null ? ` · ${fmtInt(d.split.n_validation)} images` : ""}` : null, d?.split.note],
          [
            "Chart layout",
            d ? (d.layout.verified ? "Convolve generator (verified)" : "Assumed (not from the generator)") : null,
            "Time runs left (oldest) to right (recent); price runs bottom to top. Verified for charts made by the Convolve generator.",
          ],
          ["Model fingerprint", m.fingerprint, "Changes when the model file changes; cached results are keyed on it."],
          ["Session", sessionId ?? "Created on the first experiment", "Groups this model's experiments and their results."],
        ]}
      />
    </Panel>
  );
}
