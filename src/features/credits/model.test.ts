import assert from "node:assert/strict";
import test from "node:test";
import { costFor, costMap, describeCost, describePlanCredits, formatPrice, shouldBlock } from "./model";

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

test("undecided prices are not rendered as numbers", () => {
  assert.equal(formatPrice(null), null);
  assert.equal(formatPrice({ amount: 0, currency: null, interval: null }), "Free");
  assert.equal(formatPrice({ amount: 12, currency: null, interval: null }), null);
  assert.equal(describePlanCredits(null), null);
  assert.equal(describePlanCredits({ amount: 50, cadence: "one_time" }), "50 credits to start");
});
