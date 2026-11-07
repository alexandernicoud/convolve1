/** Public founder profile — same as About / Founders. Links back to we-convolve.com from LinkedIn. */
export const FOUNDER_LINKEDIN_URL = "https://www.linkedin.com/in/alexander-nicoud-11a707398/";

/**
 * Optional Instagram profile. Empty until `VITE_FOUNDER_INSTAGRAM_URL` is set to a real handle —
 * never fall back to instagram.com (that is not a Convolve profile).
 */
export const FOUNDER_INSTAGRAM_URL = import.meta.env.VITE_FOUNDER_INSTAGRAM_URL?.trim() || "";

export function getFounderEmail(): string | undefined {
  const v = import.meta.env.VITE_FOUNDER_EMAIL?.trim();
  return v || undefined;
}
