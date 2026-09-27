const NAME_KEY = "convolve_profile_name";
const EMAIL_KEY = "convolve_profile_email";

export const DEFAULT_PROFILE_NAME = "Trader";
export const DEFAULT_PROFILE_EMAIL = "you@convolve.ai";

/** Locally-stored display profile (no real auth backend yet). */
export function getProfileName(): string {
  if (typeof window === "undefined") return DEFAULT_PROFILE_NAME;
  try {
    return localStorage.getItem(NAME_KEY)?.trim() || DEFAULT_PROFILE_NAME;
  } catch {
    return DEFAULT_PROFILE_NAME;
  }
}

export function setProfileName(value: string): void {
  try {
    localStorage.setItem(NAME_KEY, value.trim());
  } catch {
    /* ignore */
  }
}

export function getProfileEmail(): string {
  if (typeof window === "undefined") return DEFAULT_PROFILE_EMAIL;
  try {
    return localStorage.getItem(EMAIL_KEY)?.trim() || DEFAULT_PROFILE_EMAIL;
  } catch {
    return DEFAULT_PROFILE_EMAIL;
  }
}

export function setProfileEmail(value: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, value.trim());
  } catch {
    /* ignore */
  }
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "T";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
