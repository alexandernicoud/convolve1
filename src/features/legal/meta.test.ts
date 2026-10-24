import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceRecord, hasAcceptedCurrentTerms, TERMS_VERSION, termsGateState } from "./meta";
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
