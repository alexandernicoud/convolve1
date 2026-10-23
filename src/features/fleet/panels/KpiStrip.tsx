import type { ReactNode } from "react";
import { SEMANTIC } from "@/lib/viz/tokens";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import { cn } from "@/lib/utils";
import type { FleetPayload } from "../api";
import { fmtAge, fmtDayLabel, fmtMoney, fmtPct, isNum, MISSING, ms, signColor } from "../lib";

function Cell({ label, value, sub, color, title, className }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; title?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-center px-3 first:pl-3.5", className)} title={title}>
      <p className="truncate text-[10px] font-medium uppercase leading-[14px] tracking-[0.12em] text-white/40">{label}</p>
      <p className="truncate font-digits text-[17px] font-semibold leading-[20px] tabular-nums" style={{ color: value === MISSING ? "rgba(255,255,255,0.3)" : (color ?? "#F5F5F5") }}>
        {value}
      </p>
      {sub ? <p className="truncate text-[10.5px] leading-[13px] text-white/45">{sub}</p> : null}
    </div>
  );
}

export function KpiStrip({ p, compact, okAt, error, now }: { p: FleetPayload; compact: boolean; okAt: number | null; error: string | null; now: number }) {
  const k = p.kpis;
  const ccy = p.currency.base;
  const d = p.definitions;
  const pos = SEMANTIC.positive;
  const neg = SEMANTIC.negative;
  const c = p.health.counts;
  const markAge = k.last_mark_at ? (now - (ms(k.last_mark_at) ?? now)) / 1000 : null;
  const dataAge = okAt ? (now - okAt) / 1000 : null;
  const unavailable = k.unavailable;
  const first = p.bots.reduce<number | null>((a, b) => {
    const t = ms(b.deployed_at);
    return t != null && (a == null || t < a) ? t : a;
  }, null);
  const dd = k.max_drawdown;
  const stale = k.valuation_stale_bots?.length ?? 0;

  return (
    <div data-panel="kpis" className={cn(dashboardCard, "grid h-full min-w-0 items-stretch divide-x divide-white/[0.07] overflow-hidden py-[3px]")} style={{ gridTemplateColumns: compact ? "repeat(6, minmax(0,1fr)) minmax(0,1.25fr)" : "repeat(7, minmax(0,1fr)) minmax(0,1.35fr)" }}>
      <Cell
        label={`Fleet equity${ccy ? ` · ${ccy}` : ""}`}
        title={d.equity}
        value={unavailable ? MISSING : fmtMoney(k.equity, ccy)}
        sub={unavailable ? unavailable : <>{stale ? <span className="text-[#FCD34D]">{stale} stale · </span> : null}funded {fmtMoney(k.contributed_capital, ccy, { compact: true })}</>}
      />
      <Cell
        label="Net P&L"
        title={`${d.net_pnl}\nRealized: ${d.realized_pnl}\nUnrealized: ${d.unrealized_pnl}`}
        value={fmtMoney(k.net_pnl, ccy, { signed: true })}
        color={signColor(k.net_pnl, pos, neg)}
        sub={isNum(k.net_pnl) ? <>R {fmtMoney(k.realized_pnl, ccy, { signed: true })} · U {fmtMoney(k.unrealized_pnl, ccy, { signed: true })}</> : undefined}
      />
      <Cell label="Return (TWR)" title={d.twr} value={fmtPct(k.twr)} color={signColor(k.twr, pos, neg)} sub={first ? `since ${fmtDayLabel(first)}` : "No valuation history."} />
      <Cell
        label="24 h P&L"
        title={d.pnl_24h}
        value={fmtMoney(k.pnl_24h?.value, ccy, { signed: true })}
        color={signColor(k.pnl_24h?.value, pos, neg)}
        sub={k.pnl_24h?.unavailable ?? "rolling, flows excluded"}
      />
      {!compact ? (
        <Cell
          label="Max drawdown"
          title={d.max_drawdown}
          value={isNum(dd?.value) ? fmtPct(dd?.value, 2) : MISSING}
          color={isNum(dd?.value) && (dd?.value ?? 0) < 0 ? neg : undefined}
          sub={dd?.unavailable ?? (dd?.trough_at ? `trough ${fmtDayLabel(ms(dd.trough_at) ?? 0)}${dd.recovered_at ? " · recovered" : ""}` : "peak-to-trough, TWR")}
        />
      ) : null}
      <Cell
        label="Gross exposure"
        title={d.gross_exposure}
        value={fmtPct(k.gross_exposure?.value, 1, false)}
        sub={k.gross_exposure ? `${k.gross_exposure.open_positions} open · ${fmtMoney(k.gross_exposure.open_notional, ccy, { compact: true })}` : undefined}
      />
      <Cell
        label="Win rate"
        title={d.win_rate}
        value={k.win_rate && k.win_rate.n > 0 ? fmtPct(k.win_rate.value, 0, false) : MISSING}
        sub={k.win_rate ? (k.win_rate.n > 0 ? `${k.win_rate.wins} of ${k.win_rate.n} closed${k.win_rate.n < 10 ? " · small n" : ""}` : "no closed trades") : undefined}
      />
      <Cell
        label="Bots"
        className="pr-3.5"
        value={
          <span className="flex items-baseline gap-2 text-[15px]">
            <span>{c.live}<span className="ml-0.5 text-[10.5px] font-normal text-white/45">live</span></span>
            {c.paused ? <span className="text-white/70">{c.paused}<span className="ml-0.5 text-[10.5px] font-normal text-white/45">paused</span></span> : null}
            {c.error ? <span className="text-[#F87171]">{c.error}<span className="ml-0.5 text-[10.5px] font-normal">error</span></span> : null}
            {c.ops_stale ? <span className="text-[#FCD34D]">{c.ops_stale}<span className="ml-0.5 text-[10.5px] font-normal">idle</span></span> : null}
          </span>
        }
        sub={
          error ? (
            <span className="text-[#FCD34D]" title={error}>refresh failed · data {fmtAge(dataAge)} old</span>
          ) : p.bots.length === 0 ? (
            <span title={`Analyses every ${p.health.poll_interval_s} s once a bot is deployed`}>
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-white/30 align-middle" />
              0 deployed · synced {fmtAge(dataAge)}
            </span>
          ) : (
            <span title={`Last valuation ${k.last_mark_at ?? "—"} · analyses every ${p.health.poll_interval_s} s`}>
              <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", markAge != null && markAge > p.health.stale_after_s ? "bg-[#FCD34D]" : "bg-[#8FB3E0]")} />
              mark {fmtAge(markAge)} · synced {fmtAge(dataAge)}
            </span>
          )
        }
      />
    </div>
  );
}
