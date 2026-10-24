import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { clampStep, move, placePopover, shouldAutoWelcome } from "./model";
import { TOUR_STEPS, stepIndexForPath } from "./steps";

const STEPS = TOUR_STEPS.length;

test("welcome opens by itself only for a user who has never seen it", () => {
  assert.equal(shouldAutoWelcome({ status: "new", step: 0, welcome_seen: false }), true);
  assert.equal(shouldAutoWelcome({ status: "new", step: 0, welcome_seen: true }), false);
  assert.equal(shouldAutoWelcome({ status: "dismissed", step: 0, welcome_seen: false }), false);
  assert.equal(shouldAutoWelcome({ status: "completed", step: 5, welcome_seen: true }), false);
  assert.equal(shouldAutoWelcome(null), false);
});

test("next walks the sidebar spot, then each page spot, then the next step", () => {
  const spots = TOUR_STEPS[0].spots.length;
  let pos = move({ step: 0, spot: 0 }, { type: "start" })!;
  assert.deepEqual(pos, { step: 0, spot: 0 });
  for (let i = 1; i <= spots; i++) {
    pos = move(pos, { type: "next", spotsInStep: spots, stepCount: STEPS })!;
    assert.deepEqual(pos, { step: 0, spot: i });
  }
  pos = move(pos, { type: "next", spotsInStep: spots, stepCount: STEPS })!;
  assert.deepEqual(pos, { step: 1, spot: 0 });
});

test("next on the last spot of the last step finishes the tour", () => {
  const last = TOUR_STEPS[STEPS - 1].spots.length;
  assert.equal(move({ step: STEPS - 1, spot: last }, { type: "next", spotsInStep: last, stepCount: STEPS }), null);
});

test("prev goes back a spot, then to the last spot of the previous step, and stops at the start", () => {
  assert.deepEqual(move({ step: 2, spot: 1 }, { type: "prev", spotsInPrevStep: 3 }), { step: 2, spot: 0 });
  assert.deepEqual(move({ step: 2, spot: 0 }, { type: "prev", spotsInPrevStep: 3 }), { step: 1, spot: 3 });
  assert.deepEqual(move({ step: 0, spot: 0 }, { type: "prev", spotsInPrevStep: 0 }), { step: 0, spot: 0 });
});

test("arriving on the page shows its first control; leaving points back at the sidebar", () => {
  assert.deepEqual(move({ step: 3, spot: 0 }, { type: "arrived" }), { step: 3, spot: 1 });
  assert.deepEqual(move({ step: 3, spot: 2 }, { type: "arrived" }), { step: 3, spot: 2 });
  assert.deepEqual(move({ step: 3, spot: 2 }, { type: "left" }), { step: 3, spot: 0 });
});

test("start can jump to a specific tool", () => {
  assert.deepEqual(move({ step: 0, spot: 2 }, { type: "start", step: 4 }), { step: 4, spot: 0 });
  assert.equal(clampStep(99, STEPS), STEPS - 1);
  assert.equal(clampStep(-3, STEPS), 0);
  assert.equal(clampStep(Number.NaN, STEPS), 0);
});

test("tour steps match the server's step ids and cover the research pipeline in order", () => {
  const src = readFileSync(join(process.cwd(), "backend/app/services/account.py"), "utf8");
  const ids = /ONBOARDING_STEPS = \(([^)]*)\)/.exec(src)![1].match(/"([a-z]+)"/g)!.map((s) => s.slice(1, -1));
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), ids);
  assert.equal(stepIndexForPath("/tools/trainer"), 1);
  assert.equal(stepIndexForPath("/dashboard"), 5);
  assert.equal(stepIndexForPath("/account"), -1);
});

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("every tour target is rendered somewhere in the app", () => {
  const code = sources(join(process.cwd(), "src"))
    .filter((p) => !p.endsWith("onboarding/steps.ts"))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  for (const step of TOUR_STEPS) {
    for (const spot of [step.nav, ...step.spots]) {
      const m = /\[data-(tour|panel)="([^"]+)"\]/.exec(spot.target);
      assert.ok(m, `unsupported selector ${spot.target}`);
      const id = m[2];
      const attr = m[1] === "tour" ? new RegExp(`(data-tour="${id}"|tour: "${id}")`) : new RegExp(`id="${id}"|data-panel="${id}"`);
      assert.match(code, attr, `${spot.target} is not rendered`);
    }
  }
});

test("popover sits beside the target, flips left near the edge and becomes a sheet on phones", () => {
  const card = { width: 300, height: 200 };
  const vp = { width: 1280, height: 800 };
  const right = placePopover({ top: 100, left: 20, width: 80, height: 40 }, vp, card);
  assert.equal(right.sheet, false);
  assert.equal(right.left, 20 + 80 + 14);
  const left = placePopover({ top: 100, left: 1100, width: 160, height: 40 }, vp, card);
  assert.equal(left.left, 1100 - 14 - 300);
  const sheet = placePopover({ top: 100, left: 20, width: 80, height: 40 }, { width: 390, height: 844 }, card);
  assert.deepEqual(sheet, { top: 844 - 200 - 12, left: 12, sheet: true });
});
