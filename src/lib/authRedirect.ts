/** Default local Vite origin. Never mix with 127.0.0.1 — PKCE storage is origin-scoped. */
export const LOCAL_DEV_ORIGIN = "http://localhost:5173";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * Dev origin as listed in the Supabase redirect allow-list: loopback IPs become `localhost`, the
 * port is kept (5173, 5174, …). Production origins are returned unchanged.
 */
export function canonicalDevOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (LOOPBACK_HOSTS.has(url.hostname)) url.hostname = "localhost";
    return url.origin;
  } catch {
    return LOCAL_DEV_ORIGIN;
  }
}

export function safeAppPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  const path = (raw || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return fallback;
  return path;
}

export function oauthCallbackPath(nextPath: string): string {
  const next = safeAppPath(nextPath);
  return `/auth/callback?next=${encodeURIComponent(next)}`;
}

export function oauthRedirectTo(origin: string, nextPath: string, isDev: boolean): string {
  const base = (isDev ? canonicalDevOrigin(origin) : origin).replace(/\/+$/, "");
  return `${base}${oauthCallbackPath(nextPath)}`;
}

function paramsFrom(search: string, hash: string): URLSearchParams {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const merged = new URLSearchParams(query);
  const hashParams = new URLSearchParams(fragment);
  hashParams.forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  return merged;
}

export function parseOAuthCallbackError(search: string, hash = ""): string | null {
  const params = paramsFrom(search, hash);
  const error = params.get("error");
  const description = params.get("error_description");
  if (!error && !description) return null;
  const text = [error, description].filter(Boolean).join(": ").replace(/\+/g, " ");
  return text.trim() || "Sign in failed";
}

export function urlHasAuthCallbackParams(search: string, hash = ""): boolean {
  const params = paramsFrom(search, hash);
  return Boolean(
    params.get("code") ||
      params.get("access_token") ||
      params.get("error") ||
      params.get("error_description"),
  );
}
