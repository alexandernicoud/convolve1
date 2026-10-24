import { create } from "zustand";
import { fetchApi, INSUFFICIENT_CREDITS_EVENT } from "@/lib/api";
import { costFor, costMap, shouldBlock, type CreditsMode, type PlanCatalogue } from "@/features/credits/model";

/**
 * Mirror of the server-side credit balance. The backend owns balances, prices and
 * charging; this store only displays them and opens the "not enough credits" dialog.
 * Nothing here is persisted: a balance held in the browser is never trusted.
 */

const LEGACY_STORAGE_KEY = "convolve_credits";

interface CreditsState {
  loaded: boolean;
  mode: CreditsMode | null;
  balance: number | null;
  costs: Record<string, number>;
  insufficientOpen: boolean;
  pendingTool: string | null;
  /** Cost and balance from the server's 402 response, when that is what opened the dialog. */
  shortfall: { cost: number; balance: number } | null;
}

interface CreditsActions {
  refresh: () => Promise<void>;
  costOf: (tool: string) => number;
  requestRun: (tool: string) => boolean;
  openInsufficient: (tool?: string, shortfall?: { cost: number; balance: number } | null) => void;
  closeInsufficient: () => void;
}

export type CreditsStore = CreditsState & CreditsActions;

try {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
} catch {
  /* storage unavailable */
}

let inflight: Promise<void> | null = null;

export const useCreditsStore = create<CreditsStore>((set, get) => ({
  loaded: false,
  mode: null,
  balance: null,
  costs: {},
  insufficientOpen: false,
  pendingTool: null,
  shortfall: null,

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

/** Run-start gate. The server still decides; this only avoids a request that would be refused. */
export const requestRunCredits = (tool: string): boolean => useCreditsStore.getState().requestRun(tool);

/** The server charged the run when it accepted it; fetch the new balance. */
export const chargeRunCredits = (_tool: string): void => {
  void useCreditsStore.getState().refresh();
};
