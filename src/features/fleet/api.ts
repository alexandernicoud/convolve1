import { apiFetch } from "@/lib/api";

export type FleetRange = "1D" | "1W" | "1M" | "ALL";
export const FLEET_RANGES: FleetRange[] = ["1D", "1W", "1M", "ALL"];

export interface WinRate {
  value: number | null;
  wins: number;
  n: number;
}

export interface FleetBot {
  id: string;
  name: string;
  symbol: string;
  lifecycle: string;
  status: string;
  currency: string | null;
  currency_source: string;
  in_aggregate: boolean;
  deployed_at: string | null;
  starting_capital: number;
  equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  net_pnl: number;
  return: number | null;
  open_positions: { id: string; notional: number; entry_price: number; opened_at: string; opened_precise: boolean }[];
  open_notional: number;
  exposure: number | null;
  last_mark_at: string | null;
  mark_age_s: number | null;
  valuation_stale: boolean;
  ops_stale: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  win_rate: WinRate;
  costs: { gross_price_move: number; slippage: number; commission: number };
  backtest_ref: string | null;
}

export interface FleetKpis {
  unavailable?: string;
  equity?: number;
  contributed_capital?: number;
  net_pnl?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  realized_pnl_trades?: number;
  twr?: number | null;
  max_drawdown?: { value: number | null; unavailable?: string; peak_at?: string | null; trough_at?: string | null; recovered_at?: string | null };
  pnl_24h?: { value: number | null; unavailable?: string };
  gross_exposure?: { value: number | null; open_notional: number; open_positions: number };
  win_rate?: WinRate;
  last_mark_at?: string | null;
  oldest_mark_at?: string | null;
  valuation_stale_bots?: string[];
}

export interface FleetSeries {
  t: string[];
  equity: (number | null)[];
  contributed: (number | null)[];
  net_pnl: (number | null)[];
  realized: (number | null)[];
  unrealized: (number | null)[];
  twr: (number | null)[];
  drawdown: (number | null)[];
  exposure: (number | null)[];
  n_obs: number[];
  stale_bots: number[];
  bots_net_pnl: Record<string, (number | null)[]>;
  bots_equity: Record<string, (number | null)[]>;
}

export interface FleetEvent {
  kind: "error" | "deploy" | "trade_open" | "trade_close" | string;
  severity: "critical" | "warning" | "info";
  t: string;
  bot_id: string;
  count?: number;
  first_at?: string;
  message?: string;
  capital?: number;
  notional?: number;
  pnl?: number | null;
  reason?: string | null;
  precise?: boolean;
}

export interface ActivityLane {
  bot_id: string;
  ok: number[];
  error: number[];
  buy: number[];
  opens: { t: string; precise: boolean }[];
  closes: { t: string; pnl: number | null; precise: boolean }[];
  gaps: [string, string][];
}

export interface FleetPayload {
  schema: "fleet.v1";
  as_of: string;
  range: FleetRange;
  definitions: Record<string, string>;
  currency: { base: string | null; included_bot_ids: string[]; excluded: { bot_id: string; symbol: string; currency: string | null; reason: string }[]; note: string };
  excluded_lifecycles: Record<string, number>;
  health: {
    counts: { live: number; paused: number; error: number; expired: number; ops_stale: number; valuation_stale: number };
    poll_interval_s: number;
    stale_after_s: number;
    runs_24h: { ok: number; error: number; buy: number };
  };
  kpis: FleetKpis;
  bots: FleetBot[];
  window: { start?: string; end?: string; bucket_s?: number };
  series: Partial<FleetSeries>;
  markers: {
    deployments: { t: string; bot_id: string; capital: number }[];
    closes: { t: string; bot_id: string; pnl: number | null; reason: string | null; precise: boolean }[];
    opens: { t: string; bot_id: string; notional: number; precise: boolean }[];
  };
  contribution: { bot_id: string; pnl: number; realized: number; unrealized: number }[];
  daily: { date: string; pnl: number | null; realized: number; flows: number; observations: number; complete: boolean }[];
  activity: { start: string; bucket_s: number; buckets: number; lanes: ActivityLane[] };
  events: FleetEvent[];
  limitations: string[];
}

export function fetchFleet(range: FleetRange): Promise<FleetPayload> {
  return apiFetch(`/api/dashboard/fleet?range=${range}`) as Promise<FleetPayload>;
}
