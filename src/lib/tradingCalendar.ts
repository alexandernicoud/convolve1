/**
 * NYSE trading days (weekends, regular holidays and known unscheduled closures). Used only when
 * market data has not loaded; estimates from real bars come from the backend.
 */

const UNSCHEDULED_CLOSURES = new Set([
  "2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14",
  "2004-06-11", "2007-01-02", "2012-10-29", "2012-10-30", "2018-12-05", "2025-01-09",
]);

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = new Date(y, m, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + 7 * (n - 1);
}

function lastWeekday(y: number, m: number, weekday: number): number {
  const lastDay = new Date(y, m + 1, 0).getDate();
  const last = new Date(y, m, lastDay).getDay();
  return lastDay - ((last - weekday + 7) % 7);
}

/** Gregorian Easter Sunday (anonymous algorithm). */
function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month, day);
}

/** Saturday holidays move to Friday, Sunday holidays to Monday. */
function observed(y: number, m: number, d: number): string {
  const wd = new Date(y, m, d).getDay();
  if (wd === 6) {
    const x = new Date(y, m, d - 1);
    return key(x.getFullYear(), x.getMonth(), x.getDate());
  }
  if (wd === 0) return key(y, m, d + 1);
  return key(y, m, d);
}

const cache = new Map<number, Set<string>>();

export function nyseHolidays(y: number): Set<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const s = new Set<string>();
  // New Year's Day: a Saturday holiday is not moved back into the previous year.
  const ny = new Date(y, 0, 1).getDay();
  if (ny !== 6) s.add(ny === 0 ? key(y, 0, 2) : key(y, 0, 1));
  if (y >= 1998) s.add(key(y, 0, nthWeekday(y, 0, 1, 3))); // Martin Luther King Jr. Day
  s.add(key(y, 1, nthWeekday(y, 1, 1, 3))); // Washington's Birthday
  const gf = easter(y);
  gf.setDate(gf.getDate() - 2);
  s.add(key(gf.getFullYear(), gf.getMonth(), gf.getDate())); // Good Friday
  s.add(key(y, 4, lastWeekday(y, 4, 1))); // Memorial Day
  if (y >= 2022) s.add(observed(y, 5, 19)); // Juneteenth
  s.add(observed(y, 6, 4)); // Independence Day
  s.add(key(y, 8, nthWeekday(y, 8, 1, 1))); // Labor Day
  s.add(key(y, 10, nthWeekday(y, 10, 4, 4))); // Thanksgiving
  s.add(observed(y, 11, 25)); // Christmas
  cache.set(y, s);
  return s;
}

export function isTradingDay(d: Date): boolean {
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  const k = key(d.getFullYear(), d.getMonth(), d.getDate());
  return !nyseHolidays(d.getFullYear()).has(k) && !UNSCHEDULED_CLOSURES.has(k);
}

/** Trading days in [start, end], both inclusive. */
export function countTradingDays(start: Date, end: Date): number {
  let n = 0;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= stop) {
    if (isTradingDay(d)) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** The date `n` trading days before `end` (counting `end` itself when it trades). */
export function tradingDaysBefore(end: Date, n: number): Date {
  const d = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let left = Math.max(0, Math.floor(n));
  while (!isTradingDay(d)) d.setDate(d.getDate() - 1);
  while (left > 1) {
    d.setDate(d.getDate() - 1);
    if (isTradingDay(d)) left -= 1;
  }
  return d;
}
