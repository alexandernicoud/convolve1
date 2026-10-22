/**
 * Large-file uploads.
 *
 * Cloud Run rejects request bodies over 32 MiB, so in cloud the API hands out a
 * resumable Cloud Storage session, the browser PUTs the file straight to it, and
 * a finalize call ingests the stored object. Local dev answers `multipart` and
 * the existing form-upload routes are used unchanged.
 */
import { apiUrl, fetchApi } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase";

export type UploadKind = "dataset" | "model";

export class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "UploadError";
  }
}

type InitResponse =
  | { mode: "multipart" }
  | { mode: "direct"; upload_id: string; upload_url: string; method: "PUT"; size: number };

type Progress = (fraction: number) => void;

async function errorFrom(res: Response, fallback: string): Promise<UploadError> {
  const text = await res.text().catch(() => "");
  let message = text || fallback;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.detail === "string") message = parsed.detail;
  } catch {
    // keep the raw text
  }
  return new UploadError(message, res.status);
}

function xhrSend(
  method: string,
  url: string,
  body: Blob | FormData,
  headers: Record<string, string>,
  onProgress?: Progress,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
        return;
      }
      let message = `Upload failed with status ${xhr.status}`;
      try {
        const parsed = JSON.parse(xhr.responseText);
        if (parsed && typeof parsed.detail === "string") message = parsed.detail;
      } catch {
        // keep the generic message
      }
      reject(new UploadError(message, xhr.status));
    });
    xhr.addEventListener("error", () => reject(new UploadError("Network error during upload", 0)));
    xhr.addEventListener("timeout", () => reject(new UploadError("Upload timed out", 0)));
    xhr.addEventListener("abort", () => reject(new UploadError("Upload was cancelled", 0)));
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.send(body);
  });
}

async function initUpload(kind: UploadKind, file: File): Promise<InitResponse> {
  const res = await fetchApi("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      filename: file.name,
      size: file.size,
      content_type: file.type || "application/octet-stream",
    }),
  });
  // Older backends without the endpoint still accept form uploads.
  if (res.status === 404) return { mode: "multipart" };
  if (!res.ok) throw await errorFrom(res, `Could not start upload (${res.status})`);
  return (await res.json()) as InitResponse;
}

/**
 * Send the file to storage when the backend supports it.
 * Returns the upload id to finalize, or null when the caller should use its multipart route.
 */
export async function stageUpload(kind: UploadKind, file: File, onProgress?: Progress): Promise<string | null> {
  const init = await initUpload(kind, file);
  if (init.mode !== "direct") return null;
  await xhrSend(
    "PUT",
    init.upload_url,
    file,
    { "Content-Type": file.type || "application/octet-stream" },
    onProgress,
  );
  return init.upload_id;
}

async function postMultipart<T>(path: string, form: FormData, onProgress?: Progress): Promise<T> {
  const token = await getAccessToken();
  const text = await xhrSend("POST", apiUrl(path), form, token ? { Authorization: `Bearer ${token}` } : {}, onProgress);
  return JSON.parse(text) as T;
}

async function finalize<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await errorFrom(res, `Upload could not be processed (${res.status})`);
  return (await res.json()) as T;
}

export async function uploadDataset<T>(
  file: File,
  options: { source?: string; generatorRunId?: string; onProgress?: Progress } = {},
): Promise<T> {
  const { source, generatorRunId, onProgress } = options;
  const uploadId = await stageUpload("dataset", file, onProgress);
  if (uploadId) {
    return finalize<T>(`/api/uploads/${uploadId}/dataset`, {
      source: source ?? null,
      generator_run_id: generatorRunId ?? null,
    });
  }
  const form = new FormData();
  form.append("file", file);
  if (source) form.append("source", source);
  if (generatorRunId) form.append("generator_run_id", generatorRunId);
  return postMultipart<T>("/datasets/upload", form, onProgress);
}

export async function uploadModel<T>(file: File, onProgress?: Progress): Promise<T> {
  const uploadId = await stageUpload("model", file, onProgress);
  if (uploadId) return finalize<T>(`/api/uploads/${uploadId}/model`);
  const form = new FormData();
  form.append("file", file);
  return postMultipart<T>("/models/upload", form, onProgress);
}
