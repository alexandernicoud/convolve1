import { useSyncExternalStore } from "react";
import { detectPlatform, installOffer, isStandalone, INSTALL_DISMISSED_KEY, type InstallOffer, type InstallPlatform } from "./model";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface State {
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
  dismissed: boolean;
}

const readDismissed = () => {
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

let state: State = { prompt: null, installed: false, dismissed: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let started = false;

/** Call once at startup so the browser's install event is not missed before React mounts. */
export function initInstallCapture() {
  if (started || typeof window === "undefined") return;
  started = true;
  state = { ...state, dismissed: readDismissed() };
  window.addEventListener("beforeinstallprompt", (e) => {
    // Suppress the browser's own mini-infobar; Convolve offers installation from its own UI.
    e.preventDefault();
    set({ prompt: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => set({ installed: true, prompt: null }));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export interface InstallState extends InstallOffer {
  platform: InstallPlatform;
  dismissed: boolean;
  /** Opens the native prompt; resolves true when the user accepted. */
  promptInstall: () => Promise<boolean>;
  dismiss: () => void;
}

const platformNow = (): InstallPlatform =>
  typeof navigator === "undefined" ? "unsupported" : detectPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });

const standaloneNow = () =>
  typeof window !== "undefined" &&
  isStandalone({
    matchMedia: window.matchMedia?.bind(window),
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    referrer: document.referrer,
  });

export function useInstall(): InstallState {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  const platform = platformNow();
  const offer = installOffer({ standalone: standaloneNow(), installed: s.installed, hasPrompt: !!s.prompt, platform });
  return {
    ...offer,
    platform,
    dismissed: s.dismissed,
    promptInstall: async () => {
      const p = state.prompt;
      if (!p) return false;
      await p.prompt();
      const { outcome } = await p.userChoice;
      // A prompt event can be used once.
      set({ prompt: null, installed: outcome === "accepted" || state.installed });
      return outcome === "accepted";
    },
    dismiss: () => {
      try {
        window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
      } catch {
        /* private mode: dismissal lasts for this session */
      }
      set({ dismissed: true });
    },
  };
}
