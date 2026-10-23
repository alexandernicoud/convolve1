import { Link } from "react-router-dom";
import { SEMANTIC } from "@/lib/viz/tokens";
import { cn } from "@/lib/utils";
import type { FleetEvent, FleetPayload } from "../api";
import { BOTS_HREF, botHref, fmtAge, fmtDateTime, fmtMoney, ms, TRADES_HREF } from "../lib";
import { Dot, Panel, useElementSize } from "../ui";

const ROW = 19;

function describe(e: FleetEvent, ccy: string | null): { text: string; tone: "error" | "warn" | "ok" | "muted"; color?: string } {
  if (e.kind === "error") return { text: `${e.count && e.count > 1 ? `${e.count}× ` : ""}${e.message ?? "Run failed"}`, tone: "error" };
  if (e.kind === "deploy") return { text: `Deployed · ${fmtMoney(e.capital, ccy)}`, tone: "muted" };
  if (e.kind === "trade_open") return { text: `Opened · ${fmtMoney(e.notional, ccy, { compact: true })}`, tone: "ok" };
  if (e.kind === "trade_close") {
    const pnl = e.pnl ?? null;
    return { text: `Closed${e.reason ? ` (${e.reason})` : ""} · ${fmtMoney(pnl, ccy, { signed: true })}`, tone: "ok", color: pnl == null ? undefined : pnl >= 0 ? SEMANTIC.positive : SEMANTIC.negative };
  }
  return { text: e.kind, tone: "muted" };
}

function Chip({ n, label, tone }: { n: number; label: string; tone: "ok" | "warn" | "error" | "muted" }) {
  return (
    <span className={cn("flex items-center gap-1 rounded border px-1.5 text-[10.5px] leading-[18px]", n && tone === "error" ? "border-[#F87171]/40 text-[#F87171]" : n && tone === "warn" ? "border-[#FCD34D]/35 text-[#FCD34D]" : "border-white/10 text-white/55")}>
      <span className="font-digits tabular-nums text-[11px]">{n}</span>
      {label}
    </span>
  );
}

export function HealthEventsPanel({ p, now }: { p: FleetPayload; now: number }) {
  const [ref, size] = useElementSize<HTMLUListElement>();
  const ccy = p.currency.base;
  const c = p.health.counts;
  const names = new Map(p.bots.map((b) => [b.id, b.symbol]));
  const fit = Math.max(1, Math.floor(size.height / ROW));
  const events = p.events ?? [];
  const shown = events.length > fit ? events.slice(0, fit - 1) : events;
  const more = events.length - shown.length;
  const r = p.health.runs_24h;
  return (
    <Panel
      id="health"
      title="Health & events"
      aside={p.limitations.length ? <span className="cursor-help text-[10.5px] text-white/35" title={p.limitations.join("\n\n")}>{p.limitations.length} data notes</span> : null}
      bodyClassName="flex flex-col gap-1"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 overflow-hidden" style={{ maxHeight: 20 }}>
        <Chip n={c.error} label="error" tone="error" />
        <Chip n={c.valuation_stale} label="stale" tone="warn" />
        <Chip n={c.ops_stale} label="idle" tone="warn" />
        <Chip n={c.paused} label="paused" tone="muted" />
        <span className="ml-auto whitespace-nowrap text-[10.5px] text-white/40" title="Analysis runs in the last 24 hours">
          24 h runs <span className="font-digits tabular-nums text-white/75">{r.ok + r.error}</span>
          {r.error ? <span className="text-[#F87171]"> · {r.error} failed</span> : null}
        </span>
      </div>
      <ul ref={ref} className="min-h-0 flex-1 overflow-hidden">
        {events.length === 0 && p.bots.length === 0 ? (
          (
            [
              ["Monitor", "Idle — no bots to analyse"],
              ["24 h", `${r.ok + r.error} runs · ${r.error} failures`],
              ["7 d", "No errors, deployments or trades"],
              ["Next", "Events stream here after the first deployment"],
            ] as const
          ).map(([k, v]) => (
            <li key={k} style={{ height: ROW }} className="flex items-center gap-1.5 text-[11.5px]">
              <Dot tone="muted" />
              <span className="w-[58px] shrink-0 text-[10px] uppercase tracking-[0.08em] text-white/35">{k}</span>
              <span className="min-w-0 flex-1 truncate text-white/55">{v}</span>
            </li>
          ))
        ) : events.length === 0 ? (
          <li className="pt-2 text-[11.5px] text-white/40">No errors, deployments or trades in the last 7 days.</li>
        ) : (
          shown.map((e, i) => {
            const d = describe(e, ccy);
            const t = ms(e.t);
            return (
              <li key={`${e.kind}${e.bot_id}${e.t}${i}`} style={{ height: ROW }} className="flex items-center gap-1.5 text-[11.5px]">
                <Dot tone={d.tone} />
                <span className="w-[42px] shrink-0 text-right font-digits tabular-nums text-white/40" title={t ? fmtDateTime(t) + (e.precise === false ? " (bar date)" : "") : undefined}>
                  {t ? fmtAge((now - t) / 1000) : "—"}
                </span>
                <Link to={botHref(e.bot_id)} className="w-[56px] shrink-0 truncate font-medium text-white/80 hover:text-white">
                  {names.get(e.bot_id) ?? "bot"}
                </Link>
                <span className={cn("min-w-0 flex-1 truncate", d.tone === "error" ? "text-[#FCA5A5]" : "text-white/60")} style={d.color ? { color: d.color } : undefined} title={d.text}>
                  {d.text}
                </span>
              </li>
            );
          })
        )}
        {more > 0 ? (
          <li style={{ height: ROW }} className="flex items-center gap-3 pl-3 text-[11px] text-white/40">
            +{more} more
            <Link to={TRADES_HREF} className="hover:text-white">trades →</Link>
            <Link to={BOTS_HREF} className="hover:text-white">bots →</Link>
          </li>
        ) : null}
      </ul>
    </Panel>
  );
}
