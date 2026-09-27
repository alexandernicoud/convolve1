/** Preset chart history windows — maps to backend `timespanUnit` + `timespanCount` (see generatorDates shiftCalendarByTimespan). */
export const TIMESPAN_PRESETS: { key: string; label: string; unit: string; count: number }[] = [
  { key: "days:1", label: "1 day", unit: "days", count: 1 },
  { key: "days:5", label: "5 days", unit: "days", count: 5 },
  { key: "days:10", label: "10 days", unit: "days", count: 10 },
  { key: "days:20", label: "20 days", unit: "days", count: 20 },
  { key: "weeks:1", label: "1 week", unit: "weeks", count: 1 },
  { key: "weeks:2", label: "2 weeks", unit: "weeks", count: 2 },
  { key: "weeks:4", label: "4 weeks", unit: "weeks", count: 4 },
  { key: "weeks:8", label: "8 weeks", unit: "weeks", count: 8 },
  { key: "months:1", label: "1 month", unit: "months", count: 1 },
  { key: "months:3", label: "3 months", unit: "months", count: 3 },
  { key: "months:6", label: "6 months", unit: "months", count: 6 },
  { key: "months:12", label: "12 months", unit: "months", count: 12 },
  { key: "months:24", label: "24 months", unit: "months", count: 24 },
];
