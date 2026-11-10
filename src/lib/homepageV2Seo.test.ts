import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_ALIASES, PUBLIC_ROUTES, isNoindex, routeMeta } from "./seoRoutes";

const vercel = JSON.parse(fs.readFileSync(path.resolve("vercel.json"), "utf8")) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

test("homepage V2 is noindex, outside the sitemap and canonical to the live homepage", () => {
  assert.equal(routeMeta("/homepage-v2"), null);
  assert.ok(!PUBLIC_ROUTES.some((r) => r.path.includes("homepage-v2")));
  assert.equal(isNoindex("/homepage-v2"), true);
  assert.equal(CANONICAL_ALIASES["/homepage-v2"], "/");
});

test("vercel serves homepage V2 as the SPA with an X-Robots-Tag noindex header and no redirect", () => {
  const match = (source: string) => new RegExp(`^${source.replace(/:path\*/g, ".*")}$`).test("/homepage-v2");
  assert.ok(vercel.rewrites.some((r) => match(r.source) && r.destination === "/index.html"));
  assert.ok(vercel.headers.some((h) => match(h.source) && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value.includes("noindex"))));
  assert.ok(!JSON.stringify((vercel as { redirects?: unknown }).redirects ?? []).includes("homepage-v2"));
});
