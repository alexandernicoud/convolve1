import assert from "node:assert/strict";
import test from "node:test";
import {
  asBillingBlock,
  cancellationConsequences,
  countryOptions,
  currencyExponent,
  describeQuota,
  formatMinor,
  formatTierPrice,
  REFUND_CLARIFIER,
  REFUND_HEADLINE,
  checkoutConfirmed,
  itemName,
  percent,
  planPath,
  signupForPlan,
  type RefundQuote,
} from "./model";

test("item names are shown instead of catalogue ids", () => {
  assert.equal(itemName("research_pack"), "Research Pack");
  assert.equal(itemName("professional"), "Professional");
  assert.equal(itemName(null), "Credit pack");
  assert.equal(itemName("future_pack"), "future_pack");
});

test("minor units are shown with the currency's own precision and never re-rounded", () => {
  assert.equal(currencyExponent("USD"), 2);
  assert.equal(currencyExponent("jpy"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(formatMinor(1523, "USD", "en-US"), "$15.23");
  assert.equal(formatMinor(1523, "JPY", "en-US"), "¥1,523");
  assert.equal(formatMinor(1523, "KWD", "en-US").replace(/\s/g, " "), "KWD 1.523");
  assert.equal(formatTierPrice({ amount_minor: 499, currency: "USD", interval: "month" }, "en-US"), "$4.99 / month");
  assert.equal(percent(5000), "50%");
});

test("only billing refusals become blocks", () => {
  assert.equal(asBillingBlock({ code: "insufficient_credits", message: "x" }), null);
  assert.equal(asBillingBlock("Bot not found"), null);
  const b = asBillingBlock({ code: "feature_locked", message: "Needs Research", feature: "lab.advanced", required_tier: "research", required_tier_name: "Research" });
  assert.equal(b?.code, "feature_locked");
});

test("quota text", () => {
  assert.equal(describeQuota({ limit: 3, used: 1 }), "1 of 3");
  assert.equal(describeQuota({ limit: null, used: 4 }), "4 (no limit)");
});

test("cancel-and-refund states what happens to the subscription, bots and reserved credits", () => {
  const quote: RefundQuote = {
    lots: [],
    totals: [],
    reserved_credits: 12,
    voluntary_rate_bps: 5000,
    subscription: { active: true, tier_id: "starter", access_until: "2026-11-25T00:00:00Z" },
  };
  const lines = cancellationConsequences(quote, {
    subscription: {
      active: true, status: "active", tier_id: "starter", subscribed_tier_id: "starter", pending_tier_id: null,
      period_start: null, period_end: "2026-11-25T00:00:00Z", cancel_at_period_end: false, country: "CH", read_only: false,
    },
  });
  assert.ok(lines.some((l) => l.includes("will not renew") && l.includes("nothing ends early")));
  assert.ok(lines.some((l) => l.includes("bots") && l.includes("not deleted")));
  assert.ok(lines.some((l) => l.includes("12 credits")));
});

test("blocked countries are flagged, not hidden", () => {
  const us = countryOptions(["US"], "en").find((c) => c.code === "US");
  assert.equal(us?.blocked, true);
  assert.equal(countryOptions(["US"], "en").find((c) => c.code === "CH")?.blocked, false);
});

test("pricing buttons keep the chosen plan through signup", () => {
  assert.equal(planPath("professional"), "/account?tab=plan&plan=professional");
  assert.equal(signupForPlan("research"), "/signup?next=%2Faccount%3Ftab%3Dplan%26plan%3Dresearch");
});

test("refund copy states 50% of the amount paid for unused purchased credits only", () => {
  assert.equal(REFUND_HEADLINE(5000), "Cancel anytime and get a 50% refund of unused purchased credits. No questions asked!");
  assert.match(REFUND_CLARIFIER(5000), /50% of the amount you originally paid/);
  assert.match(REFUND_CLARIFIER(5000), /subscription and promotional credits are not refundable/);
  assert.match(REFUND_CLARIFIER(5000), /mandatory consumer rights are not affected/);
});

test("a returning checkout is confirmed only once the server shows it", () => {
  const sub = { active: false, status: "none", tier_id: null, subscribed_tier_id: null, pending_tier_id: null, period_start: null,
    period_end: null, cancel_at_period_end: false, country: null, read_only: true };
  const bal = { subscription: 0, grant: 0, purchase: 100, legacy: 0, total: 100, reserved: 0, subscription_expires_at: null };
  const wantSub = { kind: "subscription" as const, item_id: "research", purchase_before: 100, at: 0 };
  assert.equal(checkoutConfirmed(wantSub, { subscription: sub, balances: bal }), false);
  assert.equal(checkoutConfirmed(wantSub, { subscription: { ...sub, active: true, tier_id: "research", complimentary: true }, balances: bal }), false);
  assert.equal(checkoutConfirmed(wantSub, { subscription: { ...sub, active: true, tier_id: "research" }, balances: bal }), true);
  const wantPack = { kind: "topup" as const, item_id: "extra", purchase_before: 100, at: 0 };
  assert.equal(checkoutConfirmed(wantPack, { subscription: sub, balances: bal }), false);
  assert.equal(checkoutConfirmed(wantPack, { subscription: sub, balances: { ...bal, purchase: 200 } }), true);
});
