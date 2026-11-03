/**
 * Static page body for crawlers that do not run JavaScript. It is placed in the route's <noscript>, so
 * browsers with JavaScript never render it and the visible site is unchanged.
 *
 * Content comes from seoContent.json: the headings, paragraphs and links of each public page as rendered
 * by the app, kept only where the text appears in the source (seoContent.test.ts enforces this).
 * No imports: the Vite config loads this file directly.
 */

export type SeoBlock = [tag: "h1" | "h2" | "h3" | "h4" | "p" | "li" | "summary", text: string];
export type SeoPage = { blocks: SeoBlock[]; links: { href: string; label: string }[] };
export type SeoNavItem = { path: string; label: string };

export const SEO_NAV: SeoNavItem[] = [
  { path: "/", label: "Home" },
  { path: "/products", label: "Products" },
  { path: "/about", label: "About" },
  { path: "/help", label: "Help" },
  { path: "/contact", label: "Contact" },
  { path: "/signup", label: "Create account" },
];

export const SEO_LEGAL_NAV: SeoNavItem[] = [
  { path: "/privacy", label: "Privacy" },
  { path: "/terms", label: "Terms" },
  { path: "/subscription-terms", label: "Subscriptions & credits" },
  { path: "/refunds", label: "Refunds & cancellation" },
  { path: "/risk-disclosure", label: "Risk disclosure" },
  { path: "/cookies", label: "Cookies" },
  { path: "/legal", label: "Legal notice" },
];

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function nav(items: SeoNavItem[], label: string, current: string): string {
  const li = items.map((i) => `<li><a href="${escapeHtml(i.path)}"${i.path === current ? ' aria-current="page"' : ""}>${escapeHtml(i.label)}</a></li>`).join("");
  return `<nav aria-label="${escapeHtml(label)}"><ul>${li}</ul></nav>`;
}

export function renderSeoBody(path: string, page: SeoPage | undefined, fallback: { title: string; description: string }): string {
  const parts: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) parts.push(`<ul>${list.join("")}</ul>`);
    list = [];
  };
  const blocks = page?.blocks.length ? page.blocks : ([["h1", fallback.title], ["p", fallback.description]] as SeoBlock[]);
  for (const [tag, text] of blocks) {
    const t = escapeHtml(text);
    if (tag === "li") {
      list.push(`<li>${t}</li>`);
      continue;
    }
    flush();
    parts.push(tag === "summary" ? `<h3>${t}</h3>` : `<${tag}>${t}</${tag}>`);
  }
  flush();
  const nav_ = new Set([...SEO_NAV, ...SEO_LEGAL_NAV].map((n) => n.path));
  const related = (page?.links ?? []).filter((l) => !nav_.has(l.href));
  if (related.length) {
    const rel = related.map((l) => `<li><a href="${escapeHtml(l.href)}"${l.href.startsWith("http") ? ' rel="noopener"' : ""}>${escapeHtml(l.label)}</a></li>`).join("");
    parts.push(`<ul>${rel}</ul>`);
  }
  return (
    `<header>${nav(SEO_NAV, "Main", path)}</header>` +
    `<main>${parts.join("")}<p>Convolve needs JavaScript for the interactive site.</p></main>` +
    `<footer>${nav(SEO_LEGAL_NAV, "Legal", path)}</footer>`
  );
}
