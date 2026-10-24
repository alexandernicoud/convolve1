import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ANNOTATIONS, annotationIdOf, getAnnotation, pageHelpFor } from "./annotations";

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const code = sources(join(process.cwd(), "src")).map((p) => readFileSync(p, "utf8"));

test("every data-help id used in the app has an explanation", () => {
  const used = new Set<string>();
  // data-help="…" attributes and help="…" props (Panel, Figure) that render it.
  for (const src of code) for (const m of src.matchAll(/\bhelp="([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 20, "expected the tool pages to be annotated");
  for (const id of used) assert.ok(getAnnotation(id), `data-help="${id}" has no annotation`);
});

test("every annotation is reachable from a control or the help center", () => {
  const all = code.join("\n");
  const help = readFileSync(join(process.cwd(), "src/features/help/HelpPage.tsx"), "utf8");
  for (const id of Object.keys(ANNOTATIONS)) {
    if (id.startsWith("panel-")) {
      assert.match(all, new RegExp(`(id|data-panel)="${id.slice(6)}"`), `${id} has no dashboard panel`);
      continue;
    }
    if (id.startsWith("train-") && /data-help=\{`train-\$\{/.test(all)) continue;
    const anchored = all.includes(`help="${id}"`) || help.includes(`ANNOTATIONS["${id}"]`);
    assert.ok(anchored, `${id} is never shown`);
  }
});

test("the brief's required explanations are present and exact", () => {
  assert.equal(
    ANNOTATIONS["bt-threshold"].body,
    "The minimum model probability required to generate a BUY signal. A higher threshold produces fewer signals, but does not necessarily improve profitability.",
  );
  for (const id of ["validation-accuracy", "take-profit", "max-drawdown"] as const) {
    assert.ok(ANNOTATIONS[id].body.length > 20);
    assert.ok(ANNOTATIONS[id].visual, `${id} should have a visual`);
  }
});

test("entries are short and link to the help center when they link at all", () => {
  for (const a of Object.values(ANNOTATIONS)) {
    assert.ok(a.body.length <= 220, `${a.id} body is too long`);
    if (a.href) assert.match(a.href, /^\/help(#[a-z-]+)?$/);
  }
});

test("dashboard panels resolve through data-panel", () => {
  const el = (attrs: Record<string, string>) => ({ getAttribute: (n: string) => attrs[n] ?? null });
  assert.equal(annotationIdOf(el({ "data-help": "take-profit" })), "take-profit");
  assert.equal(annotationIdOf(el({ "data-panel": "equity" })), "panel-equity");
  assert.equal(annotationIdOf(el({})), null);
  assert.equal(pageHelpFor("/products/labeling-optimizer/technical")?.title, "Labeling optimizer");
  assert.equal(pageHelpFor("/help"), null);
});
