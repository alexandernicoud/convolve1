export interface OverflowIssue {
  kind: "page-scroll" | "panel-overflow" | "panel-clipped";
  target: string;
  detail: string;
}

export interface AuditReport {
  viewport: { width: number; height: number };
  root: { top: number; bottom: number; width: number; height: number } | null;
  tier: string | null;
  panels: { id: string; top: number; bottom: number; width: number; height: number; scrollHeight: number; clientHeight: number }[];
  issues: OverflowIssue[];
  ok: boolean;
}

const TOL = 1;

/**
 * DOM overflow audit for the overview. Page-level scrolling is checked on the document and
 * the shell's scroll containers; panels must not overflow their box unless they are marked
 * `data-scroll-allowed` (the fleet table, research list).
 */
export function auditOverview(doc: Document = document): AuditReport {
  const win = doc.defaultView ?? window;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const issues: OverflowIssue[] = [];
  const se = doc.scrollingElement ?? doc.documentElement;
  if (se.scrollHeight > se.clientHeight + TOL) issues.push({ kind: "page-scroll", target: "document", detail: `scrollHeight ${se.scrollHeight} > clientHeight ${se.clientHeight}` });
  if (se.scrollWidth > se.clientWidth + TOL) issues.push({ kind: "page-scroll", target: "document-x", detail: `scrollWidth ${se.scrollWidth} > clientWidth ${se.clientWidth}` });

  const root = doc.querySelector<HTMLElement>("[data-fleet-root]");
  let ancestor = root?.parentElement ?? null;
  while (ancestor && ancestor !== doc.body) {
    const st = win.getComputedStyle(ancestor);
    if (/(auto|scroll)/.test(st.overflowY) && ancestor.scrollHeight > ancestor.clientHeight + TOL) {
      issues.push({ kind: "page-scroll", target: ancestor.tagName.toLowerCase() + (ancestor.className ? `.${String(ancestor.className).split(" ")[0]}` : ""), detail: `scrollHeight ${ancestor.scrollHeight} > clientHeight ${ancestor.clientHeight}` });
    }
    ancestor = ancestor.parentElement;
  }

  const rr = root?.getBoundingClientRect() ?? null;
  if (rr && rr.bottom > vh + TOL) issues.push({ kind: "panel-clipped", target: "fleet-root", detail: `bottom ${Math.round(rr.bottom)} > viewport ${vh}` });
  if (root && root.scrollHeight > root.clientHeight + TOL && !root.hasAttribute("data-scroll-allowed")) issues.push({ kind: "panel-overflow", target: "fleet-root", detail: `scrollHeight ${root.scrollHeight} > clientHeight ${root.clientHeight}` });

  const panels = Array.from(doc.querySelectorAll<HTMLElement>("[data-panel]")).map((el) => {
    const r = el.getBoundingClientRect();
    const id = el.dataset.panel ?? "?";
    if (el.scrollHeight > el.clientHeight + TOL) issues.push({ kind: "panel-overflow", target: id, detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
    if (rr && (r.bottom > rr.bottom + TOL || r.right > rr.right + TOL)) issues.push({ kind: "panel-clipped", target: id, detail: `panel extends past overview (${Math.round(r.bottom)} > ${Math.round(rr.bottom)})` });
    el.querySelectorAll<HTMLElement>("*").forEach((child) => {
      if (child.closest("[data-scroll-allowed]")) return;
      const st = win.getComputedStyle(child);
      if (/(auto|scroll)/.test(st.overflowY) && child.scrollHeight > child.clientHeight + TOL) {
        issues.push({ kind: "panel-overflow", target: `${id} > ${child.tagName.toLowerCase()}`, detail: `unexpected inner scroll ${child.scrollHeight} > ${child.clientHeight}` });
      }
    });
    return { id, top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });

  return {
    viewport: { width: vw, height: vh },
    root: rr ? { top: Math.round(rr.top), bottom: Math.round(rr.bottom), width: Math.round(rr.width), height: Math.round(rr.height) } : null,
    tier: root?.dataset.tier ?? null,
    panels,
    issues,
    ok: issues.length === 0,
  };
}
