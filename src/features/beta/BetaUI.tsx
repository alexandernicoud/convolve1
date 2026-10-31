import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Info, MessageSquare, X } from "lucide-react";
import { useCreditsStore } from "@/state/creditsStore";
import {
  MARKET_DATA_MESSAGE,
  betaLimitLines,
  betaToolForPath,
  usesMarketData,
  type BetaLimits,
  type FoundingOffer,
} from "@/features/beta/model";

/** Beta limits and founding offer from /api/plans (loaded once, shared with the credits store). */
export function useBetaInfo(): { beta: BetaLimits | null; offer: FoundingOffer | null; loaded: boolean } {
  const loaded = useCreditsStore((s) => s.loaded);
  const beta = useCreditsStore((s) => s.beta);
  const offer = useCreditsStore((s) => s.foundingOffer);
  useEffect(() => {
    if (!useCreditsStore.getState().loaded) void useCreditsStore.getState().refresh();
  }, []);
  return { beta, offer, loaded };
}

export const BETA_LIMITS_HREF = "/products#beta-limits";

const tiersText = "Starter, Research or Professional";

/** One sentence about the founding member offer; never states a deadline that is not configured. */
export function foundingOfferText(offer: FoundingOffer): string {
  const until = offer.ends_at
    ? ` Accounts created before ${new Date(offer.ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} qualify.`
    : "";
  return `Founding beta members get ${offer.percent}% off their first month of ${tiersText} when paid subscriptions launch. One-time, on the first invoice only; nothing is charged automatically.${until}`;
}

/** Dashboard: the beta is free, limits apply, nothing is charged. */
export function BetaBanner() {
  const { beta, offer } = useBetaInfo();
  if (!beta) return null;
  return (
    <section
      aria-label="Public beta"
      className="mx-2.5 mb-2 shrink-0 rounded-xl border border-white/[0.1] bg-white/[0.025] px-4 py-3 sm:px-5"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold text-white">Convolve Public Beta — Free Access</h2>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-white/60">
            Convolve is currently free while we develop and improve the platform with our early users. To keep computation
            available to everyone, temporary limits apply to experiment sizes and daily usage.
          </p>
          <p className="mt-1 text-[12.5px] text-white/80">No subscription required. No automatic charges.</p>
          {offer?.open && <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-[#a6ecc8]/80">{foundingOfferText(offer)}</p>}
        </div>
        <Link
          to={BETA_LIMITS_HREF}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          See beta limits
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/** Public pages (home, sign-up): the beta is free; the founding offer when its window is open. */
export function BetaOfferNote({ className = "" }: { className?: string }) {
  const { beta, offer } = useBetaInfo();
  if (!beta && !offer?.open) return null;
  return (
    <div className={`text-[13px] leading-relaxed text-white/55 ${className}`}>
      {beta && (
        <p>
          <span className="text-white/85">Free during the public beta.</span> No subscription required. No automatic charges.{" "}
          <Link to={BETA_LIMITS_HREF} className="underline underline-offset-2 hover:text-white/80">
            Beta limits
          </Link>
        </p>
      )}
      {offer?.open && <p className="mt-1.5 text-[#a6ecc8]/80">{foundingOfferText(offer)}</p>}
    </div>
  );
}

/** Tool pages: the limits that apply to this tool, from the server. */
export function BetaLimitsNote() {
  const { pathname } = useLocation();
  const { beta } = useBetaInfo();
  const marketData = useCreditsStore((s) => s.marketData);
  const marketDataAccess = useCreditsStore((s) => s.marketDataAccess);
  const tool = betaToolForPath(pathname);
  if (!tool) return null;
  if (marketData?.access === "cohort" && !marketDataAccess && usesMarketData(tool)) {
    return (
      <p className="mb-3 flex max-w-3xl items-start gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-[12px] leading-relaxed text-amber-100/80">
        <Info className="mt-[2px] h-3.5 w-3.5 shrink-0 text-amber-200/70" aria-hidden />
        <span>
          {MARKET_DATA_MESSAGE}{" "}
          <Link to="/contact" className="underline underline-offset-2 hover:text-white">
            Ask to join the test group
          </Link>
        </span>
      </p>
    );
  }
  if (!beta) return null;
  const lines = betaLimitLines(beta, tool);
  if (!lines.length) return null;
  return (
    <p className="mb-3 flex max-w-3xl items-start gap-1.5 text-[11px] leading-relaxed text-white/50">
      <Info className="mt-[2px] h-3 w-3 shrink-0 text-white/40" aria-hidden />
      <span>
        Free beta limits: {lines.join(" · ")}.{" "}
        <Link to={BETA_LIMITS_HREF} className="underline underline-offset-2 hover:text-white/80">
          All limits
        </Link>
      </span>
    </p>
  );
}

/** Public pages: the full list of beta limits (Products page, `#beta-limits`). */
export function BetaLimitsList({ beta }: { beta: BetaLimits }) {
  const rows: [string, string[]][] = [
    ["Chart generator", betaLimitLines(beta, "generator")],
    ["Labeling optimizer", betaLimitLines(beta, "optimizer")],
    ["Trainer", betaLimitLines(beta, "trainer")],
    ["Backtester and analysis", betaLimitLines(beta, "backtester")],
  ];
  return (
    <dl className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.09] text-[14px]">
      {rows.map(([label, lines]) => (
        <div key={label} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[13rem_1fr]">
          <dt className="text-white/85">{label}</dt>
          <dd className="text-white/55">{lines.join(" · ") || "No size limit"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A run start refused: beta limit (422), duplicate (409), daily or queue limit (429), busy (503), questionnaire (403). */
export function RunRefusedModal() {
  const navigate = useNavigate();
  const refusal = useCreditsStore((s) => s.refusal);
  const close = useCreditsStore((s) => s.closeRefusal);
  if (!refusal) return null;
  const go = (to: string) => {
    close();
    navigate(to);
  };
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-refused-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0c] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04]">
            {refusal.feedback ? <MessageSquare className="h-5 w-5 text-white/70" /> : <Info className="h-5 w-5 text-white/70" />}
          </span>
          <h2 id="run-refused-title" className="text-lg font-semibold text-white">
            {refusal.title}
          </h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-white/70">{refusal.message}</p>
        {refusal.feedback ? (
          <p className="mt-2 text-sm text-white/85">Complete this short questionnaire and earn 5 credits for the full launch.</p>
        ) : (
          <p className="mt-2 text-xs text-white/45">Nothing new was started. Your saved results are not affected.</p>
        )}
        {refusal.feedback && (
          <p className="mt-2 text-xs text-white/45">
            Your results, downloads and account settings stay available. Six short questions; criticism is welcome.
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {refusal.feedback ? (
            <button
              type="button"
              autoFocus
              onClick={() => go("/dashboard/feedback")}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              Open the questionnaire
            </button>
          ) : (
            <button
              type="button"
              autoFocus
              onClick={() => go(refusal.contact ? "/contact" : refusal.runId ? "/tools/run-log" : BETA_LIMITS_HREF)}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              {refusal.contact ? "Contact us" : refusal.runId ? "View runs" : "See beta limits"}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
