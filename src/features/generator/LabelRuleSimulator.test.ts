import assert from "node:assert/strict";
import test from "node:test";
import { buildSyntheticBars, labelRuleLayout } from "./labelRuleModel";

test("buildSyntheticBars returns the requested OHLC length", () => {
  const bars = buildSyntheticBars(20, 3);
  assert.equal(bars.length, 20);
  for (const b of bars) {
    assert.ok(b.high >= b.open && b.high >= b.close);
    assert.ok(b.low <= b.open && b.low <= b.close);
    assert.ok(b.close > 0);
  }
});

test("labelRuleLayout places entry after lookback and sizes the horizon", () => {
  const L = labelRuleLayout({
    lookback: 24,
    horizon: 7,
    takeProfitFraction: 0.02,
    stopLossFraction: 0.01,
  });
  assert.equal(L.lookback, 24);
  assert.equal(L.horizon, 7);
  assert.equal(L.entryIndex, 24);
  assert.equal(L.totalBars, 24 + 1 + 7);
  assert.equal(L.tp, 0.02);
  assert.equal(L.sl, 0.01);
});

test("labelRuleLayout clamps invalid fractions and rounds bars", () => {
  const L = labelRuleLayout({
    lookback: 10.6,
    horizon: 0,
    takeProfitFraction: Number.NaN,
    stopLossFraction: -0.5,
  });
  assert.equal(L.lookback, 11);
  assert.equal(L.horizon, 1);
  assert.equal(L.tp, 0);
  assert.equal(L.sl, 0);
});
