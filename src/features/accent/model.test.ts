import assert from "node:assert/strict";
import test from "node:test";
import { ACCENT_HEX, ACCENT_OPTIONS, CHART_ACCENT_HEX, isAccentId } from "./model";

test("pale accent options are complete and distinguishable", () => {
  assert.ok(ACCENT_OPTIONS.some((o) => o.id === "default"));
  assert.equal(ACCENT_OPTIONS.length, 8);
  const labels = new Set(ACCENT_OPTIONS.map((o) => o.label));
  assert.equal(labels.size, ACCENT_OPTIONS.length);
  for (const o of ACCENT_OPTIONS) {
    assert.ok(isAccentId(o.id));
    assert.match(ACCENT_HEX[o.id], /^#[0-9a-fA-F]{6}$/i);
    assert.match(CHART_ACCENT_HEX[o.id], /^#[0-9a-fA-F]{6}$/i);
  }
  assert.equal(isAccentId("violet"), false);
  assert.equal(isAccentId("orange"), false);
});
