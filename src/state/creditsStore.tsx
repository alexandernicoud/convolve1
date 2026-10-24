import { create } from "zustand";
import { fetchApi, INSUFFICIENT_CREDITS_EVENT } from "@/lib/api";
import {
  costFor,
  costMap,
  isRunStartPath,
  needsRunConfirmation,
  shouldBlock,
  type CreditsMode,
  type PlanCatalogue,
  type QuoteResponse,
} from "@/features/credits/model";

/**
 * Mirror of the server-side credit balance. The backend owns balances, prices and
 * charging; this store only displays them and opens the "not enough credits" and
 * "confirm this run" dialogs. Nothing here is persisted: a balance held in the browser
 * is never trusted.
 */

const LEGACY_STORAGE_KEY = "convolve_credits";

export type RunParams = Record<string, unknown>;

interface CreditsState {
  loaded: boolean;
  mode: CreditsMode | null;
  balance: number | null;
  costs: Record<string, number>;
  insufficientOpen: boolean;
  pendingTool: string | null;
  /** Cost and balance from the server's 402 response, when that is what opened the dialog. */
  shortfall: { cost: number; balance: number } | null;
  /** Quote awaiting the user's decision in the confirmation dialog. */
  confirming: QuoteResponse | null;
}

interface CreditsActions {
  refresh: () => Promise<void>;
  costOf: (tool: string) => number;
  requestRun: (tool: string) => boolean;
  openInsufficient: (tool?: string, shortfall?: { cost: number; balance: number } | null) => void;
  closeInsufficient: () => void;
  resolveConfirm: (ok: boolean) => void;
}

export type CreditsStore = CreditsState & CreditsActions;

try {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
} catch {
  /* storage unavailable */
}

let inflight: Promise<void> | null = null;
let confirmResolver: ((ok: boolean) => void) | null = null;

export const useCreditsStore = create<CreditsStore>((set, get) => ({
  loaded: false,
  mode: null,
  balance: null,
  costs: {},
  insufficientOpen: false,
  pendingTool: null,
  shortfall: null,
  confirming: null,

  refresh: () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const [plansRes, creditsRes] = await Promise.all([fetchApi("/api/plans"), fetchApi("/api/credits")]);
        const next: Partial<CreditsState> = { loaded: true };
        if (plansRes.ok) next.costs = costMap(((await plansRes.json()) as PlanCatalogue).run_costs);
        if (creditsRes.ok) {
          const body = (await creditsRes.json()) as { mode: CreditsMode; balance: number };
          next.mode = body.mode;
          next.balance = body.balance;
        }
        set(next);
      } catch {
        set({ loaded: true });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  costOf: (tool) => costFor(get().costs, tool),

  requestRun: (tool) => {
    const { mode, balance, loaded } = get();
    if (!loaded) void get().refresh();
    if (!shouldBlock(mode, balance, get().costOf(tool))) return true;
    set({ insufficientOpen: true, pendingTool: tool, shortfall: null });
    return false;
  },

  openInsufficient: (tool, shortfall = null) => set({ insufficientOpen: true, pendingTool: tool ?? null, shortfall }),
  closeInsufficient: () => set({ insufficientOpen: false, pendingTool: null, shortfall: null }),

  resolveConfirm: (ok) => {
    set({ confirming: null });
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve?.(ok);
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener(INSUFFICIENT_CREDITS_EVENT, (event) => {
    const detail = (event as CustomEvent).detail as { cost?: number; balance?: number } | null;
    const shortfall =
      detail && typeof detail.cost === "number" && typeof detail.balance === "number"
        ? { cost: detail.cost, balance: detail.balance }
        : null;
    useCreditsStore.getState().openInsufficient(undefined, shortfall);
    void useCreditsStore.getState().refresh();
  });
}

/** Server price for one configuration. ``null`` when the server cannot be reached. */
export async function fetchRunQuote(tool: string, params: RunParams = {}, signal?: AbortSignal): Promise<QuoteResponse | null> {
  try {
    const res = await fetchApi("/api/credits/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, params }),
      signal,
    });
    return res.ok ? ((await res.json()) as QuoteResponse) : null;
  } catch {
    return null;
  }
}

/** Confirmed price and request key for the next run-start request (one use, short-lived). */
let pendingStart: { expected: number; key: string; at: number } | null = null;
const PENDING_START_TTL_MS = 60_000;

function newRequestKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Called by ``fetchApi`` for POSTs: attaches the confirmed price to a run-start request. */
export function takeRunStartHeaders(path: string): Record<string, string> {
  if (!pendingStart || !isRunStartPath(path)) return {};
  const fresh = Date.now() - pendingStart.at < PENDING_START_TTL_MS;
  const out = fresh ? { "X-Expected-Credits": String(pendingStart.expected), "Idempotency-Key": pendingStart.key } : {};
  pendingStart = null;
  return out;
}

/**
 * Run-start gate: prices the configuration on the server, blocks when the balance is
 * short, and asks for confirmation on large runs. The server re-prices on submit and
 * refuses a price higher than the one confirmed here.
 */
export async function confirmRun(tool: string, params: RunParams = {}): Promise<boolean> {
  const store = useCreditsStore.getState();
  if (!store.loaded) void store.refresh();
  const quote = await fetchRunQuote(tool, params);
  if (!quote) return store.requestRun(tool);
  if (quote.mode === "enforce" && !quote.sufficient) {
    store.openInsufficient(tool, quote.balance != null ? { cost: quote.cost, balance: quote.balance } : null);
    return false;
  }
  if (needsRunConfirmation(quote)) {
    confirmResolver?.(false);
    const ok = await new Promise<boolean>((resolve) => {
      confirmResolver = resolve;
      useCreditsStore.setState({ confirming: quote });
    });
    if (!ok) return false;
  }
  pendingStart = { expected: quote.cost, key: newRequestKey(), at: Date.now() };
  return true;
}

/** Synchronous gate kept for callers without a configuration to price. */
export const requestRunCredits = (tool: string): boolean => useCreditsStore.getState().requestRun(tool);

/** The server charged the run when it accepted it; fetch the new balance. */
export const chargeRunCredits = (_tool: string): void => {
  void useCreditsStore.getState().refresh();
};
