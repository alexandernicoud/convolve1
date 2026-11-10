// Renders scripts/og/template.html to public/og-convolve.png (1200 × 630) with headless Chrome.
//   node scripts/og/render.mjs            (CHROME=/path/to/chrome to override the browser)
// To refresh the product visual, recapture the homepage hero card into scripts/og/source-heroflow.png at 2× scale.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const chromePath = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "og-chrome-"));
const chrome = spawn(chromePath, ["--headless=new", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
  await sleep(250);
}
if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `file://${path.join(here, "template.html")}` });
await sleep(1500);
await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => [...document.images].every((i) => i.complete))", awaitPromise: true });
await sleep(300);
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
const out = path.join(root, "public/og-convolve.png");
fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`wrote ${path.relative(root, out)}`);
ws.close();
await new Promise((r) => { chrome.once("exit", r); chrome.kill(); });
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
process.exit(0);
