import { Download } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewDataset } from "@/lib/api";
import { AuthorizedDownloadLink } from "@/components/AuthorizedDownloadLink";
import { useReview } from "../ReviewContext";
import { formatDate, formatPeriod, int } from "../lib/format";
import { labelingTag } from "../lib/naming";
import { DataTable, type Column } from "../components/DataTable";
import { LibraryToolbar, useLibraryFilter } from "../components/LibraryToolbar";
import { FavoriteToggle } from "../components/LabelEditor";
import { AssetTitle, datasetActions, Symbols } from "../components/assets";
import { ClassBalanceBar } from "../components/ClassBalance";
import { btn, btnSm, Chip, EmptyState, KindTag, Missing, ProvenanceBadge, Tag } from "../components/primitives";

type KindFilter = "all" | "training" | "test" | "archive";

export function DatasetsView() {
  const { data, names, inspect, inspected, patchLabel, canLabel } = useReview();
  const [kind, setKind] = useState<KindFilter>("all");
  const datasets = useMemo(() => data?.datasets ?? [], [data]);

  const hay = useCallback(
    (d: ReviewDataset) => `${names.dataset.get(d.id)} ${d.id} ${d.name ?? ""} ${d.symbols ?? ""} ${d.timeframe ?? ""} ${d.generator_run_id ?? ""}`,
    [names],
  );
  const extra = useCallback(
    (d: ReviewDataset) =>
      kind === "all" ||
      (kind === "archive" ? d.representation === "archive" : d.kind === kind && d.representation !== "archive"),
    [kind],
  );
  const f = useLibraryFilter(datasets, hay, extra);

  if (datasets.length === 0) {
    return <EmptyState title="No datasets yet" body="Generate labelled training charts in the generator, or build a test set in the backtester." />;
  }

  const counts = {
    training: datasets.filter((d) => d.kind === "training" && d.representation !== "archive").length,
    test: datasets.filter((d) => d.kind === "test").length,
    archive: datasets.filter((d) => d.representation === "archive").length,
  };

  const columns: Column<ReviewDataset>[] = [
    {
      id: "fav",
      header: "",
      className: "w-6 pr-0",
      cell: (d) => {
        const ref = { kind: "dataset" as const, id: d.id };
        return <FavoriteToggle on={d.favorite} disabled={!canLabel(ref)} onToggle={() => void patchLabel(ref, { favorite: !d.favorite })} />;
      },
    },
    {
      id: "name",
      header: "Dataset",
      sort: (d) => names.dataset.get(d.id),
      cell: (d) => (
        <div className="max-w-[400px] 2xl:max-w-[340px]">
          <AssetTitle refv={{ kind: "dataset", id: d.id }} id={d.dataset_id ?? d.id} archived={d.archived} />
          {d.tags?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {d.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "kind",
      header: "Role",
      hideBelow: "2xl",
      sort: (d) => d.kind,
      cell: (d) => (
        <div className="flex flex-col items-start gap-0.5">
          <KindTag>{d.kind === "unknown" ? "unclassified" : d.kind}</KindTag>
          <span className="whitespace-nowrap text-[12px] text-white/40">
            {d.representation === "archive"
              ? d.extracted_as?.length
                ? `ZIP · extracted ×${d.extracted_as.length}`
                : "ZIP archive"
              : d.archive_key
                ? "extracted from ZIP"
                : d.catalog_only
                  ? "catalog only"
                  : "image folder"}
          </span>
        </div>
      ),
    },
    {
      id: "market",
      header: "Market",
      hideBelow: "2xl",
      sort: (d) => `${d.symbols ?? ""} ${d.timeframe ?? ""}`,
      cell: (d) => (
        <span className="whitespace-nowrap">
          <Symbols value={d.symbols} />
          {d.timeframe ? <span className="ml-1.5 font-mono text-[12.5px] text-white/45">{d.timeframe}</span> : null}
        </span>
      ),
    },
    {
      id: "period",
      header: "Coverage",
      sort: (d) => d.period_start,
      hint: "Labelling window from the recorded generator config. Values marked ≈ are estimated from a few sample chart filenames.",
      cell: (d) =>
        d.period_start || d.period_end ? (
          <span
            className="whitespace-nowrap font-digits text-[13px] text-white/60"
            title={d.period_source === "sample_filenames" ? "Estimated from sample chart filenames" : undefined}
          >
            {d.period_source === "sample_filenames" ? "≈ " : ""}
            {formatPeriod(d.period_start, d.period_end)}
          </span>
        ) : (
          <Missing />
        ),
    },
    {
      id: "label",
      header: "Labeling",
      hideBelow: "2xl",
      cell: (d) => {
        const t = labelingTag(d.take_profit_fraction, d.stop_loss_fraction, d.horizon_bars);
        return t ? <span className="whitespace-nowrap font-mono text-[13px] text-white/70">{t}</span> : <Missing />;
      },
    },
    { id: "images", header: "Images", align: "right", sort: (d) => d.total_images, cell: (d) => int(d.total_images) },
    { id: "balance", header: "Class balance", cell: (d) => <ClassBalanceBar dist={d.label_distribution} /> },
    {
      id: "source",
      header: "Origin",
      sort: (d) => d.generator_link ?? "",
      cell: (d) =>
        d.generator_run_id ? (
          <ProvenanceBadge p={d.generator_link ?? "recorded"} basis={d.generator_link === "recovered" ? "Matched by chart filenames" : "Generator run id recorded"} />
        ) : (
          <span className="text-[12.5px] text-white/45">{d.source === "uploaded" ? "uploaded" : <Missing text="unknown" />}</span>
        ),
    },
    {
      id: "used",
      header: "Trained",
      hideBelow: "2xl",
      align: "right",
      hint: "Recorded training runs that used this dataset.",
      sort: (d) => d.used_by_training_runs?.length ?? 0,
      cell: (d) => (d.used_by_training_runs?.length ? int(d.used_by_training_runs.length) : <Missing />),
    },
    { id: "created", header: "Created", sort: (d) => d.created_at, cell: (d) => <span className="whitespace-nowrap text-[13px] text-white/50" title={formatDate(d.created_at)}>{formatDate(d.created_at, false)}</span> },
    {
      id: "actions",
      header: "",
      cell: (d) => (
        <div className="flex items-center justify-end gap-1.5">
          {datasetActions(d)
            .slice(0, 1)
            .map((a) => (
              <Link key={a.to} to={a.to} className={btnSm} title={a.label}>
                {a.label === "Generator run" ? "Run" : a.label.replace(/ on it$/, "")}
              </Link>
            ))}
          {d.download_url ? (
            <AuthorizedDownloadLink path={d.download_url} filename={`${d.dataset_id || d.generator_run_id || "dataset"}.zip`} className={btnSm} title="Download ZIP">
              <Download className="h-3.5 w-3.5" />
            </AuthorizedDownloadLink>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <LibraryToolbar f={f} noun="datasets" total={datasets.length}>
        <Chip active={kind === "all"} onClick={() => setKind("all")}>
          All
        </Chip>
        <Chip active={kind === "training"} onClick={() => setKind("training")}>
          Training <span className="font-digits text-white/40">{counts.training}</span>
        </Chip>
        <Chip active={kind === "test"} onClick={() => setKind("test")}>
          Test <span className="font-digits text-white/40">{counts.test}</span>
        </Chip>
        <Chip active={kind === "archive"} onClick={() => setKind("archive")}>
          Archives <span className="font-digits text-white/40">{counts.archive}</span>
        </Chip>
      </LibraryToolbar>
      <DataTable
        ariaLabel="Dataset library"
        rows={f.filtered}
        rowKey={(d) => d.id}
        columns={columns}
        activeKey={inspected?.kind === "dataset" ? inspected.id : null}
        onActivate={(d) => inspect({ kind: "dataset", id: d.id })}
        defaultSort={{ id: "created", dir: "desc" }}
        rowClassName={(d) => (d.archived ? "opacity-60" : undefined)}
        minWidth={1080}
      />
      <p className="mt-3 text-[13px] leading-relaxed text-white/40">
        A generator ZIP and the image folder extracted from it are listed separately and linked — they are never merged. Labels can be edited on extracted datasets.
      </p>
    </div>
  );
}
