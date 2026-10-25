import test from "node:test";
import assert from "node:assert/strict";
import { countTradingDays, isTradingDay, nyseHolidays, tradingDaysBefore } from "./tradingCalendar";

const d = (iso: string) => {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

test("NYSE holidays include observed and moving dates", () => {
  const h2022 = nyseHolidays(2022);
  for (const k of ["2022-01-17", "2022-02-21", "2022-04-15", "2022-05-30", "2022-06-20", "2022-07-04", "2022-09-05", "2022-11-24", "2022-12-26"])
    assert.ok(h2022.has(k), k);
  // New Year's Day 2022 fell on a Saturday: no Friday observance in 2021.
  assert.ok(!nyseHolidays(2021).has("2021-12-31"));
  assert.ok(nyseHolidays(2021).has("2021-12-24"));
  // Juneteenth only from 2022.
  assert.ok(!nyseHolidays(2021).has("2021-06-18"));
  assert.ok(nyseHolidays(2024).has("2024-03-29")); // Good Friday 2024
});

test("weekends, holidays and unscheduled closures do not trade", () => {
  assert.equal(isTradingDay(d("2024-07-04")), false);
  assert.equal(isTradingDay(d("2024-07-06")), false);
  assert.equal(isTradingDay(d("2024-07-05")), true);
  assert.equal(isTradingDay(d("2012-10-29")), false);
  assert.equal(isTradingDay(d("2025-01-09")), false);
});

test("trading-day counts use the exchange calendar, not calendar days", () => {
  assert.equal(countTradingDays(d("2022-01-01"), d("2022-12-31")), 251);
  assert.equal(countTradingDays(d("2023-01-01"), d("2023-12-31")), 250);
  assert.equal(countTradingDays(d("2024-07-04"), d("2024-07-04")), 0);
});

test("stepping back n trading days skips weekends and holidays", () => {
  assert.equal(iso(tradingDaysBefore(d("2024-07-08"), 1)), "2024-07-08");
  assert.equal(iso(tradingDaysBefore(d("2024-07-08"), 3)), "2024-07-03");
  assert.equal(iso(tradingDaysBefore(d("2024-07-07"), 1)), "2024-07-05");
  const start = tradingDaysBefore(d("2023-12-29"), 250);
  assert.equal(countTradingDays(start, d("2023-12-29")), 250);
});
