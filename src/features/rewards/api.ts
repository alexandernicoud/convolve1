import { fetchApi } from "@/lib/api";
import { useApi } from "@/features/account/data";
import { readError } from "@/features/account/ui";
import type { ReferralReward, RewardsStatus } from "./model";

export const useRewards = () => useApi<RewardsStatus>("/api/rewards");

export async function createReferralCode(): Promise<string> {
  const res = await fetchApi("/api/rewards/referral-code", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { code: string }).code;
}

type CodeCheck = { valid: boolean; credits_on_subscribe: number; rewards?: ReferralReward[] };

export async function checkReferralCode(code: string): Promise<CodeCheck> {
  const res = await fetchApi(`/api/referrals/check?code=${encodeURIComponent(code)}`);
  if (!res.ok) return { valid: false, credits_on_subscribe: 0 };
  return (await res.json()) as CodeCheck;
}

/** Returns the HTTP status so the caller can decide whether to keep the code for a retry. */
export async function claimReferral(code: string): Promise<number> {
  const res = await fetchApi("/api/referrals/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return res.status;
}

export async function submitCitation(input: { url: string; note: string; file: File | null }): Promise<void> {
  const form = new FormData();
  form.append("url", input.url.trim());
  form.append("note", input.note.trim());
  if (input.file) form.append("file", input.file);
  const res = await fetchApi("/api/rewards/citation", { method: "POST", body: form });
  if (!res.ok) throw new Error(await readError(res));
}
