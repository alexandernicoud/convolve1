import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, Play, Wrench } from "lucide-react";
import { btnPrimary, btnSm, Chip, cx, Panel, surface } from "@/features/review/components/primitives";
import type { ExperimentKind } from "./api";
import { useLab } from "./components";
import { allZeroCounts, diagnose, GUIDED_PARAMS, improveLink, type DiagState, type Diagnostic, type LabResults } from "./diagnostics";
import { isActive } from "./lib";

const KINDS: ExperimentKind[] = ["atlas", "sensitivity", "faithfulness", "features", "embedding", "stability"];

const RUN_LABEL: Record<ExperimentKind, string> = {
  atlas: "Attention atlas",
  sensitivity: "Region masking",
  faithfulness: "Faithfulness",
  features: "Feature laboratory",
  embedding: "Representation",
  stability: "Rendering stability",
};

const STATE: Record<DiagState, { label: string; cls: string }> = {
  missing: { label: "Not run", cls: "border-white/[0.12] text-white/45" },
  rerun: { label: "Rerun needed", cls: "border-white/[0.12] text-white/55" },
  ok: { label: "No concern", cls: "border-white/25 text-white/80" },
  attention: { label: "Worth a look", cls: "border-amber-300/40 text-amber-200/90" },
  unclear: { label: "Inconclusive", cls: "border-white/[0.14] text-white/55" },
  info: { label: "Observation", cls: "border-white/[0.14] text-white/65" },
  unavailable: { label: "Not available", cls: "border-white/[0.1] text-white/40" },
};

export default function DiagnosticsView() {
  const { context, ref, sessionId, session, run, goTab } = useLab();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const results: LabResults = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, session.forKind(k).result])), [session]);
  const splitKnown = !!context.dataset && (context.dataset.split.status === "recorded" || context.dataset.split.status === "reconstructed");
  const diags = useMemo(() => diagnose(results, { splitKnown }), [results, splitKnown]);
  const zeros = allZeroCounts(results);
  const live = (k: ExperimentKind) => isActive(session.forKind(k).latest);
  const pending = [...new Set(diags.filter((d) => d.state === "missing" || d.state === "rerun").map((d) => d.kinds[0]))].filter((k) => !live(k));

  const start = async (kinds: ExperimentKind[], key: string) => {
    setBusy(key);
    setMsg(null);
    let queued = 0;
    let into: string | null | undefined = sessionId;
    try {
      for (const k of kinds) {
        into = await run(k, GUIDED_PARAMS[k], into);
        queued += 1;
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : "Could not start the experiment";
      setMsg(queued ? `${queued} queued. ${text}` : text);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        help="lab-diagnostics"
        title={
          <span className="flex items-center gap-2">
            Guided diagnostics <Chip>Experimental</Chip>
          </span>
        }
        description="Seven questions worth asking of any chart CNN, each answered from a lab experiment computed on this model and these images. A check without a result says so; nothing here is inferred without running it."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimary} disabled={!pending.length || busy != null} onClick={() => void start(pending, "all")}>
            {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {pending.length ? `Run ${pending.length} missing experiment${pending.length > 1 ? "s" : ""}` : "All checks have results"}
          </button>
          {pending.length ? <span className="text-[12.5px] text-white/40">{pending.map((k) => RUN_LABEL[k]).join(" · ")} · up to 3 run at once</span> : null}
        </div>
        {msg ? <p className="mt-3 text-[13px] text-amber-200/85">{msg}</p> : null}
        {sessionId == null ? <p className="mt-3 text-[13px] text-white/45">The first experiment creates a lab session for this model and dataset.</p> : null}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {diags.map((d) => (
          <DiagnosticCard
            key={d.id}
            d={d}
            running={d.kinds.some(live)}
            busy={busy === d.id}
            onRun={() => void start([d.kinds[0]], d.id)}
            onOpen={() => goTab(d.tab)}
            improveTo={d.improve ? improveLink(ref.model_kind, ref.model_id, sessionId, d.improve.preset) : null}
          />
        ))}
      </div>

      <AllZeroNote zeros={zeros} />
    </div>
  );
}

function DiagnosticCard({ d, running, busy, onRun, onOpen, improveTo }: { d: Diagnostic; running: boolean; busy: boolean; onRun: () => void; onOpen: () => void; improveTo: string | null }) {
  const st = STATE[d.state];
  const canRun = d.state === "missing" || d.state === "rerun";
  return (
    <article className={cx(surface, "flex flex-col gap-3 px-5 py-4")}>
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-medium leading-snug text-white">{d.title}</h3>
        <span className={cx("shrink-0 rounded-md border px-1.5 py-0.5 text-[11.5px]", st.cls)}>{running ? "Running…" : st.label}</span>
      </header>
      <p className="text-[13px] leading-relaxed text-white/50">{d.question}</p>
      <p className="text-[14px] leading-relaxed text-white/80">{d.headline}</p>
      {d.details.length ? (
        <ul className="space-y-1 text-[12.5px] leading-relaxed text-white/55">
          {d.details.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
      {d.improve && improveTo ? (
        <div className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12.5px] leading-relaxed text-white/60">
          <p>{d.improve.reason}</p>
          <Link to={improveTo} className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-white hover:underline">
            <Wrench className="h-3.5 w-3.5" /> Compare a retrained variant
          </Link>
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
        {canRun ? (
          <button type="button" className={btnSm} disabled={running || busy} onClick={onRun}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {d.state === "rerun" ? "Rerun" : "Run"}
          </button>
        ) : null}
        {d.tab !== "diagnostics" && d.state !== "missing" && d.state !== "unavailable" ? (
          <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-[13px] text-white/55 transition hover:text-white">
            Full result <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AllZeroNote({ zeros }: { zeros: { kind: ExperimentKind; zero: number; of: number }[] }) {
  const seen = zeros.filter((z) => z.zero > 0);
  return (
    <Panel title="About all-zero Grad-CAM maps" description="A blank map is a measurement, not a missing result.">
      <div className="space-y-2 pl-4 text-[13.5px] leading-relaxed text-white/65">
        <p>
          Grad-CAM keeps only evidence that pushes the explained class up (it applies a ReLU to the weighted activations). When no channel at the chosen layer adds positive evidence,
          the whole map is zero.
        </p>
        <p>
          That is not automatically a model failure. It happens when a prediction rests on the absence of features, when the decision is made in later dense layers, or when the
          explained class is the one the model is arguing against. Try an earlier layer, explain the other class, or rely on the faithfulness and masking checks, which do not depend
          on Grad-CAM being non-zero.
        </p>
        <p>It is a concern when almost every image is blank at every layer: then the convolutional features carry little class evidence at all.</p>
        {seen.length ? (
          <p className="text-white/50">
            In this session: {seen.map((z) => `${z.zero} of ${z.of} images in the ${z.kind === "atlas" ? "attention atlas" : "faithfulness test"}`).join("; ")}. These images are excluded from those aggregates and counted.
          </p>
        ) : zeros.length ? (
          <p className="text-white/50">No all-zero maps in this session's atlas or faithfulness results.</p>
        ) : null}
      </div>
    </Panel>
  );
}
