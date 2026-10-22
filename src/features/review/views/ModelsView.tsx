import { Download, GitCompare } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewModel } from "@/lib/api";
import { AuthorizedDownloadLink } from "@/components/AuthorizedDownloadLink";
import { useReview } from "../ReviewContext";
import { formatDate, int, pctFrac } from "../lib/format";
import { labelingTag } from "../lib/naming";
import { DataTable, type Column } from "../components/DataTable";
import { LibraryToolbar, useLibraryFilter } from "../components/LibraryToolbar";
import { FavoriteToggle } from "../components/LabelEditor";
import { AssetTitle, backtestRouteForModel, deployRouteForModel, Symbols } from "../components/assets";
import { btn, btnSm, Chip, EmptyState, KindTag, Missing, Tag } from "../components/primitives";

export function ModelsView() {
  const { data, names, graph, inspect, inspected, compare, toggleCompare, setTab, patchLabel } = useReview();
  const [source, setSource] = useState<"all" | "trained" | "uploaded">("all");
  const models = useMemo(() => data?.models ?? [], [data]);

  const usage = useMemo(() => {
    const out = new Map<string, { backtests: number; analyses: number; bots: number }>();
    for (const m of models) {
      const keys = [`model:${m.id}`];
      const u = { backtests: 0, analyses: 0, bots: 0 };
      for (const k of keys)
        for (const e of graph.out.get(k) ?? []) {
          if (e.relation === "backtested") u.backtests++;
          else if (e.relation === "analyzed") u.analyses++;
          else if (e.relation === "deployed_as") u.bots++;
        }
      out.set(m.id, u);
    }
    return out;
  }, [models, graph]);

  const hay = useCallback(
    (m: ReviewModel) => `${names.model.get(m.id)} ${m.id} ${m.auto_name ?? ""} ${m.symbols ?? ""} ${m.timeframe ?? ""} ${m.training_run_id ?? ""}`,
    [names],
  );
  const extra = useCallback((m: ReviewModel) => source === "all" || m.source === source, [source]);
  const f = useLibraryFilter(models, hay, extra);

  const selected = new Set(compare.filter((c) => c.kind === "model").map((c) => c.id));

  if (models.length === 0) {
    return <EmptyState title="No models in the library" body="Train a model in the trainer, or upload a .keras file in the backtester. Models appear here with their training data and evaluation history." />;
  }

  const columns: Column<ReviewModel>[] = [
    {
      id: "fav",
      header: "",
      cell: (m) => <FavoriteToggle on={m.favorite} onToggle={() => void patchLabel({ kind: "model", id: m.id }, { favorite: !m.favorite })} />,
      className: "w-6 pr-0",
    },
    {
      id: "name",
      header: "Model",
      sort: (m) => names.model.get(m.id),
      cell: (m) => (
        <div className="max-w-[340px]">
          <AssetTitle refv={{ kind: "model", id: m.id }} archived={m.archived} />
          {m.tags?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "source",
      header: "Source",
      sort: (m) => m.source,
      cell: (m) => (
        <div className="flex flex-col items-start gap-0.5">
          <KindTag>{m.source}</KindTag>
          {m.catalog_only ? <span className="text-[12px] text-white/40">catalog only</span> : null}
        </div>
      ),
    },
    {
      id: "market",
      header: "Market",
      hideBelow: "2xl",
      sort: (m) => `${m.symbols ?? ""} ${m.timeframe ?? ""}`,
      cell: (m) => (
        <span className="whitespace-nowrap">
          <Symbols value={m.symbols} />
          {m.timeframe ? <span className="ml-1.5 font-mono text-[12.5px] text-white/45">{m.timeframe}</span> : null}
        </span>
      ),
    },
    {
      id: "label",
      header: "Labeling",
      hideBelow: "2xl",
      hint: "Take-profit / stop-loss used to label the training charts, and horizon in bars.",
      cell: (m) => {
        const t = labelingTag(m.take_profit_fraction, m.stop_loss_fraction, m.horizon_bars);
        return t ? <span className="whitespace-nowrap font-mono text-[13px] text-white/70">{t}</span> : <Missing />;
      },
    },
    {
      id: "val",
      header: "Val acc",
      hint: "Final-epoch accuracy on the held-out validation split. Not a trading result.",
      align: "right",
      sort: (m) => m.metrics?.val_accuracy,
      cell: (m) => <span className="text-white">{pctFrac(m.metrics?.val_accuracy)}</span>,
    },
    {
      id: "train",
      header: "Train acc",
      hint: "Final-epoch accuracy on the training split (in-sample).",
      align: "right",
      sort: (m) => m.metrics?.accuracy,
      cell: (m) => <span className="text-white/50">{pctFrac(m.metrics?.accuracy)}</span>,
    },
    {
      id: "epochs",
      header: "Epochs",
      hideBelow: "2xl",
      align: "right",
      sort: (m) => m.metrics?.epochs_trained ?? m.training?.epochs_trained,
      cell: (m) => int(m.metrics?.epochs_trained ?? m.training?.epochs_trained),
    },
    {
      id: "usage",
      header: "Used in",
      hint: "Recorded backtests, analyses and deployments only.",
      sort: (m) => {
        const u = usage.get(m.id)!;
        return u.backtests + u.analyses + u.bots;
      },
      cell: (m) => {
        const u = usage.get(m.id)!;
        const parts = [u.backtests && `${u.backtests} BT`, u.analyses && `${u.analyses} AN`, u.bots && `${u.bots} bot`].filter(Boolean);
        return parts.length ? <span className="font-digits text-[13px] text-white/65">{parts.join(" · ")}</span> : <Missing />;
      },
    },
    { id: "created", header: "Created", sort: (m) => m.created_at, cell: (m) => <span className="whitespace-nowrap text-[13px] text-white/50" title={formatDate(m.created_at)}>{formatDate(m.created_at, false)}</span> },
    {
      id: "actions",
      header: "",
      cell: (m) => (
        <div className="flex items-center justify-end gap-1.5">
          <Link to={backtestRouteForModel(m)} className={btnSm}>
            Backtest
          </Link>
          <Link to={deployRouteForModel(m)} className={btnSm}>
            Deploy
          </Link>
          {m.download_url ? (
            <AuthorizedDownloadLink path={m.download_url} filename={m.auto_name || `${m.id}.keras`} className={btnSm} title="Download .keras">
              <Download className="h-3.5 w-3.5" />
            </AuthorizedDownloadLink>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <LibraryToolbar
        f={f}
        noun="models"
        total={models.length}
        right={
          <button type="button" className={btn} disabled={selected.size < 2} onClick={() => setTab("compare")}>
            <GitCompare className="h-4 w-4" /> Compare {selected.size ? `(${selected.size})` : ""}
          </button>
        }
      >
        {(["all", "trained", "uploaded"] as const).map((s) => (
          <Chip key={s} active={source === s} onClick={() => setSource(s)}>
            {s === "all" ? "All sources" : s === "trained" ? "Trained" : "Uploaded"}
          </Chip>
        ))}
      </LibraryToolbar>
      <DataTable
        ariaLabel="Model library"
        rows={f.filtered}
        rowKey={(m) => m.id}
        columns={columns}
        activeKey={inspected?.kind === "model" ? inspected.id : null}
        onActivate={(m) => inspect({ kind: "model", id: m.id })}
        selected={selected}
        onToggleSelect={(m) => toggleCompare({ kind: "model", id: m.id })}
        defaultSort={{ id: "created", dir: "desc" }}
        rowClassName={(m) => (m.archived ? "opacity-60" : undefined)}
        minWidth={1060}
      />
      <p className="mt-3 text-[13px] leading-relaxed text-white/40">
        Select rows (Space) to compare · Enter opens the inspector · ↑/↓ moves between rows. Accuracy is classification agreement, not profitability.
      </p>
    </div>
  );
}
