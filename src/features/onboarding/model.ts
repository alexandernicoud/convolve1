/** Pure tour state machine (no React, no fetch). The server stores ``OnboardingState``. */

export type OnboardingStatus = "new" | "active" | "dismissed" | "completed";

export type OnboardingState = {
  status: OnboardingStatus;
  step: number;
  welcome_seen: boolean;
  updated_at?: string | null;
  completed_at?: string | null;
};

/** Where the user is inside a step: 0 = sidebar item, 1..n = page controls. */
export type TourPosition = { step: number; spot: number };

export type TourAction =
  | { type: "start"; step?: number }
  | { type: "next"; spotsInStep: number; stepCount: number }
  | { type: "prev"; spotsInPrevStep: number }
  | { type: "arrived" }
  | { type: "left" };

export const INITIAL_STATE: OnboardingState = { status: "new", step: 0, welcome_seen: false };

/** The welcome overlay opens by itself exactly once: for a user who has never seen it. */
export function shouldAutoWelcome(state: OnboardingState | null): boolean {
  return state != null && state.status === "new" && !state.welcome_seen;
}

/**
 * Tour navigation. ``spotsInStep`` counts the page spots of the current step (the sidebar
 * spot is extra). Returns ``null`` for the position when the tour has finished.
 */
export function move(pos: TourPosition, action: TourAction): TourPosition | null {
  switch (action.type) {
    case "start":
      return { step: Math.max(0, action.step ?? 0), spot: 0 };
    case "next":
      if (pos.spot < action.spotsInStep) return { step: pos.step, spot: pos.spot + 1 };
      return pos.step + 1 < action.stepCount ? { step: pos.step + 1, spot: 0 } : null;
    case "prev":
      if (pos.spot > 0) return { step: pos.step, spot: pos.spot - 1 };
      return pos.step > 0 ? { step: pos.step - 1, spot: action.spotsInPrevStep } : pos;
    case "arrived":
      // The user reached the step's page (by the sidebar or the button): show its first control.
      return pos.spot === 0 ? { step: pos.step, spot: 1 } : pos;
    case "left":
      // The user navigated away mid-step: point back at the sidebar item.
      return { step: pos.step, spot: 0 };
  }
}

export function clampStep(step: number, stepCount: number): number {
  return Math.min(Math.max(0, Math.trunc(step) || 0), stepCount - 1);
}

/** Popover placement: right of the target if it fits, else left, else below; bottom sheet on narrow screens. */
export function placePopover(
  rect: { top: number; left: number; width: number; height: number },
  viewport: { width: number; height: number },
  card: { width: number; height: number },
  gap = 14,
): { top: number; left: number; sheet: boolean } {
  if (viewport.width < 640) return { top: viewport.height - card.height - 12, left: 12, sheet: true };
  const clampTop = (t: number) => Math.min(Math.max(12, t), viewport.height - card.height - 12);
  const clampLeft = (l: number) => Math.min(Math.max(12, l), viewport.width - card.width - 12);
  const right = rect.left + rect.width + gap;
  if (right + card.width <= viewport.width - 12) return { top: clampTop(rect.top), left: right, sheet: false };
  const left = rect.left - gap - card.width;
  if (left >= 12) return { top: clampTop(rect.top), left, sheet: false };
  const below = rect.top + rect.height + gap;
  if (below + card.height <= viewport.height - 12) return { top: below, left: clampLeft(rect.left), sheet: false };
  return { top: clampTop(rect.top - gap - card.height), left: clampLeft(rect.left), sheet: false };
}
