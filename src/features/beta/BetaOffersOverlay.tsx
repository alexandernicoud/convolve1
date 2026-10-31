import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { formatMinor, tierLines, type BillingCatalog, type Tier } from "@/features/billing/model";
import { BetaStrip, foundingOfferText, useBetaInfo } from "./BetaUI";

const seenKey = (userId: string) => `convolve:beta-offers-seen:${userId}`;

export function offersSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markSeen(userId: string): void {
  try {
    window.localStorage.setItem(seenKey(userId), "1");
  } catch {
    /* private mode: shown again next visit */
  }
}

function PlannedTier({ tier, featured }: { tier: Tier; featured: boolean }) {
  return (
    <article
      aria-label={`${tier.name}, planned`}
      className={`relative flex flex-col rounded-2xl border p-5 grayscale ${
        featured ? "border-white/20 bg-white/[0.03]" : "border-white/[0.08] bg-white/[0.012]"
      }`}
    >
      <span className="absolute right-3 top-3 rounded-full border border-white/15 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
        Planned
      </span>
      <div className="opacity-45">
        <h3 className="text-[15px] font-medium text-white">{tier.name}</h3>
        <p className="mt-3 text-[1.7rem] font-extralight leading-none tracking-[-0.03em] text-white">
          {formatMinor(tier.price.amount_minor, tier.price.currency)}
          <span className="ml-1 text-[13px] text-white/50">/ {tier.price.interval ?? "month"}</span>
        </p>
        <p className="mt-2 text-[12px] text-white/55">{tier.monthly_credits.toLocaleString("en-US")} credits every month</p>
        <ul className="mt-4 space-y-1.5 border-t border-white/[0.08] pt-3">
          {tierLines(tier)
            .filter((l) => l.included)
            .slice(0, 4)
            .map((l) => (
              <li key={l.label} className="flex gap-2 text-[12px] leading-snug text-white/70">
                <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {l.label}
              </li>
            ))}
        </ul>
      </div>
    </article>
  );
}

/** First workspace visit during the beta: the planned plans, greyed out, and one way in. */
export function BetaOffersOverlay({ userId, onLaunch }: { userId: string; onLaunch: () => void }) {
  const { offer } = useBetaInfo();
  const [tiers, setTiers] = useState<Tier[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchApi("/api/billing/catalog")
      .then((r) => (r.ok ? (r.json() as Promise<BillingCatalog>) : null))
      .then((c) => live && setTiers(c?.tiers ?? []))
      .catch(() => live && setTiers([]));
    return () => {
      live = false;
    };
  }, []);

  const launch = () => {
    markSeen(userId);
    onLaunch();
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby="offers-title">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative my-auto w-full max-w-4xl rounded-3xl border border-white/12 bg-[#0a0a0a] p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.95)] sm:p-8 motion-safe:animate-fade-in">
        <BetaStrip className="w-fit max-w-full" title={offer?.open ? foundingOfferText(offer) : undefined}>
          <span className="text-white">Free during the public beta</span>
          <span className="text-white/45"> · Nothing can be bought yet · No charges</span>
        </BetaStrip>
        <h2 id="offers-title" className="mt-5 text-[clamp(1.5rem,3.2vw,2.1rem)] font-semibold leading-tight tracking-tight text-white">
          Plans for the full launch
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/55">
          These are the planned prices once the beta ends. Right now every tool is free within fair-use limits.
          {offer?.open ? ` Founding members get ${offer.percent}% off their first paid month.` : ""}
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {tiers === null
            ? [0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)
            : tiers.map((t, i) => <PlannedTier key={t.id} tier={t} featured={tiers.length >= 3 ? i === 1 : i === tiers.length - 1} />)}
        </div>

        <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11.5px] leading-relaxed text-white/35">
            Planned prices in US dollars, subject to change. Paid plans are not yet available in the United States.
          </p>
          <button
            type="button"
            autoFocus
            onClick={launch}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#a6ecc8] px-5 py-3 text-sm font-semibold text-[#04140b] transition hover:bg-[#bdf3d7]"
          >
            Try the beta for free <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
