import assert from "node:assert/strict";
import test from "node:test";
import { HIDE_RESEARCH_START_KEY, readHideResearchStart, writeHideResearchStart } from "./researchStartPrefs";

test("hide research start prefs round-trip", () => {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });

  writeHideResearchStart(true);
  assert.equal(readHideResearchStart(), true);
  assert.equal(store.get(HIDE_RESEARCH_START_KEY), "1");
  writeHideResearchStart(false);
  assert.equal(readHideResearchStart(), false);
  assert.equal(store.get(HIDE_RESEARCH_START_KEY), "0");
});
