import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { FleetBot, FleetPayload, FleetRange } from "./api";
import {
  botHref,
  buildChartRows,
  contributionRows,
  dailyRows,
  decomposition,
  emptyDailyRows,
  fmtAge,
  fmtMoney,
  fmtPct,
  MIN_MAIN,
  pickLayout,
  PORTFOLIO_HREF,
  sortBots,
  statusLabel,
  timeTicks,
} from "./lib";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string, range: FleetRange = "1W"): FleetPayload =>
  JSON.parse(readFileSync(join(here, "fixtures", `${name}.${range}.json`), "utf8")) as FleetPayload;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

/**
 * Overview area for a viewport with the compact header collapsed (the overlay header keeps it
 * collapsed on /dashboard): shell top 32, bottom padding 10, top bar 52, root padding 16;
 * sidebar 92 + gutters 30, root padding 16.
 */
const area = (vw: number, vh: number) => ({ width: vw - 122 - 16, height: vh - 32 - 10 - 52 - 16 });
const VIEWPORTS: [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1680, 1050],
  [1920, 1080],
  [2560, 1440],
];

test("every desktop viewport gets a single-screen tier whose fixed rows leave a usable main row", () => {
  for (const [vw, vh] of VIEWPORTS) {
    const { width, height } = area(vw, vh);
    const l = pickLayout(width, height);
    assert.notEqual(l.tier, "stacked", `${vw}x${vh}`);
    const fixed = l.kpiHeight + l.secondaryHeight + l.swimlaneHeight + l.gap * (l.showSwimlane ? 3 : 2);
    assert.ok(height - fixed >= 220, `${vw}x${vh}: main row ${height - fixed}px`);
    assert.equal(l.showUnderwater, height - fixed >= MIN_MAIN, `${vw}x${vh}: underwater`);
    assert.ok(l.secondary.length >= 2, `${vw}x${vh}: at least daily + health`);
    assert.ok(l.secondary.includes("health"), `${vw}x${vh}: health (errors) never dropped`);
  }
});

test("tiers degrade by dropping panels, not scaling text", () => {
  assert.equal(pickLayout(area(1280, 720).width, area(1280, 720).height).tier, "M");
  assert.equal(pickLayout(area(1366, 768).width, area(1366, 768).height).tier, "M");
  assert.equal(pickLayout(area(1440, 900).width, area(1440, 900).height).tier, "L");
  assert.equal(pickLayout(area(1920, 1080).width, area(1920, 1080).height).tier, "L");
  const s = pickLayout(1400, 560);
  assert.equal(s.tier, "S");
  assert.deepEqual(s.secondary, ["daily", "health"]);
  assert.equal(pickLayout(900, 800).tier, "stacked");
  assert.equal(pickLayout(area(1280, 720).width, 600).compact, true);
  assert.equal(pickLayout(area(1440, 900).width, 600).compact, false);
});

test("formatters never turn missing values into zeros and never assume a currency", () => {
  assert.equal(fmtMoney(null, "USD"), "—");
  assert.equal(fmtMoney(undefined, "USD"), "—");
  assert.equal(fmtMoney(Number.NaN, "USD"), "—");
  assert.equal(fmtMoney(-10.6961, "USD", { signed: true }), "−$10.70");
  assert.equal(fmtMoney(12.5, "USD", { signed: true }), "+$12.50");
  assert.equal(fmtMoney(12.5, null), "12.50");
  assert.equal(fmtMoney(1200, "EUR"), "€1,200");
  assert.equal(fmtMoney(123456, "USD", { compact: true }), "$123k");
  assert.equal(fmtPct(null), "—");
  assert.equal(fmtPct(-0.0123), "−1.23%");
  assert.equal(fmtPct(0.5, 0, false), "50%");
  assert.equal(fmtAge(null), "—");
  assert.equal(fmtAge(45), "45 s");
  assert.equal(fmtAge(3600), "60 min");
});

test("chart rows keep nulls before deployment and close markers sit on the fleet line", () => {
  const p = fixture("fleet3", "1M");
  for (const mode of ["pnl", "equity", "twr"] as const) {
    const rows = buildChartRows(p, mode);
    assert.equal(rows.length, p.series.t!.length);
    rows.forEach((r, i) => {
      const src = mode === "pnl" ? p.series.net_pnl![i] : mode === "equity" ? p.series.equity![i] : p.series.twr![i];
      assert.equal(r.value, src ?? null);
      if (r.closeUp != null) assert.equal(r.closeUp, r.value);
      if (r.closeDown != null) assert.equal(r.closeDown, r.value);
    });
  }
  const rows = buildChartRows(p, "pnl");
  for (const [id, arr] of Object.entries(p.series.bots_net_pnl ?? {})) {
    arr.forEach((v, i) => assert.equal(rows[i][`b_${id}`], v ?? null));
  }
  const pa = fixture("fleet3", "ALL");
  const all = buildChartRows(pa, "equity");
  const bucket = (pa.window.bucket_s ?? 0) * 1000;
  let checked = 0;
  for (const b of pa.bots.filter((x) => x.in_aggregate)) {
    const dep = Date.parse(b.deployed_at!);
    for (const r of all) {
      if (r.t + bucket <= dep) {
        assert.equal(r[`b_${b.id}`], null, `${b.symbol} has no value before deployment`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, "a later-deployed bot is null (not 0) before its deployment");
  assert.ok(all.every((r) => r.value == null || r.value > 0));
});

test("fixture fleets reconcile: equity = Σ included bots, net = equity − contributed = realized + unrealized", () => {
  for (const name of ["fleet1", "fleet3", "fleet12", "real"]) {
    const p = fixture(name);
    const inc = p.bots.filter((b) => b.in_aggregate);
    assert.deepEqual(new Set(inc.map((b) => b.id)), new Set(p.currency.included_bot_ids));
    close(p.kpis.equity!, inc.reduce((a, b) => a + b.equity, 0), 1e-3);
    close(p.kpis.net_pnl!, p.kpis.equity! - p.kpis.contributed_capital!, 1e-3);
    close(p.kpis.net_pnl!, p.kpis.realized_pnl! + p.kpis.unrealized_pnl!, 1e-3);
    for (const b of p.bots) close(b.net_pnl, b.realized_pnl + b.unrealized_pnl, 1e-3);
    const last = p.series.equity!.at(-1);
    if (last != null) close(last, p.kpis.equity!, 1e-3);
  }
});

test("no-bot and mixed-currency fixtures expose unavailability instead of fake numbers", () => {
  const zero = fixture("fleet0");
  assert.equal(zero.bots.length, 0);
  assert.equal(zero.kpis.unavailable, undefined);
  assert.equal(zero.kpis.equity, 0);
  assert.equal(zero.kpis.net_pnl, 0);
  assert.equal(zero.kpis.gross_exposure?.value, 0);
  assert.equal(zero.kpis.twr, null, "no history → unavailable, not 0");
  assert.equal(zero.kpis.max_drawdown?.value, null);
  assert.equal(zero.kpis.win_rate?.value, null);
  assert.equal(buildChartRows(zero, "pnl").length, 0, "no invented observations");
  assert.ok(zero.window.start && zero.window.end, "empty charts still get a real time frame");
  const days = emptyDailyRows(zero.as_of, 14);
  assert.equal(days.length, 14);
  assert.ok(days.every((d) => d.pnl === null));
  assert.equal(days[13].date, zero.as_of.slice(0, 10));
  assert.equal(days[13].complete, false);
  const twelve = fixture("fleet12");
  const ex = twelve.currency.excluded.map((e) => e.symbol);
  assert.ok(ex.includes("SAP.DE"), "EUR bot excluded from USD totals");
  assert.equal(twelve.currency.base, "USD");
  assert.ok(twelve.bots.find((b) => b.symbol === "SAP.DE")?.in_aggregate === false);
});

test("fleet table puts failing and stale bots first", () => {
  const p = fixture("fleet12");
  const sorted = sortBots(p.bots);
  const firstOk = sorted.findIndex((b) => b.status !== "error" && !b.valuation_stale && !b.ops_stale);
  const lastBad = sorted.map((b) => b.status === "error" || b.valuation_stale || b.ops_stale).lastIndexOf(true);
  assert.ok(lastBad < firstOk || firstOk === -1, "all error/stale rows precede healthy rows");
  assert.equal(sorted[0].status, "error");
  const paused = { ...sorted[0], status: "paused", valuation_stale: true, ops_stale: false } as FleetBot;
  assert.equal(statusLabel(paused), "Paused · stale");
});

test("daily rows preserve days without valuations as null and cap the bar count", () => {
  const p = fixture("fleet3", "1M");
  const rows = dailyRows(p, 10);
  assert.ok(rows.length <= 10);
  assert.deepEqual(rows.map((r) => r.date), p.daily.slice(-10).map((d) => d.date));
  rows.forEach((r, i) => assert.equal(r.pnl, p.daily.slice(-10)[i].pnl));
  const real = dailyRows(fixture("real", "1M"), 60);
  assert.ok(real.some((r) => r.pnl == null) || real.every((r) => r.observations > 0));
  for (const r of real) if (r.observations === 0) assert.equal(r.pnl, null);
});

test("contribution rows aggregate the tail into 'others' without losing P&L", () => {
  const p = fixture("fleet12", "1M");
  const full = contributionRows(p, 99);
  const capped = contributionRows(p, 5);
  assert.equal(capped.length, 5);
  assert.equal(capped.at(-1)!.id, "__others");
  close(capped.reduce((a, r) => a + r.pnl, 0), full.reduce((a, r) => a + r.pnl, 0), 1e-3);
  for (const r of full) close(r.pnl, r.realized + r.unrealized, 1e-3);
});

test("single-bot decomposition sums to the bot's net P&L", () => {
  for (const name of ["fleet1", "real"]) {
    const b = fixture(name).bots[0];
    const d = decomposition(b);
    const parts = d.filter((x) => x.kind === "component").reduce((a, x) => a + x.value, 0);
    close(parts, d.find((x) => x.kind === "total")!.value, 1e-3);
    close(d.find((x) => x.kind === "total")!.value, b.net_pnl, 1e-9);
  }
});

test("time ticks are calendar aligned, ordered and inside the window", () => {
  const start = Date.parse("2026-10-01T03:17:00Z");
  const end = Date.parse("2026-10-22T11:00:00Z");
  const { ticks, step } = timeTicks(start, end, 900);
  assert.ok(ticks.length >= 2 && ticks.length <= Math.floor(900 / 84) + 1);
  assert.ok(step >= 86400e3);
  for (let i = 0; i < ticks.length; i++) {
    assert.ok(ticks[i] >= start && ticks[i] <= end);
    const d = new Date(ticks[i]);
    assert.equal(d.getHours() * 60 + d.getMinutes(), 0, "local midnight");
    if (i) assert.ok(ticks[i] > ticks[i - 1]);
  }
  const day = timeTicks(end - 86400e3, end, 900);
  assert.ok(day.step < 86400e3);
  for (const t of day.ticks) assert.equal(new Date(t).getMinutes(), 0);
});

test("overview source has no demo widgets, synthetic baselines or production fixture imports", () => {
  const files = [
    join(here, "../../pages/Dashboard.tsx"),
    join(here, "FleetOverview.tsx"),
    join(here, "useFleet.ts"),
    ...["KpiStrip", "EquityPanel", "FleetTable", "DailyPnlPanel", "ContributionPanel", "ExposurePanel", "HealthEventsPanel", "ActivitySwimlane"].map((f) => join(here, "panels", `${f}.tsx`)),
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /components\/dashboard\/Demo|MarketTickerTape|PredictionsMarquee|GradCam|AccuracyRings|LabelMatch/, f);
    assert.doesNotMatch(src, /10_?000\b/, `${f}: hard-coded capital baseline`);
    assert.doesNotMatch(src, /monotone|natural"/, `${f}: smoothed lines`);
  }
  const hook = readFileSync(join(here, "useFleet.ts"), "utf8");
  assert.match(hook, /import\.meta\.env\.DEV \? await import\("\.\/fixtureLoader"\)/);
});

test("deep links point at existing routes", () => {
  assert.equal(botHref("a b/c"), "/dashboard/bots/a%20b%2Fc");
  assert.equal(PORTFOLIO_HREF, "/dashboard/portfolio");
});
