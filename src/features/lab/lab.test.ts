import assert from "node:assert/strict";
import test from "node:test";
import type { Finding, LabJob } from "./api";
import {
  describeFilters,
  EMPTY_FILTERS,
  excludes,
  filtersToParams,
  fmtCI,
  fmtProp,
  formatMeasurement,
  groupFindings,
  intervalDomain,
  latestByKind,
} from "./lib";

test("filtersToParams drops empty fields and parses confidence", () => {
  assert.deepEqual(filtersToParams(EMPTY_FILTERS), {});
  const p = filtersToParams({ ...EMPTY_FILTERS, labels: [1, 0], outcome: "incorrect", split: "validation", confidence_min: "0.6", confidence_max: "abc" });
  assert.deepEqual(p, { labels: [0, 1], outcome: "incorrect", split: "validation", confidence_min: 0.6 });
});

test("describeFilters is readable and stable", () => {
  assert.equal(describeFilters({}), "All images");
  assert.equal(describeFilters(undefined), "All images");
  assert.equal(describeFilters({ labels: [1], split: "validation", confidence_min: 0.7 }), "label 1 · validation images · confidence 0.7–1");
});

const job = (over: Partial<LabJob>): LabJob => ({ job_id: "job_000000000000", kind: "atlas", status: "succeeded", created_at: 0, params: {}, ...over }) as LabJob;

test("latestByKind separates the newest job from the newest successful job", () => {
  const jobs = [
    job({ job_id: "a", created_at: 1 }),
    job({ job_id: "b", created_at: 3, status: "running" }),
    job({ job_id: "c", created_at: 2 }),
    job({ job_id: "d", created_at: 9, kind: "features" }),
  ];
  const r = latestByKind(jobs, "atlas");
  assert.equal(r.latest?.job_id, "b");
  assert.equal(r.succeeded?.job_id, "c");
  assert.deepEqual(latestByKind(jobs, "embedding"), { latest: null, succeeded: null });
});

test("interval formatting never shows missing values as zero", () => {
  const f = (v: number) => v.toFixed(2);
  assert.equal(fmtCI({ mean: 0.1, lo: 0.05, hi: 0.2 }, f), "0.10 [0.05, 0.20]");
  assert.equal(fmtCI({ mean: 0.1, lo: null, hi: null } as never, f), "0.10");
  assert.notEqual(fmtCI({ mean: null, lo: null, hi: null } as never, f), "0.00");
  assert.notEqual(fmtCI(null, f), "0.00");
  assert.equal(fmtProp({ p: 0.5, lo: 0.4, hi: 0.6 } as never), "50% [40%, 60%]");
  assert.notEqual(fmtProp(null), "0%");
});

test("excludes is three-valued", () => {
  assert.equal(excludes({ lo: 0.01, hi: 0.2 }, 0), true);
  assert.equal(excludes({ lo: -0.01, hi: 0.2 }, 0), false);
  assert.equal(excludes({ lo: -0.3, hi: -0.1 }, 0), true);
  assert.equal(excludes({ lo: null, hi: 0.2 } as never, 0), null);
  assert.equal(excludes(null, 0), null);
});

test("intervalDomain covers every end and the reference", () => {
  const [lo, hi] = intervalDomain([{ lo: 0.1, hi: 0.3, mean: 0.2 }, { lo: null, hi: null, mean: 0.5 }], 0)!;
  assert.ok(lo < 0 && hi > 0.5);
  assert.equal(intervalDomain([{ lo: null, hi: null, mean: null }]), null);
  const [a, b] = intervalDomain([{ mean: 0 }])!;
  assert.ok(a < 0 && b > 0);
});

test("groupFindings orders by status strength and drops empty groups", () => {
  const f = (id: string, status: Finding["status"]) => ({ id, status }) as Finding;
  const g = groupFindings([f("1", "observation"), f("2", "supported"), f("3", "observation")]);
  assert.deepEqual(
    g.map((x) => [x.status, x.items.map((i) => i.id)]),
    [
      ["supported", ["2"]],
      ["observation", ["1", "3"]],
    ],
  );
});

test("formatMeasurement uses the unit and percentage points for differences", () => {
  const m = (label: string, unit: string) => ({ label, unit, value: null, lo: null, hi: null });
  assert.equal(formatMeasurement(m("Δ target probability", "probability"), -0.0123), "-1.23 pp");
  assert.equal(formatMeasurement(m("Recent − oldest share", "share"), 0.05), "+5.0 pp");
  assert.equal(formatMeasurement(m("Share of attribution", "share"), 0.25), "25.0%");
  assert.equal(formatMeasurement(m("Win rate", "proportion"), 0.5), "50%");
  assert.equal(formatMeasurement(m("Cohen d", "d"), 0.5), "0.50");
  assert.notEqual(formatMeasurement(m("x", "share"), null), "0.0%");
});
