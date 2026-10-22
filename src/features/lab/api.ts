import { ApiError, fetchApi } from "@/lib/api";

export type ModelKind = "trained" | "uploaded";
export type ModelRef = { model_kind: ModelKind; model_id: string; dataset_id?: string | null };
export type ExperimentKind = "atlas" | "sensitivity" | "faithfulness" | "features" | "embedding";
export type Method = "gradcam" | "saliency" | "smoothgrad" | "occlusion" | "activations";

/** 8-bit grayscale PNG (base64) plus the value range it encodes. */
export type EncodedMap = {
  png: string;
  shape: [number, number];
  min: number;
  max: number;
  normalization: string;
  all_zero?: boolean;
  raw_max?: number;
  foreground_share?: number | null;
  patch?: number;
  stride?: number;
  min_delta?: number;
  max_delta?: number;
};

export type CI = { mean: number | null; lo: number | null; hi: number | null; n?: number; n_a?: number; n_b?: number };
export type Prop = { p: number | null; lo: number | null; hi: number | null; k: number; n: number };

export type LabContext = {
  model: {
    kind: ModelKind;
    id: string;
    fingerprint: string;
    input_size: [number, number];
    preprocessing: string;
    head: "sigmoid" | "softmax";
    n_classes: number;
    conv_layers: { name: string; output_shape: number[] }[];
    default_layer: string;
    penultimate_dim: number;
    layers: { name: string; type: string; output_shape: (number | null)[]; params: number }[];
  };
  default_dataset_id: string | null;
  dataset: null | {
    id: string;
    n_images: number;
    truncated: boolean;
    labels: Record<string, number>;
    symbols: { symbol: string; n: number }[];
    date_range: [string, string] | null;
    layout: { verified: boolean; source: string | null };
    split: { status: "recorded" | "reconstructed" | "unknown" | "not_applicable"; n_validation: number | null; note: string };
  };
  methods: Record<string, string>;
  baselines: Record<string, string>;
  limits: Record<ExperimentKind, number>;
};

export type LabImage = {
  id: string;
  label: number | null;
  symbol: string | null;
  start: string | null;
  end: string | null;
  split: "validation" | "training" | null;
  probs?: number[];
  pred?: number;
};

export type ActivationChannel = { channel: number; mean: number; max: number; map: EncodedMap };

export type ExplainResult = {
  probabilities: number[];
  predicted_class: number;
  target_class: number;
  layer: string;
  foreground_fraction: number;
  maps: {
    gradcam?: EncodedMap;
    saliency?: EncodedMap;
    smoothgrad?: EncodedMap;
    occlusion?: EncodedMap;
    activations?: { layer_shape: number[]; normalization: string; vmax: number; active_channels: number; channels: ActivationChannel[] };
  };
  notes: Record<string, string>;
  image: LabImage;
  identity: { fingerprint: string; preprocessing: string; input_size: [number, number] };
};

export type InterveneResult = {
  rect: [number, number, number, number];
  baseline: string;
  baseline_note: string;
  target_class: number;
  original: number[];
  modified: number[];
  delta_target: number;
  flipped: boolean;
  masked_area: number;
  masked_foreground: number;
  modified_png: string;
};

export type ActMaxResult = { layer: string; channel: number; steps: number; objective_trace: number[]; stalled: boolean; png: string; note: string };

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export type LabJob = {
  job_id: string;
  kind: ExperimentKind;
  params: Record<string, unknown>;
  created_at: number;
  has_result: boolean;
  status: JobStatus;
  progress: number | null;
  message?: string;
  started_at?: number;
  finished_at?: number;
  result?: Record<string, unknown> | null;
};

export type LabSession = {
  session_id: string;
  model: { kind: ModelKind; id: string };
  dataset_id: string;
  fingerprint: string;
  created_at: number;
  registered?: boolean;
  jobs?: number;
  completed?: string[];
};

export type Finding = {
  id: string;
  module: ExperimentKind;
  status: "observation" | "hypothesis" | "supported" | "inconclusive";
  title: string;
  observation: string;
  measurement: { label: string; value: number | null; lo: number | null; hi: number | null; unit: string } | null;
  n: number | null;
  baseline: string | null;
  limitations: string[];
  link: { module: ExperimentKind; job_id: string };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchApi(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ");
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  return u.toString();
};

export const labApi = {
  context: (ref: ModelRef) => request<LabContext>(`/api/lab/context?${qs(ref)}`),
  images: (ref: ModelRef, f: { label?: number | null; symbol?: string | null; split?: string; q?: string; offset?: number; limit?: number; predict?: boolean }) =>
    request<{ total: number; offset: number; items: LabImage[]; split_status: string }>(`/api/lab/images?${qs({ ...ref, ...f })}`),
  imagePath: (ref: ModelRef, imageId: string) => `/api/lab/image?${qs({ ...ref, image_id: imageId })}`,
  explain: (ref: ModelRef, body: { image_id: string; target?: string; layer?: string; methods: Method[]; channels?: number[]; top_channels?: number }) =>
    request<ExplainResult>("/api/lab/explain", { method: "POST", body: JSON.stringify({ ...ref, ...body }) }),
  intervene: (ref: ModelRef, body: { image_id: string; rect: [number, number, number, number]; baseline: string; target?: string }) =>
    request<InterveneResult>("/api/lab/intervene", { method: "POST", body: JSON.stringify({ ...ref, ...body }) }),
  actmax: (ref: ModelRef, body: { layer: string; channel: number; steps?: number }) =>
    request<ActMaxResult>("/api/lab/actmax", { method: "POST", body: JSON.stringify({ ...ref, ...body }) }),
  submit: (ref: ModelRef, body: { session_id?: string | null; kind: ExperimentKind; params: Record<string, unknown> }) =>
    request<{ session_id: string; job_id: string; reused: boolean }>("/api/lab/jobs", { method: "POST", body: JSON.stringify({ ...ref, ...body }) }),
  sessions: (f: { model_kind?: ModelKind; model_id?: string }) => request<{ sessions: LabSession[] }>(`/api/lab/sessions?${qs(f)}`),
  session: (id: string) => request<{ session: LabSession; jobs: LabJob[] }>(`/api/lab/sessions/${encodeURIComponent(id)}`),
  job: (sid: string, jid: string) => request<LabJob>(`/api/lab/sessions/${encodeURIComponent(sid)}/jobs/${encodeURIComponent(jid)}`),
  cancel: (sid: string, jid: string) => request<{ cancel_requested: boolean }>(`/api/lab/sessions/${encodeURIComponent(sid)}/jobs/${encodeURIComponent(jid)}/cancel`, { method: "POST" }),
  findings: (sid: string) => request<{ findings: Finding[]; sources: Record<string, string>; rules: string }>(`/api/lab/sessions/${encodeURIComponent(sid)}/findings`),
};
