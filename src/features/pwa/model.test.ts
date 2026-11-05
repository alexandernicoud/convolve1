import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatform, installOffer, installSteps, isStandalone } from "./model";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  safari16: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
};

test("platforms are detected from the user agent, including iPadOS posing as a Mac", () => {
  assert.equal(detectPlatform({ userAgent: UA.iphone }), "ios");
  assert.equal(detectPlatform({ userAgent: UA.ipad, maxTouchPoints: 5 }), "ios");
  assert.equal(detectPlatform({ userAgent: UA.ipad, maxTouchPoints: 0 }), "macos-safari");
  assert.equal(detectPlatform({ userAgent: UA.safari16 }), "unsupported", "Add to Dock needs Safari 17");
  assert.equal(detectPlatform({ userAgent: UA.chrome }), "chromium");
  assert.equal(detectPlatform({ userAgent: UA.edge }), "edge");
  assert.equal(detectPlatform({ userAgent: UA.firefox }), "unsupported");
  assert.equal(detectPlatform({ userAgent: UA.androidFirefox }), "android-firefox");
});

test("the installed app hides the offer; a native prompt wins over manual steps", () => {
  assert.equal(installOffer({ standalone: true, installed: false, hasPrompt: true, platform: "chromium" }).visible, false);
  assert.equal(installOffer({ standalone: false, installed: true, hasPrompt: false, platform: "ios" }).visible, false);
  assert.deepEqual(installOffer({ standalone: false, installed: false, hasPrompt: true, platform: "chromium" }), { visible: true, native: true, steps: null });
  const ios = installOffer({ standalone: false, installed: false, hasPrompt: false, platform: "ios" });
  assert.equal(ios.native, false);
  assert.match(ios.steps!.join(" "), /Add to Home Screen/);
  assert.equal(installOffer({ standalone: false, installed: false, hasPrompt: false, platform: "unsupported" }).visible, false);
});

test("no step list claims an app store or a native app", () => {
  for (const p of ["ios", "macos-safari", "android-firefox", "edge", "chromium"] as const) {
    const text = installSteps(p)!.join(" ");
    assert.doesNotMatch(text, /App Store|Play Store|native/i);
  }
});

test("standalone detection covers display modes, iOS and Android TWA", () => {
  const mm = (hit: string) => (q: string) => ({ matches: q === hit });
  assert.equal(isStandalone({ matchMedia: mm("(display-mode: standalone)") }), true);
  assert.equal(isStandalone({ matchMedia: mm("(display-mode: browser)") }), false);
  assert.equal(isStandalone({ navigatorStandalone: true }), true);
  assert.equal(isStandalone({ referrer: "android-app://com.example" }), true);
  assert.equal(isStandalone({}), false);
});
