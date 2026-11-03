import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import content from "./seoContent.json";
import { renderSeoBody, SEO_LEGAL_NAV, SEO_NAV, type SeoPage } from "./seoHtml";
import { isNoindex, PUBLIC_ROUTES } from "./seoRoutes";

const pages = content as unknown as Record<string, SeoPage>;

const norm = (s: string) =>
  s
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

function sourceCorpus(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(e.name) && !e.name.includes(".test.") && !e.name.startsWith("seoContent")) out.push(norm(fs.readFileSync(p, "utf8")));
    }
  };
  walk(path.resolve(process.cwd(), "src"));
  return out.join("");
}

test("every public route has static content with exactly one h1", () => {
  for (const r of PUBLIC_ROUTES) {
    const page = pages[r.path];
    assert.ok(page, `no static content for ${r.path}`);
    assert.equal(page.blocks.filter(([tag]) => tag === "h1").length, 1, `${r.path} needs exactly one h1`);
  }
});

test("static text is the site's own copy (refresh seoContent.json when page copy changes)", () => {
  const corpus = sourceCorpus();
  for (const [route, page] of Object.entries(pages)) {
    for (const [, text] of page.blocks) {
      for (const seg of text.split(/(?<=[.!?:])\s+/).map(norm).filter((s) => s.length >= 4)) {
        assert.ok(corpus.includes(seg), `${route}: "${text.slice(0, 80)}" is no longer in the source`);
      }
    }
  }
});

test("links point only at public pages or external sites", () => {
  for (const page of Object.values(pages)) {
    for (const l of page.links) assert.ok(/^(https:|mailto:)/.test(l.href) || PUBLIC_ROUTES.some((r) => r.path === l.href), l.href);
  }
  for (const n of [...SEO_NAV, ...SEO_LEGAL_NAV]) {
    assert.ok(PUBLIC_ROUTES.some((r) => r.path === n.path) && !isNoindex(n.path), n.path);
  }
});

test("rendered body escapes text, groups list items and marks the current page", () => {
  const html = renderSeoBody("/about", { blocks: [["h1", "A <b> & c"], ["li", "one"], ["li", "two"], ["p", "after"]], links: [{ href: "https://example.com", label: "Ext" }] }, { title: "T", description: "D" });
  assert.match(html, /<h1>A &lt;b&gt; &amp; c<\/h1><ul><li>one<\/li><li>two<\/li><\/ul><p>after<\/p>/);
  assert.match(html, /<a href="\/about" aria-current="page">About<\/a>/);
  assert.match(html, /<a href="https:\/\/example.com" rel="noopener">Ext<\/a>/);
  const empty = renderSeoBody("/x", undefined, { title: "Title", description: "Desc" });
  assert.match(empty, /<h1>Title<\/h1><p>Desc<\/p>/);
});
