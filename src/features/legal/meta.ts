/** Bump when the Terms or Privacy Policy change materially; signed-in users are asked to accept again. */
export const TERMS_VERSION = "2026-10-24";
export const PRIVACY_VERSION = "2026-10-24";
export const LEGAL_UPDATED = "24 October 2026";

/** The product. The operator below is who provides it. */
export const PRODUCT = "Convolve";

/**
 * Operator details. Values in square brackets have not been supplied yet and are shown
 * verbatim on the legal pages so they cannot be mistaken for real information.
 * ``name`` is the name the service is operated under; whether it is a registered entity
 * or the trading name of a natural person is not confirmed, so ``contractingParty`` and
 * ``form`` stay open.
 */
export const OPERATOR = {
  name: "Nicoud Convolutional Strategies",
  contractingParty: "[Legal name of the contracting party: the registered entity, or the natural person trading under this name]",
  form: "[Legal form — to be confirmed]",
  address: "[Street and number], [Postcode] [City], Switzerland",
  email: "[contact email address]",
  privacyEmail: "[privacy contact email address]",
  register: "[Commercial register entry and number, if registered]",
  uid: "[UID / VAT number, if registered]",
  representative: "[Responsible person]",
  euRepresentative: "[EU representative under Art. 27 GDPR, if required]",
};

/** True while a legal fact is still a bracketed placeholder. */
export function isPending(value: string): boolean {
  return value.includes("[");
}

export const LEGAL_LINKS = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
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
