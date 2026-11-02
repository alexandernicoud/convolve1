import { test } from "node:test";
import assert from "node:assert/strict";
import type { GlobalRun } from "@/lib/api";
import { collapseRepeatedFailures } from "./recentRuns";

const run = (id: string, status: string, message = ""): GlobalRun => ({ id, tool: "backtester", status, message, updated_at: 0 }) as GlobalRun;

test("back-to-back identical failures collapse into one row, newest kept", () => {
  const rows = collapseRepeatedFailures([
    run("c", "failed", "Stored market data missing for: UNH"),
    run("b", "failed", "Stored market data missing for: UNH"),
    run("a", "failed", "Stored market data missing for: UNH"),
    run("ok", "succeeded"),
    run("x", "failed", "other"),
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.repeats]), [["c", 3], ["ok", 1], ["x", 1]]);
});

test("different messages and non-failures are never merged", () => {
  const rows = collapseRepeatedFailures([run("b", "failed", "one"), run("a", "failed", "two"), run("s2", "succeeded"), run("s1", "succeeded")]);
  assert.equal(rows.length, 4);
});
