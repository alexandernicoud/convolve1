/** Bump when the Terms or Privacy Policy change materially; signed-in users are asked to accept again. */
export const TERMS_VERSION = "2026-10-28";
export const PRIVACY_VERSION = "2026-10-28";
export const LEGAL_UPDATED = "28 October 2026";

/** The product. The operator below is who provides it. */
export const PRODUCT = "Convolve";

/**
 * Operator details. Convolve is a product operated by Alexander Nicoud as a Swiss sole
 * proprietorship (Einzelfirma), not an incorporated company; he is personally the contracting
 * party. VAT registration is unconfirmed, so no VAT number is shown. Values in square brackets
 * are not confirmed yet and are shown verbatim on the legal pages so they cannot be mistaken
 * for real information.
 */
export const OPERATOR = {
  owner: "Alexander Nicoud",
  contractingParty: "Alexander Nicoud, sole proprietor",
  form: "Sole proprietorship (Einzelfirma) under Swiss law",
  address: "Münzentalstrasse 30, 5212 Hausen AG, Switzerland",
  uid: "CHE-374.029.268",
  status: "Active",
  email: "info.convolve@gmail.com",
  privacyEmail: "info.convolve@gmail.com",
  representative: "Alexander Nicoud",
  euRepresentative: "[EU representative under Art. 27 GDPR, if required]",
};

/** One-line identification used wherever a legal document names its provider. */
export const OPERATOR_LINE = `${OPERATOR.owner}, sole proprietorship (Einzelfirma) under Swiss law, UID ${OPERATOR.uid}, ${OPERATOR.address}`;

/** Market-data source; no commercial licence is held, see the Terms. */
export const DATA_SOURCE = "Yahoo Finance, accessed through the open-source yfinance library";

/** True while a legal fact is still a bracketed placeholder. */
export function isPending(value: string): boolean {
  return value.includes("[");
}

export const LEGAL_LINKS = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Subscriptions & credits", href: "/subscription-terms" },
  { label: "Refunds & cancellation", href: "/refunds" },
  { label: "Risk disclosure", href: "/risk-disclosure" },
  { label: "Cookies", href: "/cookies" },
  { label: "Legal notice", href: "/legal" },
] as const;

export type TermsAcceptance = { terms_version?: string; terms_accepted_at?: string; privacy_version?: string };

export function hasAcceptedCurrentTerms(meta: TermsAcceptance | undefined | null): boolean {
  return meta?.terms_version === TERMS_VERSION;
}

/**
 * What the Terms gate should do. ``server`` is the backend's record: ``undefined`` while
 * loading, ``null`` when the backend cannot be asked (then sign-in metadata decides).
 * "record": the user accepted at sign-up but the server has no record yet.
 */
export type TermsGateState = "loading" | "accepted" | "record" | "ask";

export function termsGateState(
  server: { terms_version: string | null } | null | undefined,
  meta: TermsAcceptance | undefined | null,
  pendingAccepted: boolean,
): TermsGateState {
  if (server === undefined) return "loading";
  if (server === null) return hasAcceptedCurrentTerms(meta) ? "accepted" : "ask";
  if (server.terms_version === TERMS_VERSION) return "accepted";
  return hasAcceptedCurrentTerms(meta) || pendingAccepted ? "record" : "ask";
}

export function acceptanceRecord(): Required<TermsAcceptance> {
  return { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, terms_accepted_at: new Date().toISOString() };
}
