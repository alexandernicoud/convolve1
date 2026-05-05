const WALLET_KEY = "convolve_paper_wallet_usd";

/** Paper trading wallet (USD). Used for deploy validation vs allocated bot capital. */
export function getPaperWalletUsd(fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    if (raw == null) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

export function setPaperWalletUsd(value: number): void {
  localStorage.setItem(WALLET_KEY, String(Math.max(0, value)));
}
