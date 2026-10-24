import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalDevOrigin,
  LOCAL_DEV_ORIGIN,
  oauthCallbackPath,
  oauthRedirectTo,
  parseOAuthCallbackError,
  safeAppPath,
  urlHasAuthCallbackParams,
} from "./authRedirect";

test("OAuth redirect in dev always uses localhost:5173, even if the tab is 127.0.0.1", () => {
  const to = oauthRedirectTo("http://127.0.0.1:5173", "/dashboard", true);
  assert.equal(to.startsWith(LOCAL_DEV_ORIGIN), true);
  assert.equal(to.includes("127.0.0.1"), false);
  assert.equal(to.includes("/auth/callback"), true);
  assert.equal(to.includes("next=%2Fdashboard"), true);
});

test("dev OAuth redirect keeps the tab's port and never uses the production site", () => {
  assert.equal(oauthRedirectTo("http://localhost:5174", "/dashboard", true), "http://localhost:5174/auth/callback?next=%2Fdashboard");
  assert.equal(oauthRedirectTo("http://127.0.0.1:5174", "/account", true), "http://localhost:5174/auth/callback?next=%2Faccount");
  assert.equal(canonicalDevOrigin("http://localhost:5173"), "http://localhost:5173");
  assert.equal(canonicalDevOrigin("http://[::1]:5173"), "http://localhost:5173");
  assert.equal(oauthRedirectTo("http://localhost:5173", "/dashboard", true).includes("we-convolve.com"), false);
});

test("OAuth callback is a public path, not a protected app route", () => {
  const path = oauthCallbackPath("/dashboard");
  assert.equal(path.startsWith("/auth/callback"), true);
  assert.equal(path.startsWith("/dashboard"), false);
  assert.equal(path.startsWith("/login"), false);
});

test("production redirect keeps the real origin", () => {
  const to = oauthRedirectTo("https://app.example.com", "/account", false);
  assert.equal(to, "https://app.example.com/auth/callback?next=%2Faccount");
});

test("safeAppPath rejects open redirects", () => {
  assert.equal(safeAppPath("/dashboard"), "/dashboard");
  assert.equal(safeAppPath("//evil.example"), "/dashboard");
  assert.equal(safeAppPath("https://evil.example"), "/dashboard");
  assert.equal(safeAppPath("dashboard"), "/dashboard");
});

test("parseOAuthCallbackError reads query and hash errors", () => {
  assert.equal(parseOAuthCallbackError("?error=access_denied&error_description=User+denied"), "access_denied: User denied");
  assert.equal(parseOAuthCallbackError("", "#error=server_error"), "server_error");
  assert.equal(parseOAuthCallbackError(""), null);
});

test("urlHasAuthCallbackParams detects PKCE code and implicit tokens", () => {
  assert.equal(urlHasAuthCallbackParams("?code=abc"), true);
  assert.equal(urlHasAuthCallbackParams("", "#access_token=tok"), true);
  assert.equal(urlHasAuthCallbackParams("?error=access_denied"), true);
  assert.equal(urlHasAuthCallbackParams("?next=/dashboard"), false);
});
