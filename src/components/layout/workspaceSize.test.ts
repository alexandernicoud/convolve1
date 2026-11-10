import test from "node:test";
import assert from "node:assert/strict";
import { HEADER_HEIGHT, SIDEBAR_WIDTH, clampSize, headerMetrics, parseStoredSize, sidebarDensity } from "./workspaceSize";

test("stored sizes fall back to the default and are clamped to bounds", () => {
  assert.equal(parseStoredSize(null, SIDEBAR_WIDTH), SIDEBAR_WIDTH.default);
  assert.equal(parseStoredSize("", SIDEBAR_WIDTH), SIDEBAR_WIDTH.default);
  assert.equal(parseStoredSize("abc", SIDEBAR_WIDTH), SIDEBAR_WIDTH.default);
  assert.equal(parseStoredSize("9999", SIDEBAR_WIDTH), SIDEBAR_WIDTH.max);
  assert.equal(parseStoredSize("10", SIDEBAR_WIDTH), SIDEBAR_WIDTH.min);
  assert.equal(parseStoredSize("120.6", SIDEBAR_WIDTH), 121);
  assert.equal(clampSize(Number.NaN, HEADER_HEIGHT), HEADER_HEIGHT.default);
});

test("sidebar density follows width: compact, stacked, then wide", () => {
  assert.equal(sidebarDensity(SIDEBAR_WIDTH.min), "compact");
  assert.equal(sidebarDensity(SIDEBAR_WIDTH.default), "stacked");
  assert.equal(sidebarDensity(SIDEBAR_WIDTH.max), "wide");
});

test("header metrics match the original bar at the default height and scale with it", () => {
  const d = headerMetrics(HEADER_HEIGHT.default);
  assert.equal(d.logo, 32);
  assert.equal(d.button, 40);
  assert.equal(d.icon, 16);
  const big = headerMetrics(HEADER_HEIGHT.max);
  const small = headerMetrics(HEADER_HEIGHT.min);
  assert.ok(big.logo > d.logo && small.logo < d.logo);
  assert.ok(big.button < HEADER_HEIGHT.max && small.button < HEADER_HEIGHT.min);
});
