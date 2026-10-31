/** Earning promotional credits: questionnaire, citation bonus and the ambassador programme (no React, no fetch). */

export type CitationClaim = {
  id: string;
  url: string | null;
  note: string | null;
  file_name: string | null;
  has_file: boolean;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  credits_granted: number;
  created_at: string | null;
  reviewed_at: string | null;
};

/** What one invite earns, by the friend's first paid plan (from the server). */
export type ReferralReward = {
  tier_id: string;
  tier_name: string;
  referee_credits: number;
  referrer: "credits" | "free_month";
  referrer_credits: number;
  free_month_tier: string | null;
};

export type RewardsStatus = {
  questionnaire: { credits: number; completed: boolean };
  citation: { credits: number; status: "none" | CitationClaim["status"]; claims: CitationClaim[]; max_file_bytes: number };
  ambassador: {
    code: string | null;
    referee_credits: number;
    reward_tier: string | null;
    rewards: ReferralReward[];
    invited: number;
    subscribed: number;
    months_earned: number;
    credits_earned: number;
    max_rewards_per_year: number;
    free_month_until: string | null;
  };
  referred: { status: "pending" | "rewarded" | "reversed"; credits: number | null; rewards: ReferralReward[] } | null;
};

/** Consecutive plans with the same reward, e.g. [["Starter"], ["Research", "Professional"]]. */
function groups<K>(rewards: ReferralReward[], key: (r: ReferralReward) => K): { names: string[]; r: ReferralReward }[] {
  const out: { names: string[]; r: ReferralReward; k: string }[] = [];
  for (const r of rewards) {
    const k = JSON.stringify(key(r));
    const last = out[out.length - 1];
    if (last && last.k === k) last.names.push(r.tier_name);
    else out.push({ names: [r.tier_name], r, k });
  }
  return out;
}

const either = (names: string[]) => names.join(" or ");

/** "5 credits with Starter, 20 credits with Research or Professional" */
export function friendRewardText(rewards: ReferralReward[]): string {
  return groups(rewards, (r) => r.referee_credits)
    .map((g) => `${g.r.referee_credits} credits with ${either(g.names)}`)
    .join(", ");
}

/** "10 credits when they start Starter; a free month of Research when they start Research or Professional" */
export function ambassadorRewardText(rewards: ReferralReward[]): string {
  return groups(rewards, (r) => [r.referrer, r.referrer_credits])
    .map((g) =>
      g.r.referrer === "free_month"
        ? `a free month of ${g.r.free_month_tier ?? "Research"} when they start ${either(g.names)}`
        : `${g.r.referrer_credits} credits when they start ${either(g.names)}`,
    )
    .join("; ");
}

export function maxFriendCredits(rewards: ReferralReward[], fallback = 20): number {
  return rewards.length ? Math.max(...rewards.map((r) => r.referee_credits)) : fallback;
}

export const REFERRAL_PARAM = "ref";
export const REFERRAL_STORAGE_KEY = "convolve.referral";
/** How long a remembered invite code waits for sign-up and email confirmation. */
export const REFERRAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CITATION_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

/** Same rules as the server: letters and digits only, 4 to 16 characters, case-insensitive. */
export function normaliseCode(raw: string | null | undefined): string | null {
  const c = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(c) ? c : null;
}

export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/signup?${REFERRAL_PARAM}=${encodeURIComponent(code)}`;
}

export function inviteMessage(code: string, link: string, credits: number): string {
  return (
    `I use Convolve to test whether chart patterns actually predict anything. ` +
    `Sign up with my link and you get up to ${credits} bonus credits when you start a plan: ${link} (invite code ${code})`
  );
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function rememberReferral(store: KV, code: string, now = Date.now()): void {
  store.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code, at: now }));
}

/** The remembered invite code, or null when there is none or it has expired. */
export function pendingReferral(store: KV, now = Date.now()): string | null {
  try {
    const raw = store.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { code?: string; at?: number };
    const code = normaliseCode(v.code);
    if (!code || typeof v.at !== "number" || now - v.at > REFERRAL_TTL_MS) {
      store.removeItem(REFERRAL_STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    store.removeItem(REFERRAL_STORAGE_KEY);
    return null;
  }
}

/** A claim that failed for good (invalid, own code, not a new account) is forgotten; outages and sign-in gaps are retried. */
export function shouldForgetAfter(status: number): boolean {
  return status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export function citationFileProblem(file: { size: number; type: string } | null, maxBytes: number): string | null {
  if (!file) return null;
  if (!CITATION_FILE_TYPES.includes(file.type)) return "Attach a PDF, PNG, JPEG or WebP file.";
  if (file.size > maxBytes) return `Files can be up to ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  return null;
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}
