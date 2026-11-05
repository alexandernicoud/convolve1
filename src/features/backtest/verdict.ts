import type { IncrementalValue, PairedComparison } from "./api";

export type PairedReading = {
  key: "always_eligible" | "passive";
  against: string;
  direction: "below" | "above" | "unclear";
  diff: number | null;
  ci: [number, number] | null;
};

const AGAINST: Record<PairedReading["key"], string> = {
  always_eligible: "trading every eligible chart",
  passive: "the exposure-matched passive mix",
};

function read(key: PairedReading["key"], p?: PairedComparison): PairedReading | null {
  if (!p) return null;
  const ci = p.ci95_annualized;
  const direction = !ci ? "unclear" : ci[1] < 0 ? "below" : ci[0] > 0 ? "above" : "unclear";
  return { key, against: AGAINST[key], direction, diff: p.mean_diff_annualized, ci };
}

/** What the paired bootstrap intervals establish, independent of the (possibly capped) verdict. */
export function pairedReadings(inc: IncrementalValue): PairedReading[] {
  return [read("always_eligible", inc.paired?.always_eligible), read("passive", inc.paired?.passive)].filter((r): r is PairedReading => r !== null);
}

/**
 * One headline sentence. Underperformance whose 95% interval lies entirely below zero is stated
 * plainly; outperformance outside an independent test is reported as not yet established.
 */
export function pairedHeadline(inc: IncrementalValue, independent: boolean): { tone: "negative" | "positive" | "neutral"; text: string } | null {
  const rs = pairedReadings(inc);
  if (!rs.length) return null;
  const below = rs.filter((r) => r.direction === "below");
  if (below.length) {
    return {
      tone: "negative",
      text: `The CNN strategy underperformed ${below.map((r) => r.against).join(" and ")}: the 95% interval of the difference lies entirely below zero.`,
    };
  }
  const above = rs.filter((r) => r.direction === "above");
  if (above.length) {
    return independent
      ? { tone: "positive", text: `The CNN strategy outperformed ${above.map((r) => r.against).join(" and ")}, with the 95% interval above zero.` }
      : {
          tone: "neutral",
          text: `The CNN strategy came out ahead of ${above.map((r) => r.against).join(" and ")}, but this run is not an independent test, so that is not evidence of an edge.`,
        };
  }
  return { tone: "neutral", text: "Neither comparison is established: every interval of the difference crosses zero, so this data cannot tell the strategies apart." };
}
