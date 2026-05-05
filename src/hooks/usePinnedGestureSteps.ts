import { type RefObject, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Observer } from "gsap/Observer";

gsap.registerPlugin(ScrollTrigger, Observer);

export type UsePinnedGestureStepsArgs = {
  sectionRef: RefObject<HTMLElement | null>;
  stepCount: number;
  activeStep: number;
  onStepChange: (next: number) => void;
  enabled?: boolean;
  debug?: boolean;
  lockMs?: number;
};

/**
 * Pins `sectionRef` with ScrollTrigger; uses GSAP Observer (not raw wheel) for one step per gesture.
 * Observer is only enabled while the pin is active so the rest of the page scrolls normally.
 */
export function usePinnedGestureSteps({
  sectionRef,
  stepCount,
  activeStep,
  onStepChange,
  enabled = true,
  debug = false,
  lockMs = 700,
}: UsePinnedGestureStepsArgs) {
  const lockedRef = useRef(false);
  const activeStepRef = useRef(activeStep);
  const onStepChangeRef = useRef(onStepChange);
  const observerRef = useRef<Observer | null>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  activeStepRef.current = activeStep;
  onStepChangeRef.current = onStepChange;

  useLayoutEffect(() => {
    if (!enabled) return;
    if (!sectionRef.current) return;
    if (stepCount <= 0) return;

    const el = sectionRef.current;

    const clearUnlockTimer = () => {
      if (unlockTimerRef.current != null) {
        clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
      }
    };

    const unlockLater = () => {
      clearUnlockTimer();
      unlockTimerRef.current = window.setTimeout(() => {
        lockedRef.current = false;
        unlockTimerRef.current = null;
      }, lockMs);
    };

    const stepForward = () => {
      if (lockedRef.current) return;

      const current = activeStepRef.current;
      if (current < stepCount - 1) {
        lockedRef.current = true;
        onStepChangeRef.current(current + 1);
        unlockLater();
        return;
      }

      const obs = observerRef.current;
      const st = triggerRef.current;
      obs?.disable();
      requestAnimationFrame(() => {
        if (st) {
          window.scrollTo({ top: st.end + 2, behavior: "auto" });
        }
        ScrollTrigger.refresh();
      });
    };

    const stepBackward = () => {
      if (lockedRef.current) return;

      const current = activeStepRef.current;
      if (current > 0) {
        lockedRef.current = true;
        onStepChangeRef.current(current - 1);
        unlockLater();
        return;
      }

      const obs = observerRef.current;
      const st = triggerRef.current;
      obs?.disable();
      requestAnimationFrame(() => {
        if (st) {
          window.scrollTo({ top: Math.max(0, st.start - 2), behavior: "auto" });
        }
        ScrollTrigger.refresh();
      });
    };

    const ctx = gsap.context(() => {
      const observer = Observer.create({
        target: window,
        type: "wheel,touch,pointer",
        preventDefault: true,
        tolerance: 14,
        wheelSpeed: 1,
        onDown: stepForward,
        onUp: stepBackward,
      });
      observer.disable();
      observerRef.current = observer;

      triggerRef.current = ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: "+=100%",
        pin: true,
        pinSpacing: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        markers: debug,
        onToggle: (self) => {
          if (self.isActive) {
            observer.enable();
          } else {
            observer.disable();
          }
        },
      });

      requestAnimationFrame(() => {
        ScrollTrigger.refresh();
      });
    }, el);

    return () => {
      clearUnlockTimer();
      lockedRef.current = false;
      observerRef.current?.kill();
      observerRef.current = null;
      triggerRef.current?.kill();
      triggerRef.current = null;
      ctx.revert();
    };
  }, [sectionRef, stepCount, enabled, debug, lockMs]);
}
