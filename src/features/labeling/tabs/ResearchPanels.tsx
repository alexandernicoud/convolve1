import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Database } from "lucide-react";
import { btnSm, cx } from "@/features/review/components/primitives";
import { fmtFrac, fmtPct, nearestIndex, type Tone } from "../lib";
import {
  FLAG_COPY,
  generatorTransferHref,
  RANK_MODES,
  researchCell,
  sortCandidates,
  type Candidate,
  type RankMode,
  type SortKey,
} from "../research";
import { Card, TONE_TEXT } from "../ui";
import { useResults, type CellIdx } from "../state";

const pct = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`);
const num = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }));

function Row({ k, v, tone, title }: { k: string; v: string; tone?: Tone; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <dt className="text-white/45">{k}</dt>
      <dd className={cx("font-digits tabular-nums", tone ? TONE_TEXT[tone] : "text-white/85")}>{v}</dd>
    </div>
  );
}

/** The candidate entry for a grid cell, when it is among the exported top candidates. */
export function useCandidateAt(c: CellIdx | null): Candidate | null {
  const { candidates } = useResults();
  return useMemo(() => {
    if (!c || !candidates) return null;
    return candidates.candidates.find((x) => x.index.hi === c.hi && x.index.si === c.si && x.index.ti === c.ti) ?? null;
  }, [candidates, c]);
}

/** Research-period diagnostics of the selected cell (methodology v2 runs). */
export function CellDiagnostics({ at }: { at: CellIdx }) {
  const { research, candidates } = useResults();
  const cand = useCandidateAt(at);
  if (!research) return null;
  const g = (name: Parameters<typeof researchCell>[1]) => researchCell(research, name, at.hi, at.si, at.ti);
  const share = g("label1_share");
  const samples = g("samples");
  const net = g("net_return_bp");
  const lift = g("required_lift");
  const evalShare = g("eval_label1_share");
  const evalSamples = g("eval_samples");
  const evalNet = g("eval_net_return_bp");
  const hasEval = Boolean(candidates?.periods.evaluation);
  return (
    <>
      <p className="mt-3 border-t border-white/[0.07] pt-2.5 text-[12px] text-white/40">Training labels · research period</p>
      <dl className="mt-1.5 space-y-1.5 text-[12.5px]">
        <Row k="CNN suitability" v={num(g("suitability"))} title="0–100; see the score definition below the candidate table" />
        <Row k="Robustness" v={num(g("robustness"))} />
        <Row k="Label 1 · label 0" v={share == null ? "—" : `${pct(share)} · ${pct(1 - share)}`} tone={share != null && Math.min(share, 1 - share) < 0.1 ? "warn" : undefined} />
        <Row k="Usable samples" v={num(samples)} title="Decision bars whose outcome is known inside the research period" />
        <Row k="Non-overlapping windows" v={num(g("independent"))} title="Samples ÷ mean bars held; consecutive samples share most of their future bars" />
        <Row k="Label-1 share range over time" v={g("block_range") == null ? "—" : `${pct(g("block_range"))} pts`} title="Max − min label-1 share across four chronological blocks" />
        <Row k="Net return per sample" v={net == null ? "—" : fmtPct(net * 100, 2, true)} tone={net != null && net < 0 ? "bad" : undefined} title="Average outcome after round-trip costs, all samples" />
        <Row
          k="Precision needed vs base rate"
          v={lift == null ? "TP below costs" : `${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(0)} pts`}
          tone={lift == null ? "bad" : undefined}
          title="Break-even precision of label-1 predictions minus the label-1 share"
        />
      </dl>
      {hasEval ? (
        <>
          <p className="mt-3 border-t border-white/[0.07] pt-2.5 text-[12px] text-white/40">Evaluation period · not used for ranking</p>
          <dl className="mt-1.5 space-y-1.5 text-[12.5px]">
            <Row k="Label 1 share" v={pct(evalShare)} />
            <Row k="Usable samples" v={num(evalSamples)} />
            <Row k="Net return per sample" v={evalNet == null ? "—" : fmtPct(evalNet * 100, 2, true)} tone={evalNet != null && evalNet < 0 ? "bad" : undefined} />
            {cand?.evaluation?.profitability_cagr_pct != null ? <Row k="Portfolio CAGR" v={fmtPct(cand.evaluation.profitability_cagr_pct, 1, true)} /> : null}
          </dl>
        </>
      ) : null}
      {cand?.flags.length ? (
        <ul className="mt-2.5 space-y-0.5 text-[12px] leading-snug text-amber-200/80">
          {cand.flags.map((f) => (
            <li key={f}>{FLAG_COPY[f] ?? f}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Opens the Generator prefilled with this cell; it never starts a generation. */
export function GenerateDatasetLink({ at, className }: { at: CellIdx; className?: string }) {
  const { surface, runId, symbol, rankMode, candidates, audit, metrics } = useResults();
  if (!surface || !symbol) return null;
  const research = candidates?.periods.research;
  const href = generatorTransferHref({
    runId,
    symbol,
    timeframe: "1d",
    tp: surface.tp[at.ti]!,
    sl: surface.sl[at.si]!,
    h: surface.horizons[at.hi]!,
    mode: rankMode,
    researchStart: research?.start ?? audit?.start ?? metrics?.start,
    researchEnd: research?.end ?? audit?.end ?? metrics?.end,
    methodologyVersion: candidates?.version,
  });
  return (
    <Link to={href} className={cx(btnSm, className)} title="Opens the Generator with these values filled in. Nothing is generated until you start it.">
      <Database className="h-3.5 w-3.5" /> Generate dataset with these settings
    </Link>
  );
}

// ------------------------------------------------------------------
// Candidate table
// ------------------------------------------------------------------

const COLUMNS: { key: SortKey; label: string; title: string; render: (c: Candidate) => string; desc: boolean }[] = [
  { key: "suitability", label: "Suitability", title: "CNN label suitability, 0–100", render: (c) => num(c.scores.suitability), desc: true },
  { key: "robustness", label: "Robust.", title: "Robustness, 0–100", render: (c) => num(c.scores.robustness), desc: true },
  { key: "profitability", label: "CAGR", title: "Historical profitability (research period)", render: (c) => fmtPct(c.scores.profitability_cagr_pct, 1, true), desc: true },
  { key: "label1_share", label: "Label 1", title: "Share of label-1 samples", render: (c) => pct(c.research.label1_share), desc: true },
  { key: "samples", label: "Samples", title: "Usable samples in the research period", render: (c) => num(c.research.samples), desc: true },
  { key: "independent", label: "Non-overl.", title: "Non-overlapping windows (samples ÷ mean bars held)", render: (c) => num(c.research.independent), desc: true },
  { key: "block_range", label: "Time range", title: "Label-1 share range across four chronological blocks (lower is steadier)", render: (c) => pct(c.research.block_range), desc: false },
  { key: "net_return", label: "Net/sample", title: "Average net return per sample after costs", render: (c) => fmtPct(c.research.net_return_per_sample_pct, 2, true), desc: true },
  { key: "required_lift", label: "Lift needed", title: "Break-even precision minus label-1 share (lower is easier)", render: (c) => (c.research.required_lift == null ? "—" : `${(c.research.required_lift * 100).toFixed(0)} pts`), desc: false },
];

export function CandidateTable() {
  const { candidates, rankMode, surface, select, cell, hIndex } = useResults();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "rank", desc: true });
  const hasEval = Boolean(candidates?.periods.evaluation);
  const rows = useMemo(() => {
    if (!candidates) return [];
    const inMode = candidates.candidates.filter((c) => c.ranks[rankMode] != null && c.ranks[rankMode]! <= 20);
    return sortCandidates(inMode, sort.key, sort.desc, rankMode);
  }, [candidates, rankMode, sort]);
  if (!candidates || !surface) return null;
  const doc = candidates.scores[rankMode];
  const header = (key: SortKey, label: string, title: string, desc: boolean) => (
    <th key={key} scope="col" className="px-2 py-2 text-right font-normal" aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        title={title}
        onClick={() => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc }))}
        className={cx("whitespace-nowrap transition hover:text-white", sort.key === key ? "text-white" : "text-white/45")}
      >
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  const selKey = cell ? `${hIndex}-${cell.si}-${cell.ti}` : "";
  return (
    <Card
      title="Top candidates"
      note={`The 20 highest-ranked cells under ${RANK_MODES.find((m) => m.value === rankMode)!.label.toLowerCase()} (ranking set above the heatmap), research period only. Click a column to sort by that metric; click a row to select the cell.`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-[12.5px]">
          <thead className="border-b border-white/[0.08] text-[12px]">
            <tr>
              {header("rank", "#", "Rank under the selected mode", true)}
              <th scope="col" className="px-2 py-2 text-left font-normal text-white/45">
                TP · SL · horizon
              </th>
              {COLUMNS.map((c) => header(c.key, c.label, c.title, c.desc))}
              {hasEval ? header("eval_label1_share", "Eval label 1", "Label-1 share in the evaluation period (not used for ranking)", true) : null}
              <th scope="col" className="px-2 py-2 text-right font-normal text-white/45">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const at = { hi: nearestIndex(surface.horizons, c.h), si: nearestIndex(surface.sl, c.sl), ti: nearestIndex(surface.tp, c.tp) };
              const selected = selKey === `${at.hi}-${at.si}-${at.ti}`;
              return (
                <tr
                  key={`${c.index.ti}-${c.index.si}-${c.index.hi}`}
                  onClick={() => select(at)}
                  aria-selected={selected}
                  className={cx("cursor-pointer border-b border-white/[0.05] transition hover:bg-white/[0.04]", selected && "bg-white/[0.06]")}
                >
                  <td className="px-2 py-1.5 text-right font-digits tabular-nums text-white/50">{c.ranks[rankMode]}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-digits tabular-nums text-white">
                    {fmtFrac(c.tp)} · {fmtFrac(c.sl)} · {c.h} d
                    {c.flags.length ? (
                      <span className="ml-1.5 text-amber-200/70" title={c.flags.map((f) => FLAG_COPY[f] ?? f).join("\n")}>
                        ⚑{c.flags.length}
                      </span>
                    ) : null}
                  </td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="px-2 py-1.5 text-right font-digits tabular-nums text-white/80">
                      {col.render(c)}
                    </td>
                  ))}
                  {hasEval ? <td className="px-2 py-1.5 text-right font-digits tabular-nums text-white/60">{pct(c.evaluation?.label1_share)}</td> : null}
                  <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <GenerateDatasetLink at={at} className="whitespace-nowrap" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="mt-3 text-[12.5px] text-white/55">
        <summary className="cursor-pointer text-white/50 hover:text-white">How “{doc.label}” is scored</summary>
        <p className="mt-2 text-white/70">{doc.formula}.</p>
        <ul className="mt-1.5 space-y-0.5">
          {Object.entries(doc.components).map(([k, v]) => (
            <li key={k}>
              <span className="font-mono text-[11.5px] text-white/45">{k}</span> — {v}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-white/45">{doc.gate}.</p>
        <p className="mt-2.5 text-white/45">{candidates.label.label_1 ? `Label 1: ${candidates.label.label_1}; label 0: ${candidates.label.label_0}. Same rule as the Generator.` : null}</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-white/45">
          {candidates.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
