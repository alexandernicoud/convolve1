import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { trainerApi, AnalysisStatusResponse, type TrainerHistoryEpoch } from "@/lib/api";
import { AccuracyPlot, LossPlot } from "@/components/analysis/TrainingMetricsPlots";
import { AttentionWithChart } from "@/components/analysis/AttentionWithChart";
import { MatrixHeatmapPlot } from "@/components/analysis/MatrixHeatmapPlot";
import { LearnedFiltersGrid } from "@/components/analysis/LearnedFiltersGrid";
import { AnalysisSection, DashboardFigure } from "@/components/analysis/AnalysisFigure";
import { cn } from "@/lib/utils";

type AnalysisResult = AnalysisStatusResponse;

/* Chart heights for the compact dashboard (≈ 50% of the previous hero sizes). */
const TRAINING_CHART_HEIGHT = 200;
const HEATMAP_TILE_MAX = "max-w-[320px]";
const FILTER_TILE_MAX = "max-w-[560px]";

function shortId(id: string, keep = 8): string {
  if (id.length <= keep + 3) return id;
  return `${id.slice(0, keep)}…`;
}

function humanizeLayerName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickAttentionJson(jsonFiles: string[]): string | null {
  const ordered = ["attention_overlay.json", "gradcam_overlay.json"];
  for (const name of ordered) {
    if (jsonFiles.includes(name)) return name;
  }
  const loose = jsonFiles.find(
    (f) => f.includes("attention_overlay") || f.includes("gradcam_overlay"),
  );
  return loose ?? null;
}

function layerFromMeanActivation(filename: string): string | null {
  const m = filename.match(/^mean_activation_(.+)\.json$/);
  return m ? m[1] : null;
}

function layerFromLearnedFilters(filename: string): string | null {
  const m = filename.match(/^learned_filters_(.+)\.json$/);
  return m ? m[1] : null;
}

function sortLayerNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-0 shrink-0 overflow-x-hidden bg-[#0a0a0a] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,100,180,0.07),transparent_55%)]" />
      <div className="relative">{children}</div>
    </div>
  );
}

export default function TrainerAdvancedVisuals() {
  const { runId, analysisId } = useParams<{ runId: string; analysisId: string }>();
  const navigate = useNavigate();
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainHistory, setTrainHistory] = useState<TrainerHistoryEpoch[]>([]);
  const [analysisIds, setAnalysisIds] = useState<string[]>([]);

  useEffect(() => {
    if (!runId || !analysisId) return;
    void (async () => {
      try {
        setLoading(true);
        const result = await trainerApi.getAnalysisStatus(runId, analysisId);
        setAnalysisResult(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load analysis results");
      } finally {
        setLoading(false);
      }
    })();
  }, [runId, analysisId]);

  useEffect(() => {
    if (!runId) return;
    void trainerApi
      .getRunHistory(runId)
      .then(setTrainHistory)
      .catch(() => setTrainHistory([]));
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    void trainerApi
      .listRunAnalyses(runId)
      .then((r) => setAnalysisIds(r.analysis_ids))
      .catch(() => setAnalysisIds([]));
  }, [runId]);

  const handleDownloadZip = () => {
    if (!runId || !analysisId) return;
    trainerApi.downloadAnalysis(runId, analysisId);
  };

  const orderedAnalysisIds = useMemo(() => {
    const s = new Set(analysisIds);
    if (analysisId) s.add(analysisId);
    return [...s].sort();
  }, [analysisIds, analysisId]);

  const showSampleSwitcher = Boolean(runId && analysisId && orderedAnalysisIds.length > 1);

  const handleSeeAnotherChart = () => {
    if (!runId || !analysisId || orderedAnalysisIds.length < 2) return;
    const idx = orderedAnalysisIds.indexOf(analysisId);
    const i = idx >= 0 ? idx : 0;
    const next = orderedAnalysisIds[(i + 1) % orderedAnalysisIds.length];
    navigate(`/products/trainer/analysis/${runId}/${next}`, { replace: true });
  };

  const derived = useMemo(() => {
    if (!analysisResult) return null;
    const jsonFiles = analysisResult.generated_json_files ?? [];
    const pngFiles = analysisResult.generated_files ?? [];
    const attentionJson = pickAttentionJson(jsonFiles);
    const filterJsons = jsonFiles.filter((f) => /^learned_filters_.+\.json$/.test(f));
    const meanFiles = jsonFiles.filter((f) => /^mean_activation_.+\.json$/.test(f));
    const layers = sortLayerNames(
      meanFiles.map(layerFromMeanActivation).filter((x): x is string => Boolean(x)),
    );
    const hasInputSensitivity = jsonFiles.includes("input_sensitivity.json");
    const hasActivationField = jsonFiles.includes("activation_field.json");
    const hasSaliencyJson = jsonFiles.includes("saliency.json");
    const artifactCount = pngFiles.length + jsonFiles.length;

    return {
      jsonFiles,
      pngFiles,
      attentionJson,
      filterJsons,
      layers,
      hasInputSensitivity,
      hasActivationField,
      hasSaliencyJson,
      artifactCount,
    };
  }, [analysisResult]);

  if (loading) {
    return (
      <PageShell>
        <div className="container-wide pb-24 pt-4">
          <div className="flex min-h-[420px] flex-col items-center justify-center">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-full border-2 border-white/20" />
              <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-white/35" />
            </div>
            <p className="mt-6 text-sm tracking-wide text-white/50">Loading analysis…</p>
          </div>
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <div className="container-wide pb-24 pt-4">
          <div className="mx-auto max-w-lg rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-300/60">Unable to load</p>
            <h1 className="mt-2 text-xl font-semibold text-white">Analysis unavailable</h1>
            <p className="mt-3 text-sm leading-relaxed text-[rgba(255,255,255,0.55)]">{error}</p>
            <Link
              to="/tools/analysis"
              className="mt-8 inline-flex rounded-xl bg-white px-6 py-3 text-sm font-medium text-[#0a0a0a] hover:bg-white/90"
            >
              Back to Analyse
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  if (!analysisResult || !derived || !runId || !analysisId) return null;

  const {
    jsonFiles,
    attentionJson,
    filterJsons,
    layers,
    hasInputSensitivity,
    hasActivationField,
    hasSaliencyJson,
    artifactCount,
  } = derived;

  const supportingCount =
    (hasInputSensitivity ? 1 : 0) + (hasActivationField ? 1 : 0) + (hasSaliencyJson ? 1 : 0);

  const sampleSwitchControl = showSampleSwitcher ? (
    <button
      type="button"
      onClick={handleSeeAnotherChart}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-white/85 transition hover:border-white/25 hover:bg-white/[0.07]"
    >
      <RefreshCw className="h-3.5 w-3.5 opacity-80" aria-hidden />
      See another chart
    </button>
  ) : null;

  return (
    <PageShell>
      <div className="mx-auto max-w-[1400px] px-5 pb-20 pt-4 sm:px-7 lg:px-9 lg:pt-5">
        {/* ─────────────  Dashboard header  ───────────── */}
        <header className="mb-6 flex flex-col gap-4 border-b border-white/[0.06] pb-5 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              to="/tools/analysis"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white transition hover:border-white/20 hover:bg-white/[0.06]"
              aria-label="Back to Analyse"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                Model analysis
              </p>
              <h1 className="mt-1 text-[18px] font-medium tracking-[-0.015em] text-white sm:text-[20px]">
                Run dashboard
              </h1>
              <p className="mt-1 font-mono text-[10.5px] tabular-nums text-white/45">
                run {shortId(runId)} · sample {shortId(analysisId)}
                {analysisResult.status ? ` · ${analysisResult.status}` : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sampleSwitchControl}
            <button
              type="button"
              onClick={handleDownloadZip}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-[#0a0a0a] transition hover:bg-white/90"
            >
              <Download className="h-3.5 w-3.5 opacity-90" />
              Download ({artifactCount})
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-8">
          {/* ─────────────  §1 Training  ───────────── */}
          <AnalysisSection
            number="§ 01"
            eyebrow="Learning curves"
            title="Did the model learn?"
            intro={
              <>
                Training vs. validation every epoch. A widening gap between them is the classic sign of overfitting.
              </>
            }
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
              <DashboardFigure
                number="Fig. 1.1"
                title="Accuracy"
                summary="Share of correctly classified examples per epoch. Both curves should rise and converge."
                tip={
                  <>
                    Training accuracy (bright) uses data the model was fitted to; validation (dim) uses held-out data.
                    A growing gap = overfitting. The purple line is per-class accuracy on label&nbsp;1 — useful for imbalanced datasets.
                  </>
                }
              >
                <AccuracyPlot history={trainHistory} height={TRAINING_CHART_HEIGHT} />
              </DashboardFigure>

              <DashboardFigure
                number="Fig. 1.2"
                title="Loss"
                summary="The quantity the optimizer is minimizing. Lower is better; both curves should fall together."
                tip={
                  <>
                    Loss reacts to confidence — a correct-but-unsure prediction still costs. If training loss keeps
                    falling while validation loss turns up, the model has started learning noise instead of signal.
                  </>
                }
              >
                <LossPlot history={trainHistory} height={TRAINING_CHART_HEIGHT} />
              </DashboardFigure>
            </div>
          </AnalysisSection>

          {/* ─────────────  §2 Attribution  ───────────── */}
          {attentionJson && (
            <AnalysisSection
              number="§ 02"
              eyebrow="Where the model looked"
              title="Spatial attribution"
              intro={
                <>
                  Grad-CAM projects the prediction back onto the input. Bright regions should sit on meaningful price action,
                  not empty margins.
                </>
              }
            >
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-4">
                <DashboardFigure
                  number="Fig. 2.1"
                  title="Grad-CAM & model input"
                  summary="Heatmap (left) vs. the exact image the model saw (right). Mentally overlay them to check if the model is right for the right reasons."
                  tip={
                    <>
                      Bright heatmap patches on empty background or at the frame edge are a red flag — the model may
                      have latched onto a shortcut that won't generalise to new charts.
                    </>
                  }
                >
                  <div className="mx-auto w-full max-w-[720px]">
                    <AttentionWithChart runId={runId} analysisId={analysisId} filename={attentionJson} />
                  </div>
                </DashboardFigure>
              </div>
            </AnalysisSection>
          )}

          {/* ─────────────  §3 Diagnostics  ───────────── */}
          {supportingCount > 0 && (
            <AnalysisSection
              number="§ 03"
              eyebrow="Input-output sensitivity"
              title="Diagnostic fields"
              intro={
                <>
                  Gradient-based views that complement Grad-CAM. If §2 and §3 agree, the attribution is robust.
                </>
              }
            >
              <div
                className={cn(
                  "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:gap-4",
                  supportingCount >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
                )}
              >
                {hasInputSensitivity && (
                  <DashboardFigure
                    number="Fig. 3.1"
                    title="Input sensitivity"
                    summary="How much the output moves when each pixel changes — the model's raw reactivity surface."
                    tip={
                      <>
                        Concentrated hotspots ⇒ relies on a few localised pixels. Flat, diffuse noise ⇒ often a symptom of undertraining.
                      </>
                    }
                  >
                    <MatrixHeatmapPlot
                      runId={runId}
                      analysisId={analysisId}
                      filename="input_sensitivity.json"
                      title="Input sensitivity"
                      hint="|∂out/∂in|"
                      scaleLabel="Sensitivity"
                      className={HEATMAP_TILE_MAX}
                    />
                  </DashboardFigure>
                )}
                {hasActivationField && (
                  <DashboardFigure
                    number="Fig. 3.2"
                    title="Class activation (raw)"
                    summary="The native pre-overlay signal that feeds into Grad-CAM. Sharper = more decisive."
                    tip={
                      <>
                        Localised activations indicate confident feature detection. Activations smeared across the frame
                        mean the model is hedging — many weak cues instead of one strong one.
                      </>
                    }
                  >
                    <MatrixHeatmapPlot
                      runId={runId}
                      analysisId={analysisId}
                      filename="activation_field.json"
                      title="Class activation"
                      hint="pre-overlay"
                      scaleLabel="Activation"
                      className={HEATMAP_TILE_MAX}
                    />
                  </DashboardFigure>
                )}
                {hasSaliencyJson && (
                  <DashboardFigure
                    number="Fig. 3.3"
                    title="Saliency"
                    summary="Gradient-based attribution, normalised to [0, 1] so samples and models are comparable."
                    tip={
                      <>
                        Saliency (gradient-based) vs. Grad-CAM (feature-based): agreement = trustworthy explanation,
                        disagreement = treat the attribution cautiously and inspect more samples.
                      </>
                    }
                  >
                    <MatrixHeatmapPlot
                      runId={runId}
                      analysisId={analysisId}
                      filename="saliency.json"
                      title="Saliency"
                      hint="normalised gradient"
                      scaleLabel="Saliency"
                      className={HEATMAP_TILE_MAX}
                    />
                  </DashboardFigure>
                )}
              </div>
            </AnalysisSection>
          )}

          {/* ─────────────  §4 Filters  ───────────── */}
          {filterJsons.length > 0 && (
            <AnalysisSection
              number="§ 04"
              eyebrow="Learned detectors"
              title="Convolutional filters"
              intro={
                <>
                  Each tile is a single filter in the layer. Early layers → edges &amp; textures; deeper layers → more abstract shapes.
                </>
              }
            >
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-4">
                {filterJsons.map((file, i) => {
                  const slug = layerFromLearnedFilters(file);
                  const layerLabel = slug ? humanizeLayerName(slug) : "Layer";
                  return (
                    <DashboardFigure
                      key={file}
                      number={`Fig. 4.${i + 1}`}
                      title={`${layerLabel} · filters`}
                      summary="Representative filters learned during training. Brighter pixels = the kernel activates on that shape."
                      tip={
                        <>
                          Tiles that all look identical = <em className="not-italic">filter collapse</em>, i.e. wasted capacity.
                          A healthy layer shows visible diversity across channels.
                        </>
                      }
                    >
                      <div
                        className={cn(
                          "rounded-2xl border border-white/[0.07] bg-[#0c0c0e]/80 p-3",
                          FILTER_TILE_MAX,
                        )}
                      >
                        <LearnedFiltersGrid
                          runId={runId}
                          analysisId={analysisId}
                          filename={file}
                        />
                      </div>
                    </DashboardFigure>
                  );
                })}
              </div>
            </AnalysisSection>
          )}

          {/* ─────────────  §5 Layer activations  ───────────── */}
          {layers.length > 0 && (
            <AnalysisSection
              number="§ 05"
              eyebrow="Per-layer responses"
              title="Activations through the stack"
              intro={
                <>
                  How the network lit up as this specific sample passed through. Mean energy aligns with Grad-CAM at deeper layers.
                </>
              }
            >
              <div className="flex flex-col gap-6">
                {layers.map((layer, i) => {
                  const meanFile = `mean_activation_${layer}.json`;
                  const actFile = `activations_${layer}.json`;
                  const hasMean = jsonFiles.includes(meanFile);
                  const hasAct = jsonFiles.includes(actFile);
                  if (!hasMean && !hasAct) return null;
                  const layerLabel = humanizeLayerName(layer);
                  return (
                    <DashboardFigure
                      key={layer}
                      number={`Fig. 5.${i + 1}`}
                      title={`${layerLabel} · activations`}
                      summary="Left: mean energy across all channels. Right: individual channel samples."
                      tip={
                        <>
                          The energy map should spotlight regions the model cares about for this sample — it often matches
                          Grad-CAM. Channel samples should <strong className="font-medium text-white/85">not</strong> look identical;
                          if they do, the layer is underutilised.
                        </>
                      }
                    >
                      <div
                        className={cn(
                          "grid gap-3",
                          hasMean && hasAct ? "sm:grid-cols-[280px_minmax(0,1fr)] sm:items-start" : "grid-cols-1",
                        )}
                      >
                        {hasMean && (
                          <MatrixHeatmapPlot
                            runId={runId}
                            analysisId={analysisId}
                            filename={meanFile}
                            title="Mean energy"
                            hint="channel-averaged"
                            scaleLabel="Energy"
                            className={HEATMAP_TILE_MAX}
                          />
                        )}
                        {hasAct && (
                          <div className="rounded-2xl border border-white/[0.07] bg-[#0c0c0e]/80 p-3">
                            <LearnedFiltersGrid
                              runId={runId}
                              analysisId={analysisId}
                              filename={actFile}
                              title="Channel sample"
                            />
                          </div>
                        )}
                      </div>
                    </DashboardFigure>
                  );
                })}
              </div>
            </AnalysisSection>
          )}

          {/* ─────────────  Empty-state  ───────────── */}
          {!attentionJson && supportingCount === 0 && filterJsons.length === 0 && layers.length === 0 && (
            <p className="rounded-2xl border border-white/[0.08] bg-[#0c0c0e] px-4 py-6 text-center text-sm text-white/45">
              No JSON analysis artifacts for this run. Use Download to inspect exported files.
            </p>
          )}
        </div>

        <div className="mt-10 border-t border-white/[0.06] pt-6">
          <Link
            to="/tools/analysis"
            className="inline-flex rounded-lg border border-white/[0.1] px-4 py-2 text-[13px] font-medium text-white/85 transition hover:border-white/20 hover:bg-white/[0.04]"
          >
            Back to Analyse
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
