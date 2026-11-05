/**
 * Install support for Convolve as a progressive web app. Nothing here claims a native
 * iOS/Android app: the installed app is the same web workspace in its own window.
 */

export type InstallPlatform =
  | "ios"
  | "macos-safari"
  | "android-firefox"
  | "chromium"
  | "edge"
  | "unsupported";

export interface PlatformHints {
  userAgent: string;
  maxTouchPoints?: number;
}

export function detectPlatform({ userAgent: ua, maxTouchPoints = 0 }: PlatformHints): InstallPlatform {
  const iPadOs = /Macintosh/.test(ua) && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return "ios";
  if (/Android/.test(ua) && /Firefox\//.test(ua)) return "android-firefox";
  if (/Firefox\//.test(ua)) return "unsupported";
  if (/Edg\//.test(ua)) return "edge";
  if (/Chrome\/|Chromium\/|SamsungBrowser\//.test(ua)) return "chromium";
  const safari = /Macintosh/.test(ua) && /Version\/(\d+)/.exec(ua);
  if (safari && /Safari\//.test(ua)) return Number(safari[1]) >= 17 ? "macos-safari" : "unsupported";
  return "unsupported";
}

/** Manual steps for browsers that can install but do not offer (or have not yet offered) a prompt. */
export function installSteps(platform: InstallPlatform): string[] | null {
  switch (platform) {
    case "ios":
      return ["Tap the Share button in the browser toolbar.", "Choose “Add to Home Screen”.", "Tap “Add”. Convolve opens from the new icon."];
    case "macos-safari":
      return ["In the Safari menu bar, open File.", "Choose “Add to Dock…”.", "Click “Add”. Convolve opens from the Dock."];
    case "android-firefox":
      return ["Open the browser menu (⋮).", "Choose “Install” or “Add to Home screen”."];
    case "edge":
      return ["Open the browser menu (…).", "Choose Apps → “Install this site as an app”."];
    case "chromium":
      return [
        "Click the install icon at the right of the address bar, if shown.",
        "Or open the browser menu (⋮) and choose “Install Convolve…” (in recent Chrome under “Cast, save and share”).",
      ];
    default:
      return null;
  }
}

export interface StandaloneHints {
  matchMedia?: (query: string) => { matches: boolean };
  navigatorStandalone?: boolean;
  referrer?: string;
}

/** True when the page runs inside the installed app window rather than a browser tab. */
export function isStandalone({ matchMedia, navigatorStandalone, referrer }: StandaloneHints): boolean {
  if (navigatorStandalone) return true;
  if (referrer?.startsWith("android-app://")) return true;
  if (!matchMedia) return false;
  return ["(display-mode: standalone)", "(display-mode: window-controls-overlay)", "(display-mode: minimal-ui)", "(display-mode: fullscreen)"].some(
    (q) => matchMedia(q).matches,
  );
}

export interface InstallOffer {
  /** Show any install entry point at all. */
  visible: boolean;
  /** The browser handed us a native prompt. */
  native: boolean;
  steps: string[] | null;
}

export function installOffer(opts: { standalone: boolean; installed: boolean; hasPrompt: boolean; platform: InstallPlatform }): InstallOffer {
  if (opts.standalone || opts.installed) return { visible: false, native: false, steps: null };
  if (opts.hasPrompt) return { visible: true, native: true, steps: null };
  const steps = installSteps(opts.platform);
  return { visible: !!steps, native: false, steps };
}

export const INSTALL_DISMISSED_KEY = "convolve.install.dismissed";
