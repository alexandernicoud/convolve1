/** Public founder profile — same as About / Founders. */
export const FOUNDER_LINKEDIN_URL = "https://www.linkedin.com/in/alexander-nicoud-11a707398/";

/** Optional — set `VITE_FOUNDER_INSTAGRAM_URL` in `.env` when the handle is public. */
export const FOUNDER_INSTAGRAM_URL =
  import.meta.env.VITE_FOUNDER_INSTAGRAM_URL?.trim() || "https://www.instagram.com/";

export function getFounderEmail(): string | undefined {
  const v = import.meta.env.VITE_FOUNDER_EMAIL?.trim();
  return v || undefined;
}
