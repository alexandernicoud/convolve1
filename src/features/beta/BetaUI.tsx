import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Gift, Info, MessageSquare, X } from "lucide-react";
import { useCreditsStore } from "@/state/creditsStore";
import { useIsAdmin } from "@/features/admin/useIsAdmin";
import {
  EARN_HREF,
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

type StripTone = "beta" | "warn";

/** The one compact banner style used for every beta notice: a pill, one line, one link. */
export function BetaStrip({
  tone = "beta",
  pill = "Beta",
  children,
  to = BETA_LIMITS_HREF,
  linkLabel = "Limits",
  title,
  className = "",
}: {
  tone?: StripTone;
  pill?: string;
  children: React.ReactNode;
  to?: string;
  linkLabel?: string;
  title?: string;
  className?: string;
}) {
  const warn = tone === "warn";
  return (
    <div
      role="note"
      title={title}
      className={`flex min-w-0 items-center gap-2.5 rounded-full border py-1 pl-1 pr-3 text-[12px] ${
        warn ? "border-amber-300/25 bg-amber-300/[0.06] text-amber-50/85" : "border-white/[0.12] bg-white/[0.04] text-white/75"
      } ${className}`}
    >
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
          warn ? "bg-amber-300/90 text-[#1a1200]" : "bg-[#a6ecc8] text-[#04140b]"
        }`}
      >
        {pill}
      </span>
      <span className="min-w-0 truncate">{children}</span>
      <Link
        to={to}
        className={`ml-auto inline-flex shrink-0 items-center gap-1 font-medium transition ${
          warn ? "text-amber-100 hover:text-white" : "text-white/90 hover:text-white"
        }`}
      >
        {linkLabel}
        <ArrowRight className="h-3 w-3" aria-hidden />
      </Link>
    </div>
  );
}

function shortOffer(offer: FoundingOffer | null): string | null {
  return offer?.open ? `Founding members: ${offer.percent}% off the first paid month at launch.` : null;
}

/** Dashboard: free beta, nothing charged, founding offer. */
export function BetaBanner() {
  const { beta, offer } = useBetaInfo();
  if (!beta) return null;
  return (
    <div className="mx-2.5 mb-2 flex shrink-0 flex-wrap gap-2">
      <BetaStrip title={offer?.open ? foundingOfferText(offer) : undefined} className="w-full sm:w-fit sm:max-w-full">
        <span className="text-white">Free during the public beta</span>
        <span className="text-white/45"> · No charges · Fair-use limits</span>
        {shortOffer(offer) && <span className="hidden text-[#a6ecc8] md:inline"> · {shortOffer(offer)}</span>}
      </BetaStrip>
      <BetaStrip pill="Earn" to={EARN_HREF} linkLabel="Earn credits" className="w-full sm:w-fit sm:max-w-full">
        <span className="text-white">Beta users can be ambassadors too</span>
        <span className="text-white/45"> · Invite friends, answer the questionnaire, cite Convolve</span>
      </BetaStrip>
    </div>
  );
}

/** Public pages (home, sign-up): the beta is free; the founding offer when its window is open. */
export function BetaOfferNote({ className = "" }: { className?: string }) {
  const { beta, offer } = useBetaInfo();
  if (!beta && !offer?.open) return null;
  return (
    <BetaStrip title={offer?.open ? foundingOfferText(offer) : undefined} className={`w-fit max-w-full ${className}`}>
      <span className="text-white">Free public beta</span>
      <span className="text-white/45"> · No charges</span>
    </BetaStrip>
  );
}

/** Whether the questionnaire must be answered before the next experiment (checked on each tool page). */
function useFeedbackDue(enabled: boolean): boolean {
  const { pathname } = useLocation();
  const refusal = useCreditsStore((s) => s.refusal);
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchApi("/api/feedback")
      .then((r) => (r.ok ? (r.json() as Promise<{ gate?: { required?: boolean } }>) : null))
      .then((s) => live && setDue(s?.gate?.required === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled, pathname, refusal]);
  return enabled && due;
}

/** Tool pages: market-data access or the limits for this tool, as one strip. */
export function BetaLimitsNote() {
  const { pathname } = useLocation();
  const { beta } = useBetaInfo();
  const marketData = useCreditsStore((s) => s.marketData);
  const marketDataAccess = useCreditsStore((s) => s.marketDataAccess);
  const tool = betaToolForPath(pathname);
  const feedbackDue = useFeedbackDue(tool != null && tool !== "analysis");
  const admin = useIsAdmin();
  if (!tool) return null;
  if (admin) {
    return (
      <BetaStrip pill="Admin" to="/dashboard/admin" linkLabel="Console" className="mb-3 w-fit max-w-full">
        Admin account: no beta limits, queue caps or questionnaire.
      </BetaStrip>
    );
  }
  if (feedbackDue) {
    return (
      <BetaStrip pill="Feedback" to="/dashboard/feedback" linkLabel="Answer (3 min)" className="mb-3 w-fit max-w-full">
        New experiments resume after a three-minute questionnaire. +5 bonus credits.
      </BetaStrip>
    );
  }
  if (marketData?.access === "cohort" && !marketDataAccess && usesMarketData(tool)) {
    return (
      <BetaStrip tone="warn" pill="Invite only" to="/contact" linkLabel="Request access" title={MARKET_DATA_MESSAGE} className="mb-3 w-fit max-w-full">
        Market-data downloads are limited to a test group while licensing is finalised.
      </BetaStrip>
    );
  }
  if (!beta) return null;
  const lines = betaLimitLines(beta, tool);
  if (!lines.length) return null;
  return (
    <BetaStrip className="mb-3 w-fit max-w-full" title={lines.join(" · ")}>
      {lines.join(" · ")}
    </BetaStrip>
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
          <p className="mt-2 text-xs text-white/45">Criticism is welcome. You can also open it later from the Feedback button in the top bar.</p>
        ) : (
          <p className="mt-2 text-xs text-white/45">Nothing new was started. Your saved results are not affected.</p>
        )}
        {refusal.earn && (
          <button
            type="button"
            onClick={() => go(EARN_HREF)}
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-[#a6ecc8]/25 bg-[#a6ecc8]/[0.06] p-3 text-left transition hover:bg-[#a6ecc8]/[0.1]"
          >
            <Gift className="h-5 w-5 shrink-0 text-[#a6ecc8]" aria-hidden />
            <span className="text-[13px] leading-snug text-white/80">
              <span className="font-medium text-white">Earn bonus credits while you wait.</span> Invite friends as an ambassador, cite
              Convolve or answer the questionnaire. Credits are saved for the full launch.
            </span>
          </button>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {refusal.feedback ? (
            <button
              type="button"
              autoFocus
              onClick={() => go("/dashboard/feedback")}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              Answer now (3 min, +5 credits)
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
            {refusal.feedback ? "Not now" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
