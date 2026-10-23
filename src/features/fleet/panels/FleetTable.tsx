import { Link, useNavigate } from "react-router-dom";
import { SEMANTIC } from "@/lib/viz/tokens";
import { cn } from "@/lib/utils";
import type { FleetBot, FleetPayload } from "../api";
import { BOTS_HREF, botHref, DEPLOY_HREF, fmtAge, fmtMoney, fmtPct, signColor, sortBots, statusLabel, statusTone } from "../lib";
import { Dot, Panel } from "../ui";

function Spark({ ok, err }: { ok: number[]; err: number[] }) {
  const n = ok.length;
  if (!n) return null;
  const w = 56, h = 12, bw = w / n;
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      {ok.map((o, i) => {
        const e = err[i] ?? 0;
        if (!o && !e) return null;
        return <rect key={i} x={i * bw} y={e ? 0 : 3} width={Math.max(1, bw - 0.4)} height={e ? h : h - 6} fill={e ? "#F87171" : "rgba(143,179,224,0.55)"} />;
      })}
    </svg>
  );
}

function EmptyFleet({ p }: { p: FleetPayload }) {
  const archived = Object.values(p.excluded_lifecycles).reduce((a, b) => a + b, 0);
  const facts: [string, string][] = [
    ["Analysis cadence", `every ${p.health.poll_interval_s} s`],
    ["Freshness limit", fmtAge(p.health.stale_after_s)],
    ["Valuation", "mark-to-market, liquidation basis"],
    ["Currency policy", "single currency, no FX conversion"],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-hidden px-1">
      <div className="flex items-start gap-2.5">
        <span className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[#8FB3E0]/45">
          <span className="h-1.5 w-1.5 rounded-full bg-[#8FB3E0]/40" />
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium leading-[18px] text-white/85">No bots deployed</p>
          <p className="text-[11px] leading-[15px] text-white/40">
            Each deployed bot appears here with status, P&L, return, exposure and mark freshness.
            {archived ? ` ${archived} closed or archived bot${archived === 1 ? "" : "s"} not shown.` : ""}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] border-y border-white/[0.05] py-2 text-[10.5px] leading-[14px]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-white/35">{k}</dt>
            <dd className="truncate text-right text-white/60">{v}</dd>
          </div>
        ))}
      </dl>
      <Link
        to={DEPLOY_HREF}
        className="flex h-[28px] items-center justify-center gap-1.5 rounded-md border border-[#8FB3E0]/45 text-[12px] font-medium text-[#C9DBF1] transition hover:bg-[#8FB3E0]/10"
      >
        Deploy first bot →
      </Link>
    </div>
  );
}

export function FleetTable({ p, hovered, onHover, compact, activity }: { p: FleetPayload; hovered: string | null; onHover: (id: string | null) => void; compact: boolean; activity: boolean }) {
  const navigate = useNavigate();
  const bots = sortBots(p.bots);
  const lanes = new Map(p.activity.lanes.map((l) => [l.bot_id, l]));
  const ccy = p.currency.base;
  const exposureCol = !compact;
  const cols = ["minmax(0,1.5fr)", "minmax(64px,0.9fr)", "minmax(56px,0.7fr)", ...(exposureCol ? ["minmax(44px,0.55fr)"] : []), activity ? "60px" : "minmax(40px,0.5fr)"].join(" ");
  const fmtBotMoney = (b: FleetBot, v: number) => fmtMoney(v, b.in_aggregate ? ccy : b.currency, { signed: true, compact: true });

  return (
    <Panel id="fleet-table" title={`Fleet · ${bots.length} bot${bots.length === 1 ? "" : "s"}`} link={{ to: BOTS_HREF, label: "All bots" }} bodyClassName="flex flex-col">
      <div role="row" className="grid h-[20px] shrink-0 items-center gap-2 border-b border-white/[0.07] px-1 text-[10px] uppercase tracking-[0.1em] text-white/35" style={{ gridTemplateColumns: cols }}>
        <span>Bot · status</span>
        <span className="text-right">Net P&L</span>
        <span className="text-right">Return</span>
        {exposureCol ? <span className="text-right">Expo.</span> : null}
        <span className="text-right">{activity ? "24 h" : "Mark"}</span>
      </div>
      {bots.length === 0 ? <EmptyFleet p={p} /> : null}
      <div role="table" aria-label="Fleet bots" data-scroll-allowed="fleet-table" className={cn("min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]", bots.length ? "flex-1" : "hidden")}>
        {bots.map((b) => {
          const tone = statusTone(b);
          const lane = lanes.get(b.id);
          return (
            <div
              key={b.id}
              role="row"
              tabIndex={0}
              onMouseEnter={() => onHover(b.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(b.id)}
              onBlur={() => onHover(null)}
              onClick={() => navigate(botHref(b.id))}
              onKeyDown={(e) => {
                if (e.key === "Enter") navigate(botHref(b.id));
              }}
              title={b.last_error ? `Last error: ${b.last_error}` : `${b.name} · open bot detail`}
              className={cn(
                "grid h-[34px] cursor-pointer items-center gap-2 border-b border-white/[0.04] px-1 outline-none transition-colors",
                hovered === b.id ? "bg-white/[0.06]" : "hover:bg-white/[0.04] focus-visible:bg-white/[0.06]",
                tone === "error" && "bg-[#F87171]/[0.06]",
              )}
              style={{ gridTemplateColumns: cols }}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-[12.5px] font-medium leading-tight text-white">
                  <Dot tone={tone} />
                  <span className="truncate">{b.symbol}</span>
                  {!b.in_aggregate ? <span className="shrink-0 rounded border border-white/15 px-1 text-[9.5px] text-white/50" title="Not included in fleet totals (currency)">{b.currency ?? "ccy?"}</span> : null}
                </p>
                <p className={cn("truncate pl-3 text-[10.5px] leading-tight", tone === "error" ? "text-[#F87171]" : tone === "warn" ? "text-[#FCD34D]" : "text-white/40")}>
                  {statusLabel(b)}
                  {b.open_positions.length ? <span className="text-white/40"> · {b.open_positions.length} open</span> : null}
                </p>
              </div>
              <span className="truncate text-right font-digits text-[12px] tabular-nums" style={{ color: signColor(b.net_pnl, SEMANTIC.positive, SEMANTIC.negative) }}>
                {fmtBotMoney(b, b.net_pnl)}
              </span>
              <span className="truncate text-right font-digits text-[12px] tabular-nums" style={{ color: signColor(b.return, SEMANTIC.positive, SEMANTIC.negative) }}>
                {fmtPct(b.return)}
              </span>
              {exposureCol ? <span className="truncate text-right font-digits text-[12px] tabular-nums text-white/70">{fmtPct(b.exposure, 0, false)}</span> : null}
              {activity ? (
                <span className="flex justify-end">{lane ? <Spark ok={lane.ok} err={lane.error} /> : null}</span>
              ) : (
                <span className={cn("truncate text-right font-digits text-[11.5px] tabular-nums", b.valuation_stale ? "text-[#FCD34D]" : "text-white/50")}>{fmtAge(b.mark_age_s)}</span>
              )}
            </div>
          );
        })}
      </div>
      {p.currency.excluded.length || Object.keys(p.excluded_lifecycles).length ? (
        <p className="shrink-0 truncate pt-1 text-[10.5px] text-white/40" title={p.currency.note}>
          {p.currency.excluded.length ? `${p.currency.excluded.length} not in totals (currency)` : ""}
          {p.currency.excluded.length && Object.keys(p.excluded_lifecycles).length ? " · " : ""}
          {Object.entries(p.excluded_lifecycles).map(([k, v]) => `${v} ${k}`).join(", ")}
          {Object.keys(p.excluded_lifecycles).length ? " excluded" : ""}
        </p>
      ) : null}
    </Panel>
  );
}
