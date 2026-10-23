import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Download, ExternalLink, X } from "lucide-react";
import { btnSm, cx, KV, Panel, surface } from "@/features/review/components/primitives";
import { inputCls } from "@/features/lab/components";
import { useAuthedObjectUrl } from "@/features/lab/maps";
import { fmtInt, fmtNum, fmtPct } from "@/lib/viz/format";
import { SEMANTIC } from "@/lib/viz/tokens";
import { backtestApi, type Page, type Trade, type TradeQuery, type V2Summary } from "../api";
import { useWorkspace } from "../BacktestWorkspace";
import { fmtDay, fmtMoney, fmtSignedPct } from "../ui";

const PAGE = 50;

const COLUMNS: { key: keyof Trade; label: string; render: (t: Trade) => string; align?: "right" }[] = [
  { key: "entry_ts", label: "Entry", render: (t) => fmtDay(t.entry_ts) },
  { key: "symbol", label: "Symbol", render: (t) => t.symbol },
  { key: "prob", label: "Prob.", render: (t) => fmtNum(t.prob, 3), align: "right" },
  { key: "entry_fill", label: "Entry fill", render: (t) => fmtNum(t.entry_fill, 2), align: "right" },
  { key: "exit_ts", label: "Exit", render: (t) => (t.status === "open_at_end" ? "open" : fmtDay(t.exit_ts)) },
  { key: "exit_reason", label: "Reason", render: (t) => (t.exit_reason ? t.exit_reason.toUpperCase() : "—") },
  { key: "bars_held", label: "Bars", render: (t) => fmtInt(t.bars_held), align: "right" },
  { key: "net_return", label: "Net return", render: (t) => fmtSignedPct(t.net_return, 2), align: "right" },
  { key: "net_pnl", label: "Net P&L", render: (t) => fmtMoney(t.net_pnl, 2), align: "right" },
];

/** Analysis Lab deep link for the chart that produced a trade. */
export function labLink(summary: V2Summary, imageId: string): string | null {
  const m = summary.model;
  const model = m.trainer_run_id ? `trained:${m.trainer_run_id}` : m.model_id ? `uploaded:${m.model_id}` : null;
  if (!model || !summary.dataset.dataset_id) return null;
  const p = new URLSearchParams({ model, dataset: summary.dataset.dataset_id, tab: "explorer", image: imageId });
  return `/tools/analysis?${p.toString()}`;
}

export default function TradesTab() {
  const { runId, summary } = useWorkspace();
  const [q, setQ] = useState<TradeQuery>({ sort: "entry_ts", order: "asc" });
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<Trade> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Trade | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQ((c) => ({ ...c, q: search || undefined })), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setOffset(0), [q]);
  useEffect(() => {
    let alive = true;
    setErr(null);
    backtestApi
      .trades(runId, { ...q, offset, limit: PAGE })
      .then((p) => alive && setPage(p))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Could not load trades"));
    return () => {
      alive = false;
    };
  }, [runId, q, offset]);

  const set = (patch: TradeQuery) => setQ((c) => ({ ...c, ...patch }));
  const toggleSort = (key: string) => setQ((c) => ({ ...c, sort: key, order: c.sort === key && c.order === "asc" ? "desc" : "asc" }));
  const total = page?.total ?? 0;

  return (
    <div className="space-y-5">
      <Panel
        title="Executed trades"
        description="One row per simulated position. Filters run on the server; the CSV export contains every trade."
        aside={
          <div className="flex gap-2">
            <button type="button" className={btnSm} onClick={() => void backtestApi.downloadArtifact(runId, "trades")}>
              <Download className="h-3.5 w-3.5" /> Trades CSV
            </button>
            <button type="button" className={btnSm} onClick={() => void backtestApi.downloadArtifact(runId, "skipped")}>
              <Download className="h-3.5 w-3.5" /> Skipped CSV
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-3 lg:grid-cols-6">
          <input className={inputCls} placeholder="Search sample or symbol" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search trades" />
          <select className={inputCls} value={q.symbol ?? ""} onChange={(e) => set({ symbol: e.target.value || undefined })} aria-label="Symbol">
            <option value="">All symbols</option>
            {summary.dataset.symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className={inputCls} value={q.exit_reason ?? ""} onChange={(e) => set({ exit_reason: e.target.value || undefined })} aria-label="Exit reason">
            <option value="">Any exit</option>
            <option value="tp">Take profit</option>
            <option value="sl">Stop loss</option>
            <option value="timeout">Timeout</option>
          </select>
          <select className={inputCls} value={q.outcome ?? ""} onChange={(e) => set({ outcome: (e.target.value || undefined) as TradeQuery["outcome"] })} aria-label="Outcome">
            <option value="">Wins and losses</option>
            <option value="win">Net winners</option>
            <option value="loss">Net losers</option>
          </select>
          <input className={inputCls} type="date" value={q.date_from ?? ""} onChange={(e) => set({ date_from: e.target.value || undefined })} aria-label="Entry from" />
          <input className={inputCls} type="date" value={q.date_to ?? ""} onChange={(e) => set({ date_to: e.target.value || undefined })} aria-label="Entry to" />
        </div>
        {err ? <p className="px-4 pb-3 text-[13px] text-red-300/90">{err}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="text-left text-[12px] text-white/45">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={cx("px-3 py-2 font-normal first:pl-4", c.align === "right" && "text-right")}>
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-white">
                      {c.label}
                      {q.sort === c.key ? q.order === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" /> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-digits tabular-nums">
              {(page?.rows ?? []).map((t) => (
                <tr
                  key={t.sample_id}
                  onClick={() => setOpen(t)}
                  className={cx("cursor-pointer border-t border-white/[0.06] text-white/75 transition hover:bg-white/[0.03]", open?.sample_id === t.sample_id && "bg-white/[0.05]")}
                >
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={cx("px-3 py-1.5 first:pl-4", c.align === "right" && "text-right")}
                      style={c.key === "net_return" && t.net_return != null ? { color: t.net_return > 0 ? SEMANTIC.positive : SEMANTIC.negative } : undefined}
                    >
                      {c.render(t)}
                    </td>
                  ))}
                </tr>
              ))}
              {page && !page.rows.length ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-6 text-center font-sans text-white/40">No trades match these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 pt-3 text-[12.5px] text-white/50">
          <span>{total ? `${fmtInt(offset + 1)}–${fmtInt(Math.min(offset + PAGE, total))} of ${fmtInt(total)}` : "0 trades"}</span>
          <div className="flex gap-2">
            <button type="button" className={btnSm} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <button type="button" className={btnSm} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        </div>
      </Panel>
      {open ? <TradeDrawer trade={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function TradeDrawer({ trade: t, onClose }: { trade: Trade; onClose: () => void }) {
  const { runId, summary } = useWorkspace();
  const img = useAuthedObjectUrl(backtestApi.imagePath(runId, t.sample_id));
  const lab = useMemo(() => labLink(summary, t.sample_id), [summary, t.sample_id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Trade ${t.sample_id}`}>
      <aside className={cx(surface, "h-full w-full max-w-[520px] overflow-y-auto rounded-none border-y-0 border-r-0 p-5")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] text-white/45">{t.symbol} · probability {fmtNum(t.prob, 3)}</p>
            <h2 className="mt-0.5 truncate font-digits text-[15px] text-white" title={t.sample_id}>{t.sample_id}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-white/50 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.08] bg-black/40">
          {img ? <img src={img} alt={`Input chart ${t.sample_id}`} className="mx-auto block max-h-[300px] w-auto" /> : <div className="flex h-48 items-center justify-center text-[12.5px] text-white/35">Chart image unavailable</div>}
        </div>
        <p className="mt-1.5 text-[11.5px] text-white/35">The model input. It ends at the decision bar; nothing after it is drawn.</p>
        {lab ? (
          <Link to={lab} className={cx(btnSm, "mt-3 w-full justify-center")}>
            <ExternalLink className="h-3.5 w-3.5" /> Open in Analysis Lab
          </Link>
        ) : null}
        <div className="mt-5">
          <KV
            cols={2}
            rows={[
              ["Decision", fmtDay(t.decision_ts), "Close of the last bar in the chart."],
              ["Entry", fmtDay(t.entry_ts), "Next bar's open."],
              ["Open / fill", `${fmtNum(t.entry_open, 2)} / ${fmtNum(t.entry_fill, 2)}`, "Fill includes slippage."],
              ["Shares", fmtNum(t.shares, 4)],
              ["Notional", fmtMoney(t.notional, 2)],
              ["Target / stop", `${fmtNum(t.tp_price, 2)} / ${fmtNum(t.sl_price, 2)}`],
              ["Exit", t.status === "open_at_end" ? "Open at the end" : `${fmtDay(t.exit_ts)} · ${t.exit_reason?.toUpperCase() ?? "—"}`],
              ["Exit price / fill", t.exit_price != null ? `${fmtNum(t.exit_price, 2)} / ${fmtNum(t.exit_fill, 2)}` : "—"],
              ["Bars held", fmtInt(t.bars_held)],
              ["Gross return", fmtSignedPct(t.gross_return, 2), "Raw prices, before slippage and commission."],
              ["Commission", fmtMoney(t.commission, 2)],
              ["Slippage", fmtMoney(t.slippage_cost, 2)],
              ["Net P&L", t.status === "open_at_end" ? `${fmtMoney(t.unrealized_pnl, 2)} unrealized` : fmtMoney(t.net_pnl, 2)],
              ["Net return", fmtSignedPct(t.net_return, 2)],
              ["Label", t.label == null ? "—" : `Label ${t.label}`, "Label from the dataset definition, not the trade result."],
              ["Flags", t.flags.length ? t.flags.join(", ").replace(/_/g, " ") : "None"],
            ]}
          />
          {t.label === 1 && t.net_pnl != null && t.net_pnl <= 0 ? (
            <p className="mt-3 text-[12.5px] text-white/50">Labelled 1 but lost money after costs: the label counts a target hit, the trade pays commission and slippage on both sides.</p>
          ) : null}
          <p className="mt-3 text-[12px] text-white/35">Position size {fmtPct(Number(summary.config.position_size_pct) / 100)} of equity at the prior close.</p>
        </div>
      </aside>
    </div>
  );
}
