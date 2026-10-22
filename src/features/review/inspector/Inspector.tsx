import { Check, Copy, Crosshair, Download, GitCompare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { ReviewRun } from "@/lib/api";
import { AuthorizedDownloadLink } from "@/components/AuthorizedDownloadLink";
import { refKey, useReview, type Asset } from "../ReviewContext";
import { TOOL_LABELS } from "../lib/naming";
import { useAssetDetail } from "../useAssetDetail";
import { backtestRouteForModel, datasetActions, deployRouteForModel, useRunRoute } from "../components/assets";
import { LabelEditor } from "../components/LabelEditor";
import { btn, KindTag } from "../components/primitives";
import { LinkedAssets, Section } from "./sections";
import { BotPanel, DatasetPanel, ModelPanel, RunPanel } from "./panels";

function kindLabel(a: Asset): string {
  if (a.kind === "run") return TOOL_LABELS[a.item.tool] ?? a.item.tool;
  if (a.kind === "dataset") return a.item.representation === "archive" ? "Dataset archive" : a.item.kind === "test" ? "Test set" : "Dataset";
  if (a.kind === "bot") return "Deployed bot";
  return a.item.source === "uploaded" ? "Uploaded model" : "Model";
}

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 font-mono text-[12px] text-white/40 transition hover:text-white/80"
      onClick={() => {
        void navigator.clipboard?.writeText(id).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      title="Copy id"
    >
      {id}
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/** Rendered on <body> so the drawer stacks above the workspace shell and job banners. */
export function Inspector() {
  return createPortal(<InspectorPanel />, document.body);
}

function InspectorPanel() {
  const { inspected, inspect, find, titleOf, names, canLabel, patchLabel, compare, toggleCompare, showLineage } = useReview();
  const routeFor = useRunRoute();
  const panelRef = useRef<HTMLElement>(null);
  const asset = inspected ? find(inspected) : null;

  const detailKind = asset && asset.kind !== "bot" ? asset.kind : null;
  const { detail, loading, error } = useAssetDetail(detailKind, asset && asset.kind !== "bot" ? asset.item.id : null);

  useEffect(() => {
    if (!inspected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input,textarea")) inspect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspected, inspect]);

  useEffect(() => {
    if (asset) panelRef.current?.focus({ preventScroll: true });
    // focus only when the inspected asset changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspected?.kind, inspected?.id]);

  if (!inspected) return null;

  if (!asset) {
    return (
      <aside className="fixed inset-y-0 right-0 z-50 flex font-sans text-white w-[min(580px,94vw)] flex-col border-l border-white/[0.1] bg-black shadow-[-32px_0_80px_rgba(0,0,0,0.85)]" aria-label="Asset inspector">
        <div className="flex items-center justify-between px-6 py-5">
          <p className="text-[15px] font-medium text-white/80">Asset not found in this workspace</p>
          <button type="button" onClick={() => inspect(null)} className="text-white/50 hover:text-white" aria-label="Close inspector">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-6 text-[13.5px] leading-relaxed text-white/45">
          <span className="font-mono">{refKey(inspected)}</span> is not owned by this account or no longer exists.
        </p>
      </aside>
    );
  }

  const ref = { kind: asset.kind, id: asset.item.id };
  const nodeKey = refKey(ref);
  const title = titleOf(ref);
  const derived = names.derived.get(nodeKey);
  const labelable = canLabel(ref);
  const comparable = asset.kind === "model" || (asset.kind === "run" && asset.item.tool === "backtester");
  const inCompare = compare.some((c) => refKey(c) === nodeKey);

  const actions: JSX.Element[] = [];
  if (asset.kind === "run") {
    actions.push(
      <Link key="open" to={routeFor(asset.item as ReviewRun)} className={btn}>
        Open in {TOOL_LABELS[asset.item.tool]?.toLowerCase() ?? "tool"}
      </Link>,
    );
    if (asset.item.download_zip_url && asset.item.status === "succeeded")
      actions.push(
        <AuthorizedDownloadLink key="dl" path={asset.item.download_zip_url} filename={`${asset.item.id}.zip`} className={btn}>
          <Download className="h-4 w-4" /> Outputs
        </AuthorizedDownloadLink>,
      );
  } else if (asset.kind === "model") {
    actions.push(
      <Link key="bt" to={backtestRouteForModel(asset.item)} className={btn}>
        Backtest
      </Link>,
      <Link key="dep" to={deployRouteForModel(asset.item)} className={btn}>
        Deploy
      </Link>,
    );
    if (asset.item.download_url)
      actions.push(
        <AuthorizedDownloadLink key="dl" path={asset.item.download_url} filename={asset.item.auto_name || `${asset.item.id}.keras`} className={btn}>
          <Download className="h-4 w-4" /> .keras
        </AuthorizedDownloadLink>,
      );
  } else if (asset.kind === "dataset") {
    for (const a of datasetActions(asset.item))
      actions.push(
        <Link key={a.to} to={a.to} className={btn}>
          {a.label}
        </Link>,
      );
    if (asset.item.download_url)
      actions.push(
        <AuthorizedDownloadLink key="dl" path={asset.item.download_url} filename={`${asset.item.dataset_id || asset.item.generator_run_id || "dataset"}.zip`} className={btn}>
          <Download className="h-4 w-4" /> ZIP
        </AuthorizedDownloadLink>,
      );
  } else if (asset.kind === "bot") {
    actions.push(
      <Link key="bot" to={`/dashboard/bots/${asset.item.id}`} className={btn}>
        Open bot
      </Link>,
    );
  }

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-50 flex font-sans text-white w-[min(580px,94vw)] flex-col border-l border-white/[0.1] bg-black shadow-[-32px_0_80px_rgba(0,0,0,0.85)] outline-none"
      aria-label={`Inspector: ${title}`}
    >
      <header className="shrink-0 border-b border-white/[0.08] px-6 pb-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <KindTag>{kindLabel(asset)}</KindTag>
            <h2 className="mt-2.5 text-[20px] font-semibold leading-snug tracking-tight text-white">{title}</h2>
            {asset.kind !== "bot" && asset.item.display_name && derived ? <p className="mt-1 text-[13.5px] text-white/45">{derived}</p> : null}
            <div className="mt-1.5">
              <CopyId id={asset.item.id} />
            </div>
          </div>
          <button type="button" onClick={() => inspect(null)} className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/[0.08] hover:text-white" aria-label="Close inspector (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {actions}
          {comparable ? (
            <button type="button" className={btn} aria-pressed={inCompare} onClick={() => toggleCompare(ref)}>
              <GitCompare className="h-4 w-4" /> {inCompare ? "In comparison" : "Compare"}
            </button>
          ) : null}
          <button type="button" className={btn} onClick={() => showLineage(nodeKey)}>
            <Crosshair className="h-4 w-4" /> Lineage
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        {asset.kind === "model" ? <ModelPanel m={asset.item} detail={detail} loading={loading} error={error} /> : null}
        {asset.kind === "run" ? <RunPanel r={asset.item} detail={detail} loading={loading} error={error} /> : null}
        {asset.kind === "dataset" ? <DatasetPanel d={asset.item} detail={detail} loading={loading} error={error} /> : null}
        {asset.kind === "bot" ? <BotPanel b={asset.item} /> : null}

        <Section title="Lineage">
          <LinkedAssets nodeKey={nodeKey} />
        </Section>

        {labelable && asset.kind !== "bot" ? (
          <Section title="Organisation">
            <LabelEditor item={asset.item} derivedName={derived ?? title} onPatch={(p) => patchLabel(ref, p)} />
          </Section>
        ) : asset.kind === "dataset" ? (
          <Section title="Organisation">
            <p className="text-[13.5px] text-white/45">Labels can be set on the extracted dataset; generator archives are identified by their run.</p>
          </Section>
        ) : null}
      </div>
    </aside>
  );
}
