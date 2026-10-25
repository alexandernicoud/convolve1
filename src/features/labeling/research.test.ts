import assert from "node:assert/strict";
import test from "node:test";
import type { Surface } from "./lib";
import {
  generatorTransferHref,
  parseGeneratorTransfer,
  parseRankMode,
  researchCell,
  researchFromRaw,
  sortCandidates,
  transferProvenance,
  type Candidate,
} from "./research";

const surface: Surface = {
  tp: [0.01, 0.02],
  sl: [0.01],
  horizons: [1, 5],
  label: [[[1, 2]], [[3, 4]]],
  mtm: null,
  best: { tp: 0.02, sl: 0.01, h: 5 },
  source: "audit",
};

const TODAY = "2026-10-25";

test("research surface decodes scaled integers and rejects mismatched axes", () => {
  const raw = {
    version: 2,
    tp_values: [0.01, 0.02],
    sl_values: [0.01],
    horizons: [1, 5],
    scales: { suitability: 1, label1_share: 1000 },
    metrics: { suitability: [[[40, null]], [[70, 55]]], label1_share: [[[250, 500]], [[333, null]]] },
  };
  const rs = researchFromRaw(raw, surface)!;
  assert.equal(rs.version, 2);
  assert.equal(researchCell(rs, "suitability", 1, 0, 0), 70);
  assert.equal(researchCell(rs, "suitability", 0, 0, 1), null);
  assert.equal(researchCell(rs, "label1_share", 1, 0, 0), 0.333);
  assert.equal(researchCell(rs, "robustness", 0, 0, 0), null);
  assert.equal(researchFromRaw({ ...raw, horizons: [1, 6] }, surface), null);
  assert.equal(researchFromRaw(raw, null), null);
  assert.equal(researchFromRaw(null, surface), null);
});

test("rank mode parsing falls back to profitability", () => {
  assert.equal(parseRankMode("suitability"), "suitability");
  assert.equal(parseRankMode("robustness"), "robustness");
  assert.equal(parseRankMode("bogus"), "profitability");
  assert.equal(parseRankMode(null), "profitability");
});

function cand(id: number, suit: number | null, share: number | null, rank: number): Candidate {
  return {
    tp: 0.01 * id, sl: 0.01, h: id, index: { ti: id, si: 0, hi: 0 },
    ranks: { profitability: rank, suitability: rank, robustness: rank },
    scores: { profitability_cagr_pct: null, suitability: suit, robustness: null },
    components: {},
    research: {
      samples: 100, label1_share: share, label0_share: null, sl_share: null, timeout_share: null, independent: null, mean_bars_held: null,
      block_label1_share: [], block_range: null, payoff_sign_consistency: null, neighbour_agreement: null, horizon_agreement: null,
      net_return_per_sample_pct: null, label0_mean_return_pct: null, breakeven_precision: null, required_lift: null, reward_to_risk: null,
    },
    evaluation: null,
    flags: [],
  };
}

test("candidate sorting is stable, puts missing values last and ties follow the ranking", () => {
  const list = [cand(1, 50, 0.3, 3), cand(2, 80, null, 1), cand(3, 50, 0.4, 2), cand(4, null, 0.2, 4)];
  assert.deepEqual(sortCandidates(list, "rank", true, "suitability").map((c) => c.h), [2, 3, 1, 4]);
  assert.deepEqual(sortCandidates(list, "suitability", true, "suitability").map((c) => c.h), [2, 3, 1, 4]);
  assert.deepEqual(sortCandidates(list, "suitability", false, "suitability").map((c) => c.h), [3, 1, 2, 4]);
  assert.deepEqual(sortCandidates(list, "label1_share", true, "suitability").map((c) => c.h), [3, 1, 4, 2]);
});

test("generator transfer round-trips through the URL", () => {
  const href = generatorTransferHref({
    runId: "20261025_120000_abc", symbol: "AAPL", timeframe: "1d", tp: 0.054375, sl: 0.029375, h: 147,
    mode: "suitability", researchStart: "2015-01-02", researchEnd: "2018-11-13", methodologyVersion: 2,
  });
  assert.ok(href.startsWith("/tools/generator?"));
  const parsed = parseGeneratorTransfer(new URLSearchParams(href.split("?")[1]), TODAY)!;
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.values, {
    runId: "20261025_120000_abc", symbol: "AAPL", timeframe: "1d", tp: 0.054375, sl: 0.029375, h: 147,
    mode: "suitability", researchStart: "2015-01-02", researchEnd: "2018-11-13", methodologyVersion: 2,
  });
  assert.deepEqual(transferProvenance(parsed.values), {
    run_id: "20261025_120000_abc", mode: "suitability", symbol: "AAPL", tp: 0.054375, sl: 0.029375, h: 147,
    research_start: "2015-01-02", research_end: "2018-11-13", methodology_version: 2,
  });
});

test("generator transfer rejects unsupported values with explanations and applies the rest", () => {
  assert.equal(parseGeneratorTransfer(new URLSearchParams("symbols=AAPL&tp=0.02"), TODAY), null);
  const q = new URLSearchParams("src=optimizer&opt_run=../etc&symbols=AAPL&tf=1h&tp=1.5&sl=0.02&h=2.5&rs=2020-02-30&re=2021-01-01&mode=x");
  const p = parseGeneratorTransfer(q, TODAY)!;
  assert.deepEqual(p.values, { symbol: "AAPL", sl: 0.02, mode: "profitability" });
  assert.equal(p.issues.length, 5);
  assert.ok(p.issues.some((i) => i.includes("1h")));
  assert.ok(p.issues.some((i) => i.includes("Take profit")));
  assert.ok(p.issues.some((i) => i.includes("Horizon")));
  assert.equal(transferProvenance(p.values), null);
  const future = parseGeneratorTransfer(new URLSearchParams("src=optimizer&opt_run=r&rs=2025-01-01&re=2027-01-01"), TODAY)!;
  assert.equal(future.values.researchEnd, undefined);
  assert.ok(future.issues[0]!.includes("future"));
  const reversed = parseGeneratorTransfer(new URLSearchParams("src=optimizer&opt_run=r&rs=2022-01-01&re=2021-01-01"), TODAY)!;
  assert.equal(reversed.values.researchStart, undefined);
});
