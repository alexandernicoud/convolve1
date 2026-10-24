import assert from "node:assert/strict";
import test from "node:test";
import {
  costFor,
  costMap,
  describeCost,
  describePlanCredits,
  estimateBadge,
  formatPrice,
  isRunStartPath,
  needsRunConfirmation,
  runButtonCost,
  shouldBlock,
} from "./model";

test("only run-start endpoints carry the confirmed price", () => {
  for (const p of [
    "/api/training-chart-generator/run",
    "/trainer/runs",
    "/trainer/runs/20260101_000000_abc/analysis",
    "/trainer/analysis/standalone",
    "/runs/backtester/start",
    "/api/backtests/run",
    "/runs/testdata/start",
    "/api/labeling-optimizer/run",
  ]) {
    assert.equal(isRunStartPath(p), true, p);
  }
  for (const p of ["/api/credits/quote", "/trainer/runs/x/cancel", "/api/bots", "/api/account/onboarding"]) {
    assert.equal(isRunStartPath(p), false, p);
  }
});

test("estimate badges never imply a deduction while charging is off", () => {
  assert.equal(estimateBadge("off", { kind: "fixed", credits: 6 }), "Not charged in beta");
  assert.equal(estimateBadge(null, { kind: "fixed", credits: 6 }), "Not charged in beta");
  assert.equal(estimateBadge("enforce", { kind: "fixed", credits: 6 }), "Fixed price");
  assert.equal(estimateBadge("enforce", { kind: "estimated", credits: 6 }), "Estimate");
  assert.equal(estimateBadge("enforce", { kind: "fixed", credits: 0 }), "No charge");
});

test("confirmation follows the server's flags", () => {
  const pricing = { confirm: false } as never;
  assert.equal(needsRunConfirmation({ mode: "enforce", confirm: true, pricing }), true);
  assert.equal(needsRunConfirmation({ mode: "enforce", confirm: false, pricing }), false);
  assert.equal(needsRunConfirmation({ mode: "off", confirm: true, pricing }), false);
  assert.equal(needsRunConfirmation({ mode: "off", confirm: false, pricing: { confirm: true } as never }), true);
});

test("costs come from the server catalogue; unknown tools are free", () => {
  const costs = costMap([
    { tool: "trainer", label: "CNN training", credits: 10 },
    { tool: "backtester", label: "Backtest", credits: 10 },
  ]);
  assert.equal(costFor(costs, "trainer"), 10);
  assert.equal(costFor(costs, "bot"), 0);
  assert.equal(costFor({}, "trainer"), 0);
});

test("the client only blocks when the server enforces and the balance is known to be short", () => {
  assert.equal(shouldBlock("enforce", 5, 10), true);
  assert.equal(shouldBlock("enforce", 10, 10), false);
  assert.equal(shouldBlock("enforce", null, 10), false);
  assert.equal(shouldBlock("off", 0, 10), false);
  assert.equal(shouldBlock(null, 0, 10), false);
  assert.equal(shouldBlock("enforce", 0, 0), false);
});

test("cost hints are honest about charging", () => {
  assert.equal(describeCost("enforce", 10), "10 credits");
  assert.equal(describeCost("off", 10), "10 credits · not charged yet");
  assert.equal(describeCost("enforce", 0), "No credit charge");
});

test("run buttons show only a server quote, never a guessed price", () => {
  const q = (cost: number, kind: "fixed" | "estimated" = "fixed") => ({ cost, pricing: { kind } as never });
  assert.equal(runButtonCost(null, true), "calculating cost…");
  assert.equal(runButtonCost(q(6), true), "calculating cost…");
  assert.equal(runButtonCost(null, false), "cost unavailable");
  assert.equal(runButtonCost(q(6), false), "6 credits");
  assert.equal(runButtonCost(q(1), false), "1 credit");
  assert.equal(runButtonCost(q(14, "estimated"), false), "est. 14 credits");
  assert.equal(runButtonCost(q(0), false), "no charge");
});

test("undecided prices are not rendered as numbers", () => {
  assert.equal(formatPrice(null), null);
  assert.equal(formatPrice({ amount: 0, currency: null, interval: null }), "Free");
  assert.equal(formatPrice({ amount: 12, currency: null, interval: null }), null);
  assert.equal(describePlanCredits(null), null);
  assert.equal(describePlanCredits({ amount: 50, cadence: "one_time" }), "50 credits to start");
});
