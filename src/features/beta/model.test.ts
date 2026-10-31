import assert from "node:assert/strict";
import test from "node:test";
import {
  asBetaLimits,
  asMarketData,
  betaLimitLines,
  betaToolForPath,
  runRefusal,
  usesMarketData,
  type BetaLimits,
} from "./model";

test("market-data restriction: dialog points to contact, only price-downloading tools are affected", () => {
  const r = runRefusal(403, { code: "market_data_restricted", message: "Invited group only." });
  assert.equal(r?.contact, true);
  assert.equal(r?.message, "Invited group only.");
  assert.equal(r?.feedback, undefined);
  assert.equal(runRefusal(403, { code: "other" }), null);
  assert.deepEqual(asMarketData({ access: "cohort", tools: ["backtester", 3] }), { access: "cohort", tools: ["backtester"] });
  assert.equal(asMarketData({ access: "maybe" }), null);
  assert.equal(usesMarketData("generator"), true);
  assert.equal(usesMarketData("trainer"), false);
  assert.equal(usesMarketData("analysis"), false);
});

const BETA: BetaLimits = {
  free_beta: true,
  max_symbols: 5,
  max_charts_per_label: 500,
  max_image_dimension: 224,
  max_optimizer_years: 15,
  max_active_runs: 1,
  max_queued_runs: 2,
  max_runs_per_day: 20,
  max_active_inprocess_runs: 0,
  max_active_training_jobs: 1,
  max_epochs: 200,
  max_training_images: 0,
};

test("beta limits come from the server; an empty object means the beta is off", () => {
  assert.equal(asBetaLimits({}), null);
  assert.equal(asBetaLimits(null), null);
  assert.equal(asBetaLimits(BETA)?.max_symbols, 5);
});

test("each tool lists only the limits that apply to it, and 0 means unlimited", () => {
  assert.deepEqual(betaLimitLines(BETA, "generator"), [
    "up to 5 symbols",
    "500 charts per label and symbol",
    "images up to 224 px",
    "1 running and 2 queued per account",
    "20 runs per day across all tools",
  ]);
  assert.deepEqual(betaLimitLines(BETA, "optimizer")[0], "periods up to 15 years");
  const trainer = betaLimitLines(BETA, "trainer");
  assert.ok(trainer.includes("up to 200 epochs") && !trainer.some((l) => l.includes("training images")));
  assert.deepEqual(betaLimitLines(BETA, "backtester"), ["20 runs per day across all tools"]);
});

test("tool pages are recognised by path", () => {
  assert.equal(betaToolForPath("/tools/generator"), "generator");
  assert.equal(betaToolForPath("/products/labeling-optimizer/technical"), "optimizer");
  assert.equal(betaToolForPath("/tools/analysis"), "analysis");
  assert.equal(betaToolForPath("/account"), null);
});

test("run refusals get an explanation, never a purchase prompt", () => {
  const feedback = runRefusal(403, { code: "feedback_required", message: "x" });
  assert.equal(feedback?.feedback, true);
  assert.equal(feedback?.title, "Help shape Convolve");
  assert.equal(runRefusal(403, { code: "feature_locked" }), null);

  assert.equal(runRefusal(422, { code: "beta_limit", message: "The free beta allows up to 5 symbols per run." })?.message,
    "The free beta allows up to 5 symbols per run.");
  assert.equal(runRefusal(422, [{ loc: ["body"], msg: "bad" }]), null);

  assert.equal(runRefusal(409, { code: "duplicate_submission", message: "m", run_id: "r1" })?.runId, "r1");
  assert.equal(runRefusal(409, { code: "something_else" }), null);

  assert.equal(runRefusal(429, { code: "daily_limit", message: "m" })?.title, "Daily limit reached");
  assert.equal(runRefusal(503, null)?.title, "Workers are busy");
  for (const s of [400, 401, 404, 500]) assert.equal(runRefusal(s, { code: "x" }), null);
  for (const s of [409, 422, 429, 503]) {
    const r = runRefusal(s, { code: s === 409 ? "duplicate_submission" : s === 422 ? "beta_limit" : "busy" });
    assert.ok(r && !/buy|upgrade|credits/i.test(`${r.title} ${r.message}`));
  }
});
