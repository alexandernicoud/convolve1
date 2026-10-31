import assert from "node:assert/strict";
import test from "node:test";
import {
  REFERRAL_STORAGE_KEY,
  REFERRAL_TTL_MS,
  citationFileProblem,
  inviteLink,
  ambassadorRewardText,
  friendRewardText,
  inviteMessage,
  maxFriendCredits,
  isHttpUrl,
  normaliseCode,
  pendingReferral,
  rememberReferral,
  shouldForgetAfter,
} from "./model";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

test("invite codes are normalised like the server does", () => {
  assert.equal(normaliseCode(" ab cd-2345 "), "ABCD2345");
  assert.equal(normaliseCode("x"), null);
  assert.equal(normaliseCode("<script>"), null);
  assert.equal(normaliseCode(null), null);
});

test("the invite link points at sign-up with the code", () => {
  const link = inviteLink("https://convolve.app/", "ABCD2345");
  assert.equal(link, "https://convolve.app/signup?ref=ABCD2345");
  const msg = inviteMessage("ABCD2345", link, 20);
  assert.ok(msg.includes(link) && msg.includes("ABCD2345") && msg.includes("up to 20 bonus credits"));
});

test("a remembered code survives sign-up but expires", () => {
  const s = memory();
  rememberReferral(s, "ABCD2345", 1000);
  assert.equal(pendingReferral(s, 2000), "ABCD2345");
  assert.equal(pendingReferral(s, 1000 + REFERRAL_TTL_MS + 1), null);
  assert.equal(s.getItem(REFERRAL_STORAGE_KEY), null);
  s.setItem(REFERRAL_STORAGE_KEY, "not json");
  assert.equal(pendingReferral(s), null);
});

test("only final refusals forget the code", () => {
  assert.equal(shouldForgetAfter(200), true);
  assert.equal(shouldForgetAfter(404), true);
  assert.equal(shouldForgetAfter(409), true);
  assert.equal(shouldForgetAfter(401), false);
  assert.equal(shouldForgetAfter(503), false);
});

test("citation proof is checked before upload", () => {
  assert.equal(citationFileProblem(null, 5 << 20), null);
  assert.equal(citationFileProblem({ size: 10, type: "application/pdf" }, 5 << 20), null);
  assert.match(citationFileProblem({ size: 10, type: "application/zip" }, 5 << 20) ?? "", /PDF, PNG/);
  assert.match(citationFileProblem({ size: 6 << 20, type: "image/png" }, 5 << 20) ?? "", /5 MB/);
  assert.equal(isHttpUrl("https://example.org/paper"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("example.org"), false);
});

test("invite rewards are described per plan, grouping plans with the same reward", () => {
  const rewards = [
    { tier_id: "starter", tier_name: "Starter", referee_credits: 5, referrer: "credits" as const, referrer_credits: 10, free_month_tier: null },
    { tier_id: "research", tier_name: "Research", referee_credits: 20, referrer: "free_month" as const, referrer_credits: 0, free_month_tier: "Research" },
    { tier_id: "professional", tier_name: "Professional", referee_credits: 20, referrer: "free_month" as const, referrer_credits: 0, free_month_tier: "Research" },
  ];
  assert.equal(friendRewardText(rewards), "5 credits with Starter, 20 credits with Research or Professional");
  assert.equal(
    ambassadorRewardText(rewards),
    "10 credits when they start Starter; a free month of Research when they start Research or Professional",
  );
  assert.equal(maxFriendCredits(rewards), 20);
  assert.equal(maxFriendCredits([]), 20);
});
