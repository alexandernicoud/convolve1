import { create } from "zustand";
import { fetchApi } from "@/lib/api";
import { INITIAL_STATE, clampStep, move, shouldAutoWelcome, type OnboardingState, type TourPosition } from "./model";
import { TOUR_STEPS } from "./steps";

/**
 * Tour progress. The server keeps the durable state (status, step, welcome seen), so it
 * follows the account across devices. The position inside a step lives in
 * sessionStorage only, so a reload resumes on the same control.
 */

const SPOT_KEY = "convolve:tour-spot";

export type OnboardingView = "welcome" | "tour" | "complete" | null;

type Store = {
  loaded: boolean;
  server: OnboardingState | null;
  view: OnboardingView;
  pos: TourPosition;
  load: () => Promise<void>;
  openWelcome: () => void;
  start: (step?: number) => void;
  next: () => void;
  prev: () => void;
  arrived: () => void;
  left: () => void;
  /** Close the tour, keeping the step so it can be resumed from Help. */
  exit: () => void;
  /** Dismiss the welcome without starting the tour. */
  skip: () => void;
  closeComplete: () => void;
  reset: () => void;
};

function readSpot(): number {
  try {
    return Number(sessionStorage.getItem(SPOT_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeSpot(spot: number | null) {
  try {
    if (spot == null) sessionStorage.removeItem(SPOT_KEY);
    else sessionStorage.setItem(SPOT_KEY, String(spot));
  } catch {
    /* storage unavailable */
  }
}

async function save(state: Pick<OnboardingState, "status" | "step" | "welcome_seen">): Promise<OnboardingState | null> {
  try {
    const res = await fetchApi("/api/account/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    return res.ok ? ((await res.json()) as OnboardingState) : null;
  } catch {
    return null;
  }
}

let loading: Promise<void> | null = null;

export const useOnboardingStore = create<Store>((set, get) => {
  const persist = (status: OnboardingState["status"], step: number) => {
    const local = { ...(get().server ?? INITIAL_STATE), status, step, welcome_seen: true };
    set({ server: local });
    void save({ status, step, welcome_seen: true }).then((s) => s && set({ server: s }));
  };

  const goTo = (pos: TourPosition | null) => {
    if (pos == null) {
      writeSpot(null);
      set({ view: "complete" });
      persist("completed", TOUR_STEPS.length - 1);
      return;
    }
    const stepChanged = pos.step !== get().pos.step;
    set({ pos, view: "tour" });
    writeSpot(pos.spot);
    if (stepChanged || get().server?.status !== "active") persist("active", pos.step);
  };

  return {
    loaded: false,
    server: null,
    view: null,
    pos: { step: 0, spot: 0 },

    load: () => {
      if (loading) return loading;
      loading = (async () => {
        try {
          const res = await fetchApi("/api/account/onboarding");
          const server = res.ok ? ((await res.json()) as OnboardingState) : null;
          const step = server ? clampStep(server.step, TOUR_STEPS.length) : 0;
          let view: OnboardingView = null;
          if (shouldAutoWelcome(server)) view = "welcome";
          else if (server?.status === "active") view = "tour";
          set({ loaded: true, server, view, pos: { step, spot: view === "tour" ? readSpot() : 0 } });
        } catch {
          set({ loaded: true });
        } finally {
          loading = null;
        }
      })();
      return loading;
    },

    openWelcome: () => set({ view: "welcome" }),

    start: (step = 0) => goTo(move(get().pos, { type: "start", step: clampStep(step, TOUR_STEPS.length) })),

    next: () => {
      const { pos } = get();
      goTo(move(pos, { type: "next", spotsInStep: TOUR_STEPS[pos.step].spots.length, stepCount: TOUR_STEPS.length }));
    },

    prev: () => {
      const { pos } = get();
      const prevSpots = pos.step > 0 ? TOUR_STEPS[pos.step - 1].spots.length : 0;
      goTo(move(pos, { type: "prev", spotsInPrevStep: prevSpots }));
    },

    arrived: () => {
      const next = move(get().pos, { type: "arrived" });
      if (next && next.spot !== get().pos.spot) goTo(next);
    },

    left: () => {
      const next = move(get().pos, { type: "left" });
      if (next && next.spot !== get().pos.spot) goTo(next);
    },

    exit: () => {
      writeSpot(null);
      set({ view: null });
      persist("dismissed", get().pos.step);
    },

    skip: () => {
      set({ view: null });
      persist("dismissed", 0);
    },

    closeComplete: () => set({ view: null }),

    reset: () => {
      loading = null;
      writeSpot(null);
      set({ loaded: false, server: null, view: null, pos: { step: 0, spot: 0 } });
    },
  };
});
