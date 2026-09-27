import { create } from "zustand";

/**
 * Client-side credit ("energy") system.
 *
 * Every run on any tool costs {@link RUN_COST} credits. Users start with
 * {@link INITIAL_CREDITS}. When a run is attempted without enough credits we
 * open a global "insufficient credits" modal (which routes to the refill page)
 * and block the run. Total credits ever spent is surfaced as XP.
 *
 * Persisted manually to localStorage to match `runsStore`'s conventions.
 */

export const RUN_COST = 10;
export const INITIAL_CREDITS = 50;
export const REFILL_AMOUNT = 500;
/** Reference full tank used for the sidebar progress bar. */
export const CREDIT_BAR_CAP = 500;

const STORAGE_KEY = "convolve_credits";
const MAX_HISTORY = 60;

export type CreditEntryType = "spend" | "refill" | "grant";

export interface CreditEntry {
  id: string;
  ts: number;
  type: CreditEntryType;
  tool?: string | null;
  delta: number;
  balanceAfter: number;
}

interface CreditsState {
  credits: number;
  /** Cumulative credits ever spent — surfaced to the user as "XP". */
  xp: number;
  runsPaid: number;
  refills: number;
  lastRefillAt: number | null;
  history: CreditEntry[];
  /** Global modal state for the blocking "insufficient credits" warning. */
  insufficientOpen: boolean;
  pendingTool: string | null;
}

interface CreditsActions {
  canAfford: (cost?: number) => boolean;
  /**
   * Check whether a run may proceed. Returns true when affordable (does NOT
   * deduct — call {@link chargeRun} once the run actually starts). When not
   * affordable, opens the blocking modal and returns false.
   */
  requestRun: (tool: string, cost?: number) => boolean;
  /** Deduct for a confirmed run start (adds XP + history). */
  chargeRun: (tool: string, cost?: number) => void;
  /** Add credits (refill page button). */
  refill: (amount?: number) => number;
  openInsufficient: (tool?: string) => void;
  closeInsufficient: () => void;
  resetCredits: () => void;
}

export type CreditsStore = CreditsState & CreditsActions;

const DEFAULT_STATE: CreditsState = {
  credits: INITIAL_CREDITS,
  xp: 0,
  runsPaid: 0,
  refills: 0,
  lastRefillAt: null,
  history: [],
  insufficientOpen: false,
  pendingTool: null,
};

const starterGrant = (): CreditsState => {
  const entry: CreditEntry = {
    id: makeId(),
    ts: Date.now(),
    type: "grant",
    tool: null,
    delta: INITIAL_CREDITS,
    balanceAfter: INITIAL_CREDITS,
  };
  return { ...DEFAULT_STATE, history: [entry] };
};

const load = (): CreditsState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = starterGrant();
      save(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<CreditsState>;
    return {
      ...DEFAULT_STATE,
      credits: typeof parsed.credits === "number" ? parsed.credits : INITIAL_CREDITS,
      xp: typeof parsed.xp === "number" ? parsed.xp : 0,
      runsPaid: typeof parsed.runsPaid === "number" ? parsed.runsPaid : 0,
      refills: typeof parsed.refills === "number" ? parsed.refills : 0,
      lastRefillAt: typeof parsed.lastRefillAt === "number" ? parsed.lastRefillAt : null,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_HISTORY) : [],
      // Modal state is always transient, never restored.
      insufficientOpen: false,
      pendingTool: null,
    };
  } catch {
    return starterGrant();
  }
};

const save = (s: CreditsState) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        credits: s.credits,
        xp: s.xp,
        runsPaid: s.runsPaid,
        refills: s.refills,
        lastRefillAt: s.lastRefillAt,
        history: s.history,
      }),
    );
  } catch (err) {
    console.warn("Failed to persist credits:", err);
  }
};

const makeId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const useCreditsStore = create<CreditsStore>((set, get) => ({
  ...load(),

  canAfford: (cost = RUN_COST) => get().credits >= cost,

  requestRun: (tool, cost = RUN_COST) => {
    if (get().credits >= cost) return true;
    set({ insufficientOpen: true, pendingTool: tool });
    return false;
  },

  chargeRun: (tool, cost = RUN_COST) => {
    set((state) => {
      const credits = Math.max(0, state.credits - cost);
      const entry: CreditEntry = {
        id: makeId(),
        ts: Date.now(),
        type: "spend",
        tool,
        delta: -cost,
        balanceAfter: credits,
      };
      const next: CreditsState = {
        ...state,
        credits,
        xp: state.xp + cost,
        runsPaid: state.runsPaid + 1,
        history: [entry, ...state.history].slice(0, MAX_HISTORY),
      };
      save(next);
      return next;
    });
  },

  refill: (amount = REFILL_AMOUNT) => {
    let balance = 0;
    set((state) => {
      const credits = state.credits + amount;
      balance = credits;
      const entry: CreditEntry = {
        id: makeId(),
        ts: Date.now(),
        type: "refill",
        tool: null,
        delta: amount,
        balanceAfter: credits,
      };
      const next: CreditsState = {
        ...state,
        credits,
        refills: state.refills + 1,
        lastRefillAt: Date.now(),
        history: [entry, ...state.history].slice(0, MAX_HISTORY),
        // A refill resolves any blocking state.
        insufficientOpen: false,
        pendingTool: null,
      };
      save(next);
      return next;
    });
    return balance;
  },

  openInsufficient: (tool) => set({ insufficientOpen: true, pendingTool: tool ?? null }),
  closeInsufficient: () => set({ insufficientOpen: false, pendingTool: null }),

  resetCredits: () => {
    const next = { ...DEFAULT_STATE };
    save(next);
    set(next);
  },
}));

/**
 * Helper for run-start handlers: gate a run behind credits. Returns true when
 * the run may proceed (caller should start it, then call
 * `useCreditsStore.getState().chargeRun(tool)` after the start API succeeds).
 * When false, the blocking modal is already open.
 */
export const requestRunCredits = (tool: string, cost = RUN_COST): boolean =>
  useCreditsStore.getState().requestRun(tool, cost);

export const chargeRunCredits = (tool: string, cost = RUN_COST): void =>
  useCreditsStore.getState().chargeRun(tool, cost);
