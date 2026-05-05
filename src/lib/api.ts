/**
 * Single source of truth for API base URL (browser bundle).
 *
 * **Resolution:** `import.meta.env.VITE_API_BASE_URL` (Vite) when set and non-empty; otherwise `''`.
 * With an empty base, requests use same-origin relative paths (`/api/...`, `/trainer/...`, …).
 *
 * **Local dev:** leave `VITE_API_BASE_URL` unset → `npm run dev:frontend` + Vite `server.proxy` forwards
 * to the backend (LAN-safe; no hardcoded `127.0.0.1` in client code).
 *
 * **Production (API on another host):** set `VITE_API_BASE_URL=https://api.example.com` at build time.
 *
 * Do not use `process.env` in client code; Vite only exposes `VITE_*` via `import.meta.env`.
 * @see https://vitejs.dev/guide/env-and-mode.html
 */
function resolveApiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (raw == null || String(raw).trim() === '') {
    return '';
  }
  return String(raw).trim().replace(/\/+$/, '');
}

/** Resolved API origin, no trailing slash. Same as empty string when using same-origin / proxy. */
export const API_BASE = resolveApiBase();

/** Build request URL: `API_BASE` + path (`path` should start with `/`). */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

function networkErrorMessage(cause: unknown, url: string): Error {
  const base = `Cannot reach API (${url}).`;
  const hint =
    API_BASE === ''
      ? ' In dev, use `npm run dev:frontend` (Vite proxies backend routes). If the API is on another host, set VITE_API_BASE_URL in `.env`.'
      : ' Check VITE_API_BASE_URL, use https→https (or http→http), and ensure CORS allows this origin.';
  if (cause instanceof TypeError && String(cause.message).includes('fetch')) {
    return new Error(`${base}${hint} (${cause.message})`);
  }
  if (cause instanceof Error) {
    return new Error(`${base} ${cause.message}${hint}`);
  }
  return new Error(`${base}${hint}`);
}

/**
 * Low-level `fetch` with `apiUrl` + consistent network error handling.
 * Prefer `apiRequest` / `apiFormRequest` for JSON; use this for blobs, HEAD, or manual status checks.
 */
export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  try {
    return await fetch(url, init);
  } catch (e) {
    throw networkErrorMessage(e, url);
  }
}

export async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetchApi(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export interface RunRequest {
  symbol: string;
  start: string;
  end: string;
  /** Optional — stored with the run; pipeline may use in future */
  timeframe?: string;
  tp_min_pct?: number;
  tp_max_pct?: number;
  sl_min_pct?: number;
  sl_max_pct?: number;
  horizon_min?: number;
  horizon_max?: number;
  min_trades?: number;
  grid_tp_steps?: number;
  grid_sl_steps?: number;
  fee_rate_pct?: number;
  objective?: string;
}

export interface RunResponse {
  run_id: string;
}

export interface ProgressResponse {
  phase: string;
  percent: number;
  elapsed_s: number;
  step: number | null;
  total_steps: number | null;
  error_message?: string;
}

export interface ArtifactsResponse {
  artifacts: string[];
}

export interface TrainingChartGeneratorConfig {
  symbols: string;
  chartsPerLabel: number;
  useCandles: boolean;
  timeframe: '1d' | '1wk' | '1mo';
  timespanUnit: string;
  timespanCount: number;
  horizonBars: number;
  takeProfitFraction: number;
  stopLossFraction: number;
  imageDimension: number;
  endOffset: number;
}

export interface DatasetStats {
  total_charts?: number;
  symbols_count?: number;
  timeframe?: string;
  chart_type?: string;
}

export interface TrainerRunRequest {
  use_standard_config: boolean;
  folder_name?: string;
  dataset_id?: string;
  model_name: string;
  image_height?: number;
  image_width?: number;
  batch_size?: number;
  epochs?: number;
  val_split?: number;
  random_seed?: number;
}

/** One row from `backend/runs/.../history.json` (per epoch). Older runs may omit label_1_recall fields. */
export interface TrainerHistoryEpoch {
  epoch: number;
  epochs?: number;
  loss?: number;
  accuracy?: number;
  val_loss?: number;
  val_accuracy?: number;
  label_1_recall?: number;
  val_label_1_recall?: number;
  /** Same as val_label_1_recall for binary models (accuracy on true positives). */
  val_label_1_accuracy?: number;
  timestamp?: number;
}

export interface TrainerProgressResponse {
  status: string;
  progress: {
    phase: string;
    percent: number;
    message?: string;
    epoch?: number;
    epochs?: number;
    loss?: number;
    accuracy?: number;
    val_loss?: number;
    val_accuracy?: number;
  };
  last_metrics?: {
    epoch?: number;
    epochs?: number;
    loss?: number;
    accuracy?: number;
    val_loss?: number;
    val_accuracy?: number;
  };
  history_preview?: Array<{
    epoch: number;
    loss: number;
    accuracy: number;
    val_loss?: number;
    val_accuracy?: number;
  }>;
  /** Optional server log tail when backend exposes it (ignored if absent). */
  log_lines?: string[];
  /** Optional server-computed timing (ignored if absent). */
  telemetry?: {
    wall_elapsed_seconds?: number;
    elapsed_train_seconds?: number;
    completed_epochs?: number;
    planned_epochs?: number;
    avg_epoch_seconds?: number;
    estimated_remaining_seconds?: number | null;
  };
  error_message?: string;
}

export interface AnalysisResponse {
  analysis_id: string;
}

/** CNN analysis manifest row (mirrors backend analysis_manifest.json artifacts). */
export interface AnalysisArtifactEntry {
  id: string;
  type: string;
  render_mode: string;
  title: string;
  subtitle: string;
  tags: string[];
  layer_name?: string;
  json_file?: string;
  png_file?: string;
  legacy_compatibility?: string[];
}

export interface AnalysisStatusResponse {
  status: string;
  progress: {
    phase: string;
    percent: number;
    message?: string;
  };
  generated_files?: string[];
  /** Matrix / bundle JSON files for native dashboard rendering */
  generated_json_files?: string[];
  manifest_file?: string | null;
  artifact_metadata?: AnalysisArtifactEntry[] | null;
  error_message?: string | null;
}

export interface BacktesterStartRequest {
  model_path?: string;
  model_id?: string;
  dataset_id?: string;
  chart_folder?: string;
  sample_size: string | number;
  confidence_threshold: number;
  tp_pct: number;
  sl_pct: number;
  img_size: number;
  // Trading parameters
  starting_capital?: number;
  position_size_pct?: number;
  commission_pct?: number;
  slippage_pct?: number;
  // Risk management
  max_drawdown_pct?: number;
  max_trades_per_day?: number;
}

// New real-time backtester API
/** Prefer model_id from POST /models/upload; model_path is resolved server-side (legacy). */
export interface BacktestRunRequest {
  model_path?: string;
  model_id?: string;
  dataset_path: string;
  sample_size: string | number;
  confidence_threshold: number;
  tp_pct: number;
  sl_pct: number;
  img_size: number;
  starting_capital: number;
  position_size_pct: number;
  commission_pct: number;
  slippage_pct: number;
  max_drawdown_pct: number;
  max_trades_per_day?: number;
}

export interface BacktestStatusResponse {
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number; // 0.0 to 1.0
  message: string;
  log_tail: string;
  result_ready: boolean;
}

export interface BacktestResultResponse {
  kpis: Record<string, any>;
  charts: Record<string, string>;
  trades: Array<Record<string, any>>;
  summary: Record<string, any>;
  config?: Record<string, any>;
  timestamp?: string;
  /** Full timeline incl. predicted_label 0 / NO_TRADE (required for ledger when present in JSON). */
  chart_events?: Array<Record<string, any>>;
  series?: Record<string, any>;
  benchmark?: Record<string, any>;
  classification_metrics?: Record<string, any> | null;
}

export interface BacktesterStatusResponse {
  status: string;
  progress: number;
  stage: string;
  message: string;
  live_metrics?: Record<string, any>;
}

export interface BacktesterResultResponse {
  kpis: Record<string, any>;
  charts: Record<string, string>;
  download_zip_url: string;
  csv_urls?: Record<string, string>;
  summary_url?: string;
}

export interface GlobalRun {
  id: string;
  tool: string;
  status: string;
  progress: number;
  stage: string;
  message: string;
  created_at: number;
  updated_at: number;
  route?: string;
  parent_run_id?: string;
}

export interface RunsState {
  runsById: Record<string, GlobalRun>;
  activeRunIds: string[];
  isPolling: boolean;
}

export interface RunsStore extends RunsState {
  refreshActiveRuns: () => Promise<void>;
  refreshRun: (runId: string) => Promise<void>;
  registerRun: (run: Omit<GlobalRun, 'created_at' | 'updated_at'>) => void;
  getRunRoute: (run: GlobalRun) => string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const extractFilename = (disposition: string | null, fallback: string) => {
  if (!disposition) return fallback;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  return fallback;
};

async function downloadFile(endpoint: string, fallbackFilename: string): Promise<void> {
  const response = await fetchApi(endpoint);
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || response.statusText);
  }
  const blob = await response.blob();
  const filename = extractFilename(response.headers.get('content-disposition'), fallbackFilename);
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

function formatHttpErrorBody(status: number, raw: string): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return 'no response body';
  }
  try {
    const j = JSON.parse(trimmed) as { detail?: unknown };
    if (j && typeof j === 'object' && 'detail' in j) {
      const d = j.detail;
      if (typeof d === 'string') return d;
      if (Array.isArray(d)) {
        return d
          .map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x)))
          .join('; ');
      }
      return String(d);
    }
  } catch {
    /* not JSON */
  }
  return trimmed;
}

function responseStatusLabel(status: number): string {
  if (status === 404) return 'Not found';
  if (status === 422) return 'Validation error';
  if (status === 500) return 'Server error';
  if (status === 401 || status === 403) return 'Unauthorized';
  return 'Error';
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchApi(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const detail = formatHttpErrorBody(response.status, errorText);
    throw new ApiError(response.status, `${response.status} ${responseStatusLabel(response.status)}: ${detail}`);
  }

  return response.json();
}

async function apiFormRequest<T>(endpoint: string, formData: FormData): Promise<T> {
  const response = await fetchApi(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const detail = formatHttpErrorBody(response.status, errorText);
    throw new ApiError(response.status, `${response.status} ${responseStatusLabel(response.status)}: ${detail}`);
  }

  return response.json();
}

export const labelingOptimizerApi = {
  // Start a new labeling optimizer run
  async startRun(request: RunRequest): Promise<RunResponse> {
    return apiRequest<RunResponse>('/api/labeling-optimizer/run', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  // Get progress for a run
  async getProgress(runId: string): Promise<ProgressResponse> {
    return apiRequest<ProgressResponse>(`/api/labeling-optimizer/progress/${runId}`);
  },

  // List available artifacts for a run
  async listArtifacts(runId: string): Promise<ArtifactsResponse> {
    return apiRequest<ArtifactsResponse>(`/api/labeling-optimizer/runs/${runId}`);
  },

  // Get a specific artifact
  async getArtifact(runId: string, name: string): Promise<any> {
    return apiRequest<any>(`/api/labeling-optimizer/artifacts/${runId}/${name}`);
  },
};

export const trainerApi = {
  // Start a new trainer run
  async run(config: TrainerRunRequest): Promise<RunResponse> {
    return apiRequest<RunResponse>('/trainer/runs', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  // Get progress for a run
  async getProgress(runId: string): Promise<TrainerProgressResponse> {
    return apiRequest<TrainerProgressResponse>(`/trainer/runs/${runId}`);
  },

  /** Per-epoch metrics from `history.json` (analysis page training curves). */
  async getRunHistory(runId: string): Promise<TrainerHistoryEpoch[]> {
    return apiRequest<TrainerHistoryEpoch[]>(`/trainer/runs/${runId}/history`);
  },

  // Cancel a running trainer run
  async cancelRun(runId: string): Promise<{ status: string; run_id: string }> {
    return apiRequest<{ status: string; run_id: string }>(`/trainer/runs/${runId}/cancel`, {
      method: 'POST',
    });
  },

  // Start analysis on a trained model
  async startAnalysis(runId: string, imgPath?: string): Promise<AnalysisResponse> {
    return apiRequest<AnalysisResponse>(`/trainer/runs/${runId}/analysis`, {
      method: 'POST',
      body: JSON.stringify({ img_path: imgPath }),
    });
  },

  /** Analysis runs under a trainer or standalone CNN analysis run (folder IDs). */
  async listRunAnalyses(runId: string): Promise<{ analysis_ids: string[] }> {
    return apiRequest<{ analysis_ids: string[] }>(`/trainer/runs/${runId}/analyses`);
  },

  /** Standalone analysis: uploaded .keras + dataset ZIP (uses first image as sample). */
  async startStandaloneAnalysis(body: {
    model_id: string;
    dataset_id: string;
  }): Promise<{ run_id: string; analysis_id: string }> {
    return apiRequest<{ run_id: string; analysis_id: string }>(`/trainer/analysis/standalone`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // Get analysis status
  async getAnalysisStatus(runId: string, analysisId: string): Promise<AnalysisStatusResponse> {
    return apiRequest<AnalysisStatusResponse>(`/trainer/runs/${runId}/analysis/${analysisId}`);
  },

  /** Fetch a JSON (or other) artifact from the analysis output folder */
  async getAnalysisArtifact<T = unknown>(runId: string, analysisId: string, filename: string): Promise<T> {
    return apiRequest<T>(`/trainer/runs/${runId}/analysis/${analysisId}/artifacts/${encodeURIComponent(filename)}`);
  },

  // Download trained model
  async downloadModel(runId: string): Promise<void> {
    await downloadFile(`/trainer/runs/${runId}/download/model`, `model_${runId}.keras`);
  },

  // Download analysis results
  async downloadAnalysis(runId: string, analysisId: string): Promise<void> {
    await downloadFile(`/trainer/runs/${runId}/analysis/${analysisId}/download`, `cnn_analysis_${runId}_${analysisId}.zip`);
  },
};

// Global runs API
export const runsApi = {
  getActiveRuns(): Promise<{ runs: GlobalRun[] }> {
    return apiRequest<{ runs: GlobalRun[] }>('/runs/active');
  },

  getRun(runId: string): Promise<GlobalRun> {
    return apiRequest<GlobalRun>(`/runs/${runId}`);
  },
};

// Backtester API (legacy)
export const backtesterApi = {
  startRun(request: BacktesterStartRequest): Promise<{ run_id: string }> {
    return apiRequest<{ run_id: string }>('/runs/backtester/start', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  getStatus(runId: string): Promise<BacktesterStatusResponse> {
    return apiRequest<BacktesterStatusResponse>(`/runs/backtester/${runId}/status`);
  },

  getResult(runId: string): Promise<BacktesterResultResponse> {
    return apiRequest<BacktesterResultResponse>(`/runs/backtester/${runId}/result`);
  },

  getChart(runId: string, filename: string): string {
    return apiUrl(`/runs/backtester/${runId}/charts/${filename}`);
  },
};

// New real-time backtester API
export const realtimeBacktesterApi = {
  startRun(request: BacktestRunRequest): Promise<{ run_id: string }> {
    return apiRequest<{ run_id: string }>('/api/backtests/run', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  getStatus(runId: string): Promise<BacktestStatusResponse> {
    return apiRequest<BacktestStatusResponse>(`/api/backtests/${runId}`);
  },

  getResult(runId: string): Promise<BacktestResultResponse> {
    return apiRequest<BacktestResultResponse>(`/api/backtests/${runId}/results`);
  },

  getFile(runId: string, path: string): string {
    return apiUrl(`/api/backtests/${runId}/files/${path}`);
  },

  downloadZip(runId: string): void {
    window.open(apiUrl(`/runs/backtester/${runId}/download.zip`), '_blank');
  },
};

// Test Data Generator API
export interface TestDataGeneratorRequest {
  symbols: string;
  dataset_name: string;
  use_candles: boolean;
  timeframe: string;
  span_unit: string;
  span_units_count: number;
  future_horizon_bars: number;
  tp_frac: number;
  sl_frac: number;
  img_dim: number;
  period_length_units: number;
  end_offset_units: number;
  use_sma: boolean;
  sma_length: number;
  training_period_start?: string;
  training_period_end?: string;
  test_period_start?: string;
  test_period_end?: string;
}

export interface TestDataGeneratorStatusResponse {
  status: string;
  progress: number;
  stage: string;
  message: string;
  live_metrics?: Record<string, any>;
}

export interface TestDataGeneratorResultResponse {
  dataset_id: string;
  download_zip_url: string;
  summary: {
    total_images: number;
    label_distribution: Record<string, number>;
    start_date?: string;
    end_date?: string;
  };
}

export const testDataGeneratorApi = {
  startRun(request: TestDataGeneratorRequest): Promise<{ run_id: string }> {
    return apiRequest<{ run_id: string }>('/runs/testdata/start', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  getStatus(runId: string): Promise<TestDataGeneratorStatusResponse> {
    return apiRequest<TestDataGeneratorStatusResponse>(`/runs/testdata/${runId}/status`);
  },

  getResult(runId: string): Promise<TestDataGeneratorResultResponse> {
    return apiRequest<TestDataGeneratorResultResponse>(`/runs/testdata/${runId}/result`);
  },

  downloadZip(runId: string): void {
    window.open(apiUrl(`/runs/testdata/${runId}/download.zip`), '_blank');
  },
};

export const trainingChartGeneratorApi = {
  // Start a new training chart generator run
  async run(config: TrainingChartGeneratorConfig): Promise<RunResponse> {
    return apiRequest<RunResponse>('/api/training-chart-generator/run', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  // Get progress for a run
  async getProgress(runId: string): Promise<ProgressResponse> {
    return apiRequest<ProgressResponse>(`/api/training-chart-generator/progress/${runId}`);
  },

  // List available artifacts for a run
  async getArtifacts(runId: string): Promise<DatasetStats> {
    return apiRequest<DatasetStats>(`/api/training-chart-generator/artifacts/${runId}`);
  },

  // Cancel a running generation
  async cancel(runId: string): Promise<{status: string, run_id: string}> {
    return apiRequest<{status: string, run_id: string}>(`/api/training-chart-generator/cancel/${runId}`, {
      method: 'POST',
    });
  },

  // Download the generated dataset ZIP
  async download(runId: string): Promise<void> {
    const response = await fetchApi(`/api/training-chart-generator/download/${runId}`);

    if (!response.ok) {
      throw new ApiError(response.status, 'Download failed');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `training-dataset-${runId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  },
};

export interface BotRun {
  id: string;
  bot_id: string;
  run_at: string;
  label?: string | null;
  signal?: string | null;
  confidence?: number | null;
  chart_path?: string | null;
  heatmap_path?: string | null;
  equity?: number | null;
  pnl?: number | null;
  status: string;
  error_message?: string | null;
  /** JSON string; may include gradcam_ok and gradcam_error when status is success */
  run_metadata_json?: string | null;
}

export interface BotTrade {
  id: string;
  bot_id: string;
  prediction_run_id?: string | null;
  entry_date: string;
  entry_price: number;
  position_notional: number;
  tp_price?: number | null;
  sl_price?: number | null;
  horizon_days: number;
  expiry_date: string;
  status: string;
  exit_date?: string | null;
  exit_price?: number | null;
  exit_reason?: string | null;
  exit_run_id?: string | null;
  pnl_amount?: number | null;
  pnl_pct?: number | null;
  created_at?: string | null;
}

export interface BotEquityPoint {
  as_of: string;
  total_equity: number;
  realized_pnl: number;
  unrealized_pnl?: number | null;
}

export interface DashboardOverview {
  total_realized_pnl: number;
  open_unrealized_pnl: number;
  active_bots: number;
  best_bot_id?: string | null;
  best_bot_name?: string | null;
  best_realized_pnl?: number | null;
  win_rate_closed?: number | null;
  total_closed_trades: number;
  open_trades_count: number;
  next_scheduled_run_iso?: string | null;
  /** Sum of starting capital across dashboard bots (when API provides it). */
  total_starting_capital?: number;
  /** Latest total equity across bots (when API provides it). */
  current_equity?: number;
  /** LONG predictions: wins / (wins + losses) on closed trades from those runs. */
  label_1_precision?: number | null;
  label_1_precision_sample?: number;
  best_bot_symbol?: string | null;
  best_bot_starting_capital?: number | null;
  best_bot_return_pct?: number | null;
  best_bot_max_drawdown_pct?: number | null;
  best_bot_label_1_precision?: number | null;
  best_bot_label_1_sample?: number;
}

export interface DashboardActivityItem {
  at: string;
  kind: 'prediction' | 'trade_closed' | 'trade_open' | string;
  symbol: string;
  bot_name?: string | null;
  title: string;
  subtitle?: string | null;
  pnl_amount?: number | null;
  confidence?: number | null;
}

export interface DashboardEquitySeries {
  bot_id: string;
  name?: string | null;
  symbol: string;
  points: BotEquityPoint[];
}

export interface DashboardBundle {
  overview: DashboardOverview;
  equity_by_bot: DashboardEquitySeries[];
  activity_feed?: DashboardActivityItem[];
}

export interface BotTradingSummary {
  id: string;
  symbol: string;
  model_filename?: string | null;
  started_at?: string | null;
  runtime_days?: number | null;
  lifecycle_state: string;
  derived_status: string;
  next_scheduled_run_iso?: string | null;
  days_running: number;
}

export interface BotTradingConfig {
  starting_capital: number;
  tp_pct?: number | null;
  sl_pct?: number | null;
  horizon_days: number;
  position_size_pct: number;
  commission_pct: number;
  slippage_pct: number;
  run_time?: string | null;
  timezone?: string | null;
}

export interface BotTradingPerformance {
  current_equity: number;
  realized_pnl: number;
  unrealized_pnl?: number | null;
  total_return_pct: number;
  accuracy_winning_trades_over_total_closed?: number | null;
  closed_trades_count: number;
  open_trades_count: number;
  predictions_count: number;
}

export interface BotOpenTradeRow {
  id: string;
  entry_date: string;
  entry_price: number;
  tp_price?: number | null;
  sl_price?: number | null;
  current_price?: number | null;
  unrealized_pnl: number;
  days_held: number;
}

export interface BotPredictionHistoryRow {
  run_id: string;
  run_at: string;
  chart_date?: string | null;
  signal?: string | null;
  confidence?: number | null;
  label?: string | null;
  status: string;
  trade_opened: boolean;
  linked_trade_id?: string | null;
}

/** Full GET /api/bots/:id/trading payload */
export interface BotTradingDetailFull {
  bot: Bot;
  summary: BotTradingSummary;
  config: BotTradingConfig;
  performance: BotTradingPerformance;
  open_trades_detail: BotOpenTradeRow[];
  closed_trades: BotTrade[];
  prediction_history: BotPredictionHistoryRow[];
  equity_history: BotEquityPoint[];
  recent_runs: BotRun[];
}

export interface Bot {
  id: string;
  user_id?: string | null;
  name?: string | null;
  symbol: string;
  model_path: string;
  model_filename?: string | null;
  confidence_threshold: number;
  img_size: number;
  tp_pct?: number | null;
  sl_pct?: number | null;
  runtime_days?: number | null;
  run_time?: string | null;
  timezone?: string | null;
  starting_capital?: number;
  horizon_days?: number;
  position_size_pct?: number;
  commission_pct?: number;
  slippage_pct?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  latest_run?: BotRun | null;
  /** active | waiting | running | error | paused | expired | closed | archived */
  derived_status?: string | null;
  /** active | paused | closed | archived */
  lifecycle_state?: string | null;
  next_scheduled_run_iso?: string | null;
}

export interface DashboardTradeRow {
  id: string;
  bot_id: string;
  bot_name: string;
  symbol: string;
  entry_date: string;
  exit_date?: string | null;
  status: string;
  pnl_amount?: number | null;
  pnl_pct?: number | null;
}

export const dashboardApi = {
  getBundle(): Promise<DashboardBundle> {
    return apiRequest<DashboardBundle>('/api/dashboard/bundle');
  },

  listTrades(botId?: string): Promise<DashboardTradeRow[]> {
    const q = botId ? `?bot_id=${encodeURIComponent(botId)}` : '';
    return apiRequest<DashboardTradeRow[]>(`/api/dashboard/trades${q}`);
  },

  resetTradingHistory(): Promise<{ ok: boolean; deleted_runs: number; deleted_trades: number; deleted_snapshots: number }> {
    return apiRequest(`/api/dashboard/reset-trading-history`, { method: 'POST' });
  },
};

export const botsApi = {
  createBot(formData: FormData): Promise<Bot> {
    return apiFormRequest<Bot>('/api/bots', formData);
  },

  listBots(): Promise<Bot[]> {
    return apiRequest<Bot[]>('/api/bots');
  },

  getBot(botId: string): Promise<{ bot: Bot; total_runs: number; success_runs: number; error_runs: number }> {
    return apiRequest<{ bot: Bot; total_runs: number; success_runs: number; error_runs: number }>(`/api/bots/${botId}`);
  },

  getTrading(botId: string): Promise<BotTradingDetailFull> {
    return apiRequest<BotTradingDetailFull>(`/api/bots/${botId}/trading`);
  },

  pauseBot(botId: string): Promise<Bot> {
    return apiRequest<Bot>(`/api/bots/${botId}/pause`, { method: 'POST' });
  },

  resumeBot(botId: string): Promise<Bot> {
    return apiRequest<Bot>(`/api/bots/${botId}/resume`, { method: 'POST' });
  },

  closeBot(botId: string): Promise<BotTradingDetailFull> {
    return apiRequest<BotTradingDetailFull>(`/api/bots/${botId}/close`, { method: 'POST' });
  },

  archiveBot(botId: string): Promise<Bot> {
    return apiRequest<Bot>(`/api/bots/${botId}/archive`, { method: 'POST' });
  },

  getRuns(botId: string, limit = 10): Promise<BotRun[]> {
    return apiRequest<BotRun[]>(`/api/bots/${botId}/runs?limit=${limit}`);
  },

  toggle(botId: string): Promise<Bot> {
    return apiRequest<Bot>(`/api/bots/${botId}/toggle`, { method: 'POST' });
  },

  runNow(botId: string): Promise<BotRun> {
    return apiRequest<BotRun>(`/api/bots/${botId}/run-now`, { method: 'POST' });
  },

  remove(botId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/api/bots/${botId}`, { method: 'DELETE' });
  },

  getRunChartUrl(botId: string, runId: string): string {
    return apiUrl(`/api/bots/${botId}/runs/${runId}/chart`);
  },

  getRunHeatmapUrl(botId: string, runId: string): string {
    return apiUrl(`/api/bots/${botId}/runs/${runId}/heatmap`);
  },
};

// Utility functions
export function formatEta(elapsedSeconds: number, percentComplete: number): string {
  if (percentComplete <= 0) return 'Calculating...';

  const remainingPercent = Math.max(0, 100 - percentComplete);
  const etaSeconds = (elapsedSeconds * remainingPercent) / percentComplete;

  if (etaSeconds < 60) {
    return `${Math.ceil(etaSeconds)}s remaining`;
  } else if (etaSeconds < 3600) {
    const minutes = Math.floor(etaSeconds / 60);
    const seconds = Math.ceil(etaSeconds % 60);
    return `${minutes}m ${seconds}s remaining`;
  } else {
    const hours = Math.floor(etaSeconds / 3600);
    const minutes = Math.floor((etaSeconds % 3600) / 60);
    return `${hours}h ${minutes}m remaining`;
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secondsRemain = Math.floor(seconds % 60);
    return `${minutes}m ${secondsRemain}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}
