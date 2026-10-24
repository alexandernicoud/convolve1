import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptanceRecord, hasAcceptedCurrentTerms, isPending, OPERATOR, TERMS_VERSION, termsGateState } from "./meta";
import { isLegalPath } from "./paths";

test("terms acceptance requires the current version", () => {
  assert.equal(hasAcceptedCurrentTerms(undefined), false);
  assert.equal(hasAcceptedCurrentTerms({}), false);
  assert.equal(hasAcceptedCurrentTerms({ terms_version: "2000-01-01" }), false);
  assert.equal(hasAcceptedCurrentTerms({ terms_version: TERMS_VERSION }), true);
});

test("acceptance record carries versions and a timestamp", () => {
  const rec = acceptanceRecord();
  assert.equal(rec.terms_version, TERMS_VERSION);
  assert.ok(rec.privacy_version);
  assert.ok(!Number.isNaN(Date.parse(rec.terms_accepted_at)));
  assert.equal(hasAcceptedCurrentTerms(rec), true);
});

test("terms gate trusts the server record and falls back to metadata", () => {
  const current = { terms_version: TERMS_VERSION };
  assert.equal(termsGateState(undefined, current, false), "loading");
  assert.equal(termsGateState({ terms_version: TERMS_VERSION }, undefined, false), "accepted");
  assert.equal(termsGateState({ terms_version: null }, undefined, false), "ask");
  assert.equal(termsGateState({ terms_version: "2000-01-01" }, { terms_version: "2000-01-01" }, false), "ask");
  assert.equal(termsGateState({ terms_version: null }, current, false), "record");
  assert.equal(termsGateState({ terms_version: null }, undefined, true), "record");
  assert.equal(termsGateState(null, current, false), "accepted");
  assert.equal(termsGateState(null, undefined, true), "ask");
});

test("legal paths are recognised", () => {
  for (const p of ["/privacy", "/terms", "/risk-disclosure", "/cookies", "/legal"]) assert.ok(isLegalPath(p));
  assert.equal(isLegalPath("/account"), false);
});

test("the operator name is set; facts that were not supplied stay marked as placeholders", () => {
  assert.equal(OPERATOR.name, "Nicoud Convolutional Strategies");
  assert.equal(isPending(OPERATOR.name), false);
  for (const key of ["contractingParty", "form", "address", "email", "privacyEmail", "register", "uid", "representative"] as const) {
    assert.ok(isPending(OPERATOR[key]), `${key} must stay a placeholder until it is supplied`);
  }
});

test("the cookie notice lists every key the app writes to browser storage", () => {
  const notice = readFileSync(join(process.cwd(), "src/features/legal/CookiesPage.tsx"), "utf8");
  for (const key of [
    "convolve-auth",
    "convolve_runs",
    "convolve_paper_wallet_usd",
    "convolve_profile_name",
    "convolve_profile_email",
    "convolve-pending-terms",
    "convolve_dismissed_runs",
    "convolve:tour-spot",
  ]) {
    assert.ok(notice.includes(key), `${key} is missing from the cookie notice`);
  }
});
