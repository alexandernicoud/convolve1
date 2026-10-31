import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { OG_IMAGE, PUBLIC_ROUTES, SITE_NAME, SITE_URL, routeMeta } from "@/lib/seoRoutes";

function upsert(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

function meta(key: "name" | "property", id: string, content: string) {
  upsert(`meta[${key}="${id}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute(key, id);
    return m;
  }, "content", content);
}

/** Title, description, canonical, social tags and robots for the current route. Only public
 * marketing and legal pages are indexable; everything else (app, account, 404) is noindex. */
export function RouteSeo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const route = routeMeta(pathname);
    const home = PUBLIC_ROUTES[0];
    meta("name", "robots", route ? "index, follow" : "noindex");
    if (!route) {
      if (!document.title || document.title === home.title) document.title = SITE_NAME;
      document.head.querySelector('link[rel="canonical"]')?.remove();
      return;
    }
    const url = `${SITE_URL}${route.path === "/" ? "/" : route.path}`;
    document.title = route.title;
    meta("name", "description", route.description);
    upsert('link[rel="canonical"]', () => {
      const l = document.createElement("link");
      l.setAttribute("rel", "canonical");
      return l;
    }, "href", url);
    meta("property", "og:title", route.title);
    meta("property", "og:description", route.description);
    meta("property", "og:url", url);
    meta("property", "og:image", OG_IMAGE);
    meta("name", "twitter:title", route.title);
    meta("name", "twitter:description", route.description);
  }, [pathname]);
  return null;
}
