import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConclusion,
  classifyRegion,
  fmtSlRange,
  horizonEnvelope,
  nearestIndex,
  neighbourhood2D,
  percentileInSlice,
  flattenSurface,
  quantileThreshold,
  unpackIndex,
  yearlyReturns,
  type Surface,
  signedLog,
  signedLogTicks,
  surfaceFromAudit,
  surfaceFromHeatmaps,
  type Audit,
  type Grid2,
} from "./lib";

const flat: Grid2 = [
  [10, 10, 10],
  [10, 10, 10],
  [10, 10, 10],
];

const spike: Grid2 = [
  [1, 1, 1],
  [1, 100, 1],
  [1, 1, 1],
];

test("neighbourhood2D uses the 8 neighbours and skips missing cells", () => {
  const nb = neighbourhood2D(flat, 1, 1)!;
  assert.equal(nb.count, 8);
  assert.equal(nb.median_ratio, 1);
  assert.equal(nb.share_within_25pct, 1);

  const corner = neighbourhood2D(flat, 0, 0)!;
  assert.equal(corner.count, 3);

  const holes: Grid2 = [
    [null, 5, null],
    [5, 10, null],
    [null, null, null],
  ];
  assert.equal(neighbourhood2D(holes, 1, 1)!.count, 2);
  assert.equal(neighbourhood2D(holes, 0, 0), null);
});

test("classifyRegion separates plateau, ridge and isolated peaks", () => {
  assert.equal(classifyRegion(neighbourhood2D(flat, 1, 1)), "plateau");
  assert.equal(classifyRegion(neighbourhood2D(spike, 1, 1)), "isolated");
  const ridge: Grid2 = [
    [1, 60, 1],
    [1, 100, 1],
    [1, 60, 1],
  ];
  const nbRidge = neighbourhood2D(ridge, 1, 1)!;
  assert.equal(nbRidge.share_within_50pct, 0.25);
  assert.equal(classifyRegion(nbRidge), "isolated");
  const wide: Grid2 = [
    [60, 60, 60],
    [60, 100, 1],
    [1, 1, 1],
  ];
  assert.equal(classifyRegion(neighbourhood2D(wide, 1, 1)), "ridge");
  assert.equal(classifyRegion(null), "unknown");
  assert.equal(classifyRegion(neighbourhood2D([[-5, -1], [-1, -1]], 0, 0)), "unknown");
});

test("signedLog is symmetric and monotone; ticks stay within the limit", () => {
  assert.equal(signedLog(0), 0);
  assert.equal(signedLog(-99), -signedLog(99));
  assert.ok(signedLog(1000) > signedLog(100));
  const t = signedLogTicks(150);
  assert.deepEqual(t.text, ["-100%", "-50%", "-20%", "0%", "+20%", "+100%"]);
  assert.equal(t.vals.length, t.text.length);
});

test("percentileInSlice, nearestIndex and fmtSlRange", () => {
  assert.equal(percentileInSlice(spike, 1, 1), (8 / 9) * 100);
  assert.equal(percentileInSlice(spike, 0, 0), 0);
  assert.equal(nearestIndex([0.01, 0.02, 0.05], 0.021), 1);
  assert.equal(fmtSlRange({ sl: 0.05, sl_min: 0.01, sl_max: 0.2, tied: 4 }), "1.0%–20.0%");
  assert.equal(fmtSlRange({ sl: 0.05 }), "5.00%");
});

test("surface parsers validate shapes and keep both payoff models", () => {
  const raw = {
    tp_values: [0.01, 0.02, 0.03],
    sl_values: [0.01, 0.02, 0.03],
    horizons: [1, 5],
    label_model: [flat, spike],
    mark_to_market: [spike, flat],
    best: { tp: 0.02, sl: 0.02, h: 5 },
  };
  const s = surfaceFromAudit(raw)!;
  assert.equal(s.source, "audit");
  assert.equal(s.mtm?.length, 2);
  assert.deepEqual(horizonEnvelope(s, "label"), [10, 100]);
  assert.deepEqual(horizonEnvelope(s, "mtm"), [100, 10]);
  assert.equal(surfaceFromAudit({ ...raw, label_model: [flat] }), null);
  assert.equal(surfaceFromAudit({ ...raw, mark_to_market: [flat] })!.mtm, null);

  const h = surfaceFromHeatmaps({ tp_values: raw.tp_values, sl_values: raw.sl_values, horizons: { "20": flat, "5": spike, "bad": [] } }, null)!;
  assert.deepEqual(h.horizons, [5, 20]);
  assert.equal(h.mtm, null);
  assert.equal(h.source, "heatmaps");
});

function audit(over: Partial<Audit> = {}): Audit {
  return {
    version: 1,
    symbol: "TEST",
    start: "2025-01-01",
    end: "2025-12-31",
    bars: 250,
    years: 0.99,
    objective: { key: "compounded_cagr_pct", label: "Compounded CAGR" },
    evaluation: "in_sample",
    payoff_model: { name: "label", entry: "open", sizing: "1/h per position", exits: "tp/sl", expiry: "0%", costs_round_trip_pct: 0.21 },
    best: {
      tp: 0.05, sl: 0.2, h: 1, cagr_pct: 846.16, total_return_pct: 900, linear_pl_per_year_pct: 200,
      trades_counted: 40, tp_share: 1, max_dd_realized_pct: 0, reproduced: true,
      ties: 3, tie_sl_values: [0.1, 0.15, 0.2], tie_tp_values: [0.05], tie_horizons: [1],
    },
    exits: { tp_hits: 40, sl_hits: 0, expiries: 210, expiry_mean_move_pct: -0.2, expiry_negative_share: 0.55 },
    mark_to_market: {
      description: "", cagr_pct: -20, total_return_pct: -20, max_dd_marked_pct: -30, label_max_dd_marked_pct: 0,
      best_under_mtm: null, grid_available: true,
    },
    asset: { total_return_pct: 10, cagr_pct: 10 },
    robustness: { region: "isolated", label_model: null, mark_to_market: null, cells_within_10pct_of_best: 3, grid_cells: 125000 },
    walk_forward: { available: false, reason: "short" },
    configuration: [],
    defects: [{ id: "expiry_zero", severity: "critical", title: "", detail: "" }],
    candidates: [],
    verdict: { evidence: "in_sample", recommend: false, out_of_sample_beats_buy_and_hold: false },
    series: { dates: [], label_model_pct: [], mark_to_market_pct: [], asset_pct: [] },
    ...over,
  };
}

test("audited conclusion never recommends an in-sample, market-negative candidate", () => {
  const c = buildConclusion(audit(), null, null);
  assert.equal(c.status.label, "Not supported");
  assert.match(c.headline, /does not hold up/);
  const keys = c.items.map((i) => i.key);
  assert.deepEqual(keys, ["objective", "params", "evaluation", "stability", "assumptions", "recommendation"]);
  assert.equal(c.items.find((i) => i.key === "evaluation")!.value, "In-sample only");
  assert.equal(c.items.find((i) => i.key === "recommendation")!.value, "Not recommended");
  assert.match(c.items.find((i) => i.key === "params")!.value, /3 tied/);
  assert.ok(c.nextSteps.length >= 2);
  assert.ok(!/optimal/i.test(JSON.stringify(c)));
});

test("audited conclusion without market-valuation failure is still only 'insufficient evidence'", () => {
  const c = buildConclusion(
    audit({ mark_to_market: { ...audit().mark_to_market, cagr_pct: 30 }, robustness: { ...audit().robustness, region: "plateau" } }),
    null,
    null,
  );
  assert.equal(c.status.label, "Insufficient evidence");
  assert.match(c.headline, /needs independent validation/);
});

test("unaudited fallback states the run is in-sample and unaudited", () => {
  const c = buildConclusion(null, { best_tp: 0.05, best_sl: 0.02, best_h: 3, best_cagr: 120 }, neighbourhood2D(spike, 1, 1));
  assert.match(c.status.label, /Unaudited/);
  assert.equal(c.items.find((i) => i.key === "stability")!.value, "Isolated peak");
  assert.ok(!/optimal/i.test(JSON.stringify(c)));
});

test("yearlyReturns chains each year from the previous year's last value", () => {
  const dates = ["2025-11-03", "2025-12-30", "2026-01-02", "2026-06-30"];
  const cum = [0, 10, 21, 32];
  const rows = yearlyReturns(dates, cum);
  assert.deepEqual(
    rows.map((r) => r.year),
    ["2025", "2026"],
  );
  assert.ok(Math.abs(rows[0]!.value! - 10) < 1e-9);
  assert.ok(Math.abs(rows[1]!.value! - 20) < 1e-9);
  const total = ((1 + rows[0]!.value! / 100) * (1 + rows[1]!.value! / 100) - 1) * 100;
  assert.ok(Math.abs(total - 32) < 1e-9);
  assert.equal(rows[1]!.sessions, 2);
  assert.equal(rows[1]!.first, "2026-01-02");
});

test("yearlyReturns skips missing values without breaking the chain", () => {
  const rows = yearlyReturns(["2025-12-30", "2026-01-02", "2026-01-05"], [10, null, 32]);
  assert.ok(Math.abs(rows[1]!.value! - 20) < 1e-9);
});

const tiny: Surface = {
  tp: [0.01, 0.02],
  sl: [0.01, 0.02, 0.03],
  horizons: [1, 5],
  label: [
    [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
    [
      [7, 8],
      [9, null],
      [11, 12],
    ],
  ],
  mtm: null,
  best: { tp: 0.02, sl: 0.03, h: 5 },
  source: "audit",
};

test("flattenSurface and unpackIndex round-trip every cell", () => {
  const f = flattenSurface(tiny);
  assert.equal(f.n, 12);
  assert.equal(f.mtm, null);
  for (let k = 0; k < f.n; k++) {
    const c = unpackIndex(tiny, f.index[k]!);
    assert.equal(f.tp[k], tiny.tp[c.ti]);
    assert.equal(f.sl[k], tiny.sl[c.si]);
    assert.equal(f.h[k], tiny.horizons[c.hi]);
    const v = tiny.label[c.hi]![c.si]![c.ti];
    if (v == null) assert.ok(Number.isNaN(f.label[k]));
    else assert.equal(f.label[k], v);
  }
});

test("quantileThreshold keeps the top share of finite values", () => {
  const vals = [5, 1, NaN, 4, 2, 3];
  assert.equal(quantileThreshold(vals, 1), -Infinity);
  assert.equal(quantileThreshold(vals, 0.2), 5);
  assert.equal(quantileThreshold(vals, 0.4), 4);
  assert.equal(quantileThreshold([], 0.1), -Infinity);
});
