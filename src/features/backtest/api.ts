import { apiFetch, fetchApi } from "@/lib/api";

/** A metric that may be unavailable: `value` is null and `unavailable` says why. */
export type Metric<T = number> = { value: T | null; unavailable?: string; ci95?: [number, number] | null; n?: number; definition?: string; [k: string]: unknown };

export type RunStatus = "running" | "queued" | "pending" | "succeeded" | "failed" | "cancelled" | "interrupted";

export interface BacktestStatus {
  status: RunStatus;
  progress: number;
  message: string;
  log_tail: string;
  result_ready: boolean;
  engine?: "v1" | "v2";
  methodology?: { id: string; version: number; label: string };
  terminal?: boolean;
  started_at?: number | null;
  updated_at?: number | null;
}

export interface AuditCheck {
  id: string;
  category: string;
  status: "pass" | "warn" | "fail" | "unknown" | "info";
  title: string;
  detail: string;
  n_affected: number | null;
}

export interface Finding {
  id: string;
  severity: "positive" | "neutral" | "caution" | "negative";
  title: string;
  measurement: string;
  sample_size: number | null;
  baseline: string | null;
  ci95: [number, number] | null;
  assumptions: string;
  limitations: string;
  interpretation: string;
}

export interface BenchmarkSummary {
  label: string;
  exposure?: number;
  entry_date?: string;
  note?: string;
  total_return: Metric;
  max_drawdown: Metric;
  sharpe: Metric;
}

export interface V2Summary {
  api_version: number;
  methodology: { id: "price_sim_v2"; version: number; engine_version: string; label: string; execution: string; outcome_convention: string; outcome_spec: Record<string, unknown>; limitations: string[] };
  created_at: number;
  duration_s: number;
  model: { model_id?: string; trainer_run_id?: string; training_run_id?: string; training_dataset_id?: string; io: { input_size: number[]; head: string; preprocess: string } };
  dataset: {
    dataset_id: string;
    fingerprint: string;
    label_method: string;
    price_adjustment: string;
    data_source: Record<string, unknown>;
    timeframe: string;
    symbols: string[];
    n_images: number;
    n_samples_used: number;
    first_decision: string;
    last_decision: string;
  };
  config: Record<string, number | string | null>;
  threshold: { value: number; source: "validation_locked" | "user_fixed"; note?: string; selection?: Record<string, any> };
  evaluation_class: "independent_test" | "exploratory" | "blocked";
  leakage_audit: { evaluation_class: string; checks: AuditCheck[]; purged_sample_ids: string[]; missing_information: string[] };
  trading_metrics: Record<string, any>;
  classification_metrics: Record<string, any>;
  benchmarks: { method: string; benchmarks: Record<string, BenchmarkSummary>; unavailable: Record<string, string> };
  diagnostics: Record<string, any>;
  warnings: string[];
  findings: Finding[];
}

export interface V1Summary {
  api_version: number;
  methodology: { id: "label_payoff_v1"; version: 1; label: string };
  banner: string;
  warnings: string[];
  tp_sl_mismatch: Record<string, number> | null;
  withheld_metrics: Record<string, string>;
  kpis: Record<string, any>;
  trades: Record<string, any>[];
  chart_events: Record<string, any>[];
  series: Record<string, any>;
  threshold_sweep_label: string;
  benchmark: Record<string, any>;
  classification_metrics: Record<string, any>;
  summary: Record<string, any>;
  config: Record<string, any>;
  timestamp?: string;
}

export type Summary = V2Summary | V1Summary;
export const isV2 = (s: Summary): s is V2Summary => s.methodology?.id === "price_sim_v2";

export interface Trade {
  sample_id: string;
  symbol: string;
  prob: number;
  label: number | null;
  decision_ts: string;
  entry_ts: string;
  entry_open: number;
  entry_fill: number;
  shares: number;
  notional: number;
  tp_price: number;
  sl_price: number;
  status: "closed" | "open_at_end";
  exit_ts: string | null;
  exit_reason: "tp" | "sl" | "timeout" | null;
  exit_price: number | null;
  exit_fill: number | null;
  bars_held: number | null;
  holding_days: number | null;
  gross_return: number | null;
  commission: number;
  slippage_cost: number;
  costs: number;
  net_pnl: number | null;
  net_return: number | null;
  mark_price: number | null;
  unrealized_pnl: number | null;
  stale_marks: number;
  flags: string[];
}

export interface Page<T> {
  total: number;
  offset: number;
  limit: number;
  rows: T[];
}

export interface EquityRow {
  date: string;
  cash: number;
  positions_value: number;
  equity: number;
  gross_exposure: number | null;
  n_positions: number;
  entries: number;
  realized_pnl: number;
  unrealized_pnl: number;
  commission_cum: number;
  slippage_cum: number;
  costs_cum: number;
  drawdown: number;
  stale_marks: number;
}

export interface EquityPayload {
  equity: EquityRow[];
  benchmarks: Record<string, number | string | null>[];
  benchmark_info: V2Summary["benchmarks"];
}

export interface MetricsPayload {
  trading_metrics: Record<string, any>;
  classification_metrics: Record<string, any>;
  robustness: Record<string, any>;
  threshold_sweep: { label: string; in_sample: true; base_rate: number | null; rows: Record<string, any>[] };
  threshold: V2Summary["threshold"];
  diagnostics: Record<string, any>;
}

export type TradeQuery = Partial<{
  offset: number;
  limit: number;
  q: string;
  symbol: string;
  status: string;
  exit_reason: string;
  outcome: "win" | "loss";
  prob_min: number;
  prob_max: number;
  date_from: string;
  date_to: string;
  sort: string;
  order: "asc" | "desc";
}>;

const qs = (q: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const backtestApi = {
  status: (id: string) => apiFetch(`/api/backtests/${id}`) as Promise<BacktestStatus>,
  summary: (id: string) => apiFetch(`/api/v2/backtests/${id}/summary`) as Promise<Summary>,
  trades: (id: string, q: TradeQuery) => apiFetch(`/api/v2/backtests/${id}/trades${qs(q)}`) as Promise<Page<Trade>>,
  equity: (id: string) => apiFetch(`/api/v2/backtests/${id}/equity`) as Promise<EquityPayload>,
  metrics: (id: string) => apiFetch(`/api/v2/backtests/${id}/metrics`) as Promise<MetricsPayload>,
  imagePath: (id: string, imageId: string) => `/api/v2/backtests/${id}/sample-image/${encodeURIComponent(imageId)}`,
  async allTrades(id: string): Promise<Trade[]> {
    const out: Trade[] = [];
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const p = await backtestApi.trades(id, { offset, limit: 1000 });
      out.push(...p.rows);
      if (out.length >= p.total || !p.rows.length) break;
    }
    return out;
  },
  async downloadArtifact(id: string, name: "predictions" | "trades" | "skipped" | "equity" | "benchmarks") {
    const res = await fetchApi(`/api/v2/backtests/${id}/artifacts/${name}.csv`);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest_${id.slice(0, 8)}_${name}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled", "interrupted"];
