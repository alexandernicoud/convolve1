export const LEGAL_PATHS = ["/privacy", "/terms", "/subscription-terms", "/refunds", "/risk-disclosure", "/cookies", "/legal"];

export function isLegalPath(pathname: string): boolean {
  return LEGAL_PATHS.includes(pathname);
}
