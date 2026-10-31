import assert from "node:assert/strict";
import test from "node:test";
import { createEtaEstimator, formatRemaining } from "./eta";
import { advanceSmooth, initialSmooth } from "./smoothProgress";

test("start-up time on a flat plateau does not inflate the estimate", () => {
  const eta = createEtaEstimator();
  // 20 s of container start at 5%, then 1% per second.
  for (let t = 0; t <= 20_000; t += 1_500) eta.record(0.05, t);
  assert.equal(eta.remainingSeconds(20_000), null);
  let left: number | null = null;
  for (let s = 1; s <= 10; s++) {
    eta.record(0.05 + s * 0.01, 20_000 + s * 1_000);
    left = eta.remainingSeconds(20_000 + s * 1_000);
  }
  // 85% left at 1% per second is 85 s; counting the plateau would give several minutes.
  assert.ok(left != null && left > 60 && left < 110, `got ${left}`);
});

test("no estimate before real work has been measured", () => {
  const eta = createEtaEstimator();
  eta.record(0.01, 0);
  eta.record(0.012, 1_000);
  assert.equal(eta.remainingSeconds(1_000), null);
});

test("readout is rounded and calm", () => {
  assert.equal(formatRemaining(3), "almost done");
  assert.equal(formatRemaining(42), "about 40s left");
  assert.equal(formatRemaining(150), "about 2½ min left");
  assert.equal(formatRemaining(null), null);
});

test("the bar moves during start-up but stays close to the real value", () => {
  let s = initialSmooth(0, 0);
  s = advanceSmooth(s, 0, 10_000);
  assert.ok(s.shown > 0.05 && s.shown <= 0.12, `start-up ${s.shown}`);
  s = advanceSmooth(s, 0.5, 11_000);
  s = advanceSmooth(s, 0.5, 120_000);
  assert.ok(s.shown >= 0.5 && s.shown <= 0.62, `lead ${s.shown}`);
});

test("the bar never goes backwards and only reaches 100% when done", () => {
  let s = initialSmooth(0.4, 0);
  s = advanceSmooth(s, 0.4, 60_000);
  const high = s.shown;
  s = advanceSmooth(s, 0.3, 61_000);
  assert.ok(s.shown >= high);
  s = advanceSmooth(s, 0.999, 62_000);
  s = advanceSmooth(s, 0.999, 600_000);
  assert.ok(s.shown < 1);
  assert.equal(advanceSmooth(s, 0.999, 600_001, true).shown, 1);
});
