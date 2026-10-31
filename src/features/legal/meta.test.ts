import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptanceRecord, hasAcceptedCurrentTerms, isPending, OPERATOR, OPERATOR_LINE, TERMS_VERSION, termsGateState } from "./meta";
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

test("confirmed operator facts are set; facts still to be verified stay marked as placeholders", () => {
  for (const key of ["owner", "contractingParty", "form", "address", "uid", "status", "email", "privacyEmail", "representative"] as const) {
    assert.equal(isPending(OPERATOR[key]), false, `${key} is confirmed`);
  }
  assert.ok(OPERATOR.form.includes("Einzelfirma"));
  assert.ok(OPERATOR.address.includes("5212 Hausen AG"));
  assert.equal(OPERATOR.uid, "CHE-374.029.268");
  assert.match(OPERATOR.email, /^[^@\s]+@[^@\s]+\.[a-z]+$/);
  assert.ok(OPERATOR_LINE.includes(OPERATOR.uid) && OPERATOR_LINE.includes(OPERATOR.address));
  assert.ok(isPending(OPERATOR.euRepresentative), "euRepresentative must stay a placeholder until it is verified");
});

test("the operator is never presented as an incorporated company or as VAT-registered", () => {
  const text = [...Object.values(OPERATOR), OPERATOR_LINE].join(" ").split(OPERATOR.address).join("");
  assert.doesNotMatch(text, /\b(GmbH|AG|Ltd|Inc|SA|MWST|VAT)\b/);
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
