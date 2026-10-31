import assert from "node:assert/strict";
import test from "node:test";
import { cleanAnswers, isComplete, rewardLine, type FeedbackQuestion } from "./model";

const QUESTIONS: FeedbackQuestion[] = [
  { id: "overall", type: "rating", prompt: "", min: 1, max: 5 },
  { id: "most_useful", type: "choice", prompt: "", options: [{ id: "backtesting", label: "Backtesting" }] },
  { id: "missing", type: "text", prompt: "", min_length: 2 },
];

test("all questions must be answered within their limits", () => {
  assert.equal(isComplete(QUESTIONS, { overall: 4, most_useful: "backtesting", missing: "Walk-forward" }), true);
  assert.equal(isComplete(QUESTIONS, { overall: 4, most_useful: "backtesting" }), false);
  assert.equal(isComplete(QUESTIONS, { overall: 6, most_useful: "backtesting", missing: "ok" }), false);
  assert.equal(isComplete(QUESTIONS, { overall: 4, most_useful: "crypto", missing: "ok" }), false);
  assert.equal(isComplete(QUESTIONS, { overall: 4, most_useful: "backtesting", missing: "  " }), false);
  assert.equal(isComplete(QUESTIONS, { overall: 4, most_useful: "backtesting", missing: "x".repeat(2001) }), false);
});

const WITH_OPTIONAL: FeedbackQuestion[] = [
  QUESTIONS[0],
  { id: "improve", type: "text", prompt: "", min_length: 0, optional: true },
];

test("the optional written suggestion can be left blank and is not sent", () => {
  assert.equal(isComplete(WITH_OPTIONAL, { overall: 2 }), true);
  assert.equal(isComplete(WITH_OPTIONAL, { overall: 2, improve: "   " }), true);
  assert.equal(isComplete(WITH_OPTIONAL, { overall: 2, improve: "x".repeat(2001) }), false);
  assert.deepEqual(cleanAnswers(WITH_OPTIONAL, { overall: 2, improve: "  " }), { overall: 2 });
  assert.deepEqual(cleanAnswers(WITH_OPTIONAL, { overall: 2, improve: "Faster runs" }), { overall: 2, improve: "Faster runs" });
});

test("reward status says when credits are only stored for the launch", () => {
  assert.equal(rewardLine(null), null);
  assert.match(rewardLine({ credits: 5, remaining: 5, usable_now: false, granted_at: null }) ?? "", /saved to your account for the full launch/);
  assert.match(rewardLine({ credits: 5, remaining: 5, usable_now: true, granted_at: null }) ?? "", /added to your balance/);
});
