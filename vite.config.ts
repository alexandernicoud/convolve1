import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import { PUBLIC_ROUTES, SITE_URL, type RouteMeta } from "./src/lib/seoRoutes";

// https://vitejs.dev/config/
// Match `npm run dev:backend` (port 8001). For `uvicorn` on 8000, run with:
//   VITE_PROXY_API=http://127.0.0.1:8000 npm run dev:frontend
const API_TARGET = process.env.VITE_PROXY_API ?? "http://127.0.0.1:8001";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function withHead(html: string, r: RouteMeta, url: string | null, robots: string): string {
  const t = esc(r.title);
  const d = esc(r.description);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${d}"`)
    .replace(/(<meta name="robots" content=")[^"]*"/, `$1${robots}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${t}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${d}"`)
    .replace(/(<meta name="twitter:title" content=")[^"]*"/, `$1${t}"`)
    .replace(/(<meta name="twitter:description" content=")[^"]*"/, `$1${d}"`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript><h1>${t}</h1><p>${d} Convolve needs JavaScript to run.</p></noscript>`);
  out = url
    ? out.replace(/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`).replace(/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`)
    : out.replace(/\s*<link rel="canonical"[^>]*>/, "").replace(/\s*<meta property="og:url"[^>]*>/, "");
  return out;
}

/** Search metadata in static HTML: one head per public route, the sitemap and a noindex 404 page. */
function seoPages(): Plugin {
  let outDir = "dist";
  return {
    name: "convolve-seo-pages",
    apply: "build",
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const index = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
      fs.mkdirSync(path.join(outDir, "seo"), { recursive: true });
      for (const r of PUBLIC_ROUTES) {
        if (!r.file) continue;
        fs.writeFileSync(path.join(outDir, "seo", `${r.file}.html`), withHead(index, r, `${SITE_URL}${r.path}`, "index, follow"));
      }
      const notFound = { path: "", title: "Page not found | Convolve", description: "This page does not exist." };
      fs.writeFileSync(path.join(outDir, "404.html"), withHead(index, notFound, null, "noindex"));
      const urls = PUBLIC_ROUTES.map(
        (r) =>
          `  <url><loc>${SITE_URL}${r.path}</loc>${r.changefreq ? `<changefreq>${r.changefreq}</changefreq>` : ""}${
            r.priority != null ? `<priority>${r.priority.toFixed(1)}</priority>` : ""
          }</url>`,
      );
      fs.writeFileSync(
        path.join(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      );
    },
  };
}

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 5173,
    // Same-origin requests in dev (empty API_BASE) proxy to FastAPI — avoids CORS / wrong-port uploads
    proxy: {
      "/datasets": { target: API_TARGET, changeOrigin: true },
      "/trainer": { target: API_TARGET, changeOrigin: true },
      "/runs": { target: API_TARGET, changeOrigin: true },
      "/models": { target: API_TARGET, changeOrigin: true },
      "/api": { target: API_TARGET, changeOrigin: true },
    },
    // Optimizer / trainer writes under backend/runs — don't full-reload the SPA on each artifact.
    watch: {
      ignored: ["**/backend/runs/**", "**/backend/datasets/**", "**/backend/models/**", "**/.venv/**"],
    },
  },
  plugins: [react(), seoPages()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
