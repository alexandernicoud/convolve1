import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OFFICIAL_PROFILES, PUBLIC_ROUTES, SITE_NAME, SITE_URL } from "./seoRoutes";
import content from "./seoContent.json";
import type { SeoPage } from "./seoHtml";

const root = path.resolve(process.cwd());
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const home = (content as unknown as Record<string, SeoPage>)["/"];

test("homepage title, H1 and JSON-LD lead with Convolve on the canonical domain", () => {
  assert.equal(PUBLIC_ROUTES[0].title.startsWith(`${SITE_NAME} `) || PUBLIC_ROUTES[0].title === SITE_NAME, true);
  assert.match(PUBLIC_ROUTES[0].description, /^Convolve\b/);
  assert.match(String(home.blocks.find(([tag]) => tag === "h1")?.[1] ?? ""), /Convolve|AI that reads charts/i);
  assert.match(indexHtml, /rel="canonical" href="https:\/\/www\.we-convolve\.com\/"/);
  assert.match(indexHtml, /"@type": "WebSite"/);
  assert.match(indexHtml, /"@type": "Organization"/);
  assert.match(indexHtml, /"name": "Convolve"/);
  assert.match(indexHtml, new RegExp(SITE_URL.replace(/\./g, "\\.")));
});

test("official sameAs profiles are real HTTPS URLs, not placeholders", () => {
  assert.ok(OFFICIAL_PROFILES.length >= 1);
  for (const url of OFFICIAL_PROFILES) {
    assert.match(url, /^https:\/\//);
    assert.ok(!url.startsWith("https://www.instagram.com"), url);
    assert.match(indexHtml, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("brand icons and OG image exist for crawlers and share previews", () => {
  for (const file of [
    "favicon.ico",
    "favicon.svg",
    "favicon-32x32.png",
    "favicon-48x48.png",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "og-image.png",
    "site.webmanifest",
    "robots.txt",
  ]) {
    assert.ok(fs.existsSync(path.join(root, "public", file)), file);
  }
  assert.match(indexHtml, /favicon-48x48\.png/);
  assert.match(indexHtml, /og-image\.png/);
  assert.match(indexHtml, /og:image:alt/);
  const robots = fs.readFileSync(path.join(root, "public/robots.txt"), "utf8");
  assert.match(robots, /Sitemap:\s*https:\/\/www\.we-convolve\.com\/sitemap\.xml/);
  assert.match(robots, /Disallow:\s*\/seo\//);
});
