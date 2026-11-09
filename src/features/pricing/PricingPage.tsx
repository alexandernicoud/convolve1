import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useCreditsStore } from "@/state/creditsStore";
import { Bone, LoadFailed, LoadingRegion } from "@/components/skeleton/Skeleton";
import type { PlanCatalogue } from "@/features/credits/model";
import {
  REFUND_CLARIFIER,
  REFUND_HEADLINE,
  formatMinor,
  planPath,
  signupForPlan,
  tierLines,
  type BillingCatalog,
  type Tier,
} from "@/features/billing/model";
import { Container, Reveal, SectionHead } from "@/features/marketing2/ui";
import { BetaLimitsList, foundingOfferText, useBetaInfo } from "@/features/beta/BetaUI";

function TierAction({ tier, signedIn, beta }: { tier: Tier; signedIn: boolean; beta: boolean }) {
  if (beta) {
    return (
      <p className="w-full rounded-full border border-white/[0.12] px-5 py-3 text-center text-[13px] text-white/50">
        Planned for the full launch
      </p>
    );
  }
  return (
    <Link
      to={signedIn ? planPath(tier.id) : signupForPlan(tier.id)}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full accent-btn convolve-press px-5 py-3 text-[14px] font-medium  transition hover:bg-white/90"
    >
      Start {tier.name}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

function TierCard({ tier, featured, signedIn, beta }: { tier: Tier; featured: boolean; signedIn: boolean; beta: boolean }) {
  return (
    <article
      className={`flex h-full flex-col rounded-2xl border p-6 sm:p-7 ${
        featured ? "border-white/25 bg-white/[0.04]" : "border-white/[0.09] bg-white/[0.015]"
      }`}
    >
      <h3 className="text-[18px] font-medium text-white">{tier.name}</h3>
      <p className="mt-5 text-[clamp(1.8rem,2.6vw,2.3rem)] font-extralight leading-none tracking-[-0.03em] text-white">
        {formatMinor(tier.price.amount_minor, tier.price.currency)}
        <span className="ml-1.5 text-[15px] text-white/45">/ {tier.price.interval ?? "month"}</span>
      </p>
      <p className="mt-3 text-[13px] text-white/50">{tier.monthly_credits.toLocaleString("en-US")} credits every month</p>
      <p className="mt-5 text-[14.5px] leading-relaxed text-white/65">{tier.summary}</p>
      <ul className="mt-6 flex-1 space-y-2.5 border-t border-white/[0.08] pt-5">
        {tierLines(tier).map((l) => (
          <li key={l.label} className={cn("flex gap-2.5 text-[13.5px] leading-snug", l.included ? "text-white/75" : "text-white/30")}>
            {l.included ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a6ecc8]/80" aria-hidden />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/30" aria-hidden />
            )}
            <span>
              {l.label}
              <span className="sr-only">{l.included ? " (included)" : " (not included)"}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <TierAction tier={tier} signedIn={signedIn} beta={beta} />
      </div>
    </article>
  );
}

function PlansSkeleton() {
  return (
    <LoadingRegion label="Loading plans" className="mt-10">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-white/[0.09] p-6 sm:p-7">
            <Bone className="h-4 w-24" />
            <Bone className="mt-6 h-9 w-36" />
            <Bone className="mt-4 h-3 w-40" />
            <div className="mt-8 space-y-3 border-t border-white/[0.08] pt-5">
              {[0, 1, 2, 3, 4].map((r) => (
                <Bone key={r} className="h-3 w-9/12" />
              ))}
            </div>
            <Bone className="mt-8 h-11 w-full rounded-full" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
      <span className="h-px w-6 bg-white/25" aria-hidden />
      {children}
    </div>
  );
}

/** Pricing, shown as the last section of the Products page (`/products#pricing`). */
export function PricingSection({ index = "03" }: { index?: string }) {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [runCosts, setRunCosts] = useState<PlanCatalogue["run_costs"]>([]);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    fetchApi("/api/billing/catalog")
      .then((r) => (r.ok ? (r.json() as Promise<BillingCatalog>) : Promise.reject(new Error(String(r.status)))))
      .then((c) => live && setCatalog(c))
      .catch(() => live && setFailed(true));
    fetchApi("/api/plans")
      .then((r) => (r.ok ? (r.json() as Promise<PlanCatalogue>) : null))
      .then((p) => live && p && setRunCosts(p.run_costs))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tick]);

  const { beta, offer } = useBetaInfo();
  const marketData = useCreditsStore((s) => s.marketData);
  const tiers = catalog?.tiers ?? [];
  const rate = catalog?.refunds.voluntary_rate_bps ?? 5000;

  return (
    <section id="pricing" className="scroll-mt-20 border-t border-white/[0.06] pt-20 lg:pt-28">
      <Container>
        <SectionHead
          index={index}
          label="Pricing"
          title={
            beta ? (
              <>
                Free during the public beta. <span className="text-white/40">Planned pricing below.</span>
              </>
            ) : (
              <>
                Pay for the research you run. <span className="text-white/40">Nothing else.</span>
              </>
            )
          }
          intro={
            beta ? (
              <>
                Creating an account and running experiments are free during the public beta, within the limits below. The plans, credit
                packs and credit rules on this page describe planned pricing for the full launch; nothing can be bought yet.
              </>
            ) : (
              <>
                Creating an account and browsing are free. A subscription includes monthly credits for computation; extra credits can be
                bought when you need more.
              </>
            )
          }
        />
      </Container>

        {beta && (
          <section id="beta-limits" aria-label="Public beta" className="scroll-mt-24 pt-12">
            <Container>
              <div className="grid gap-8 rounded-2xl border border-white/[0.1] bg-white/[0.02] p-6 sm:p-8 md:grid-cols-12">
                <div className="md:col-span-5">
                  <SubHead>Public beta</SubHead>
                  <h3 className="mt-5 text-[clamp(1.4rem,2.2vw,1.9rem)] font-normal leading-[1.15] tracking-[-0.02em] text-white">
                    Free during the public beta.
                  </h3>
                  <p className="mt-4 text-[14.5px] leading-relaxed text-white/60">
                    Convolve is currently free while we develop and improve the platform with our early users. Computational limits
                    exist because Convolve is currently provided at no cost; they apply to experiment sizes and daily usage. No
                    subscription required. No automatic charges.
                  </p>
                  {offer?.open && <p className="mt-4 text-[14px] leading-relaxed text-[#a6ecc8]/85">{foundingOfferText(offer)}</p>}
                  <p className="mt-4 text-[13.5px] leading-relaxed text-white/55">
                    After two successful experiments, a short questionnaire is required once before the next one. Your account,
                    settings and saved work stay available at all times.
                  </p>
                  {marketData?.access === "cohort" && (
                    <p className="mt-4 text-[13.5px] leading-relaxed text-amber-100/75">
                      Tools that download market prices (chart generator, labeling optimizer, backtester and paper bots) are open to
                      an invited test group while market-data licensing is finalised.{" "}
                      <Link to="/contact" className="underline underline-offset-2 hover:text-white">
                        Ask to join
                      </Link>
                    </p>
                  )}
                  <p className="mt-4 text-[13px] leading-relaxed text-white/45">
                    The plans below are planned for the full launch and cannot be bought yet.
                  </p>
                </div>
                <div className="md:col-span-7">
                  <BetaLimitsList beta={beta} />
                </div>
              </div>
            </Container>
          </section>
        )}

        <section aria-label="Plans" className="pb-16 pt-12 md:pb-20">
          <Container>
            {failed && (
              <div className="mt-10 max-w-xl">
                <LoadFailed message="Plans could not be loaded right now." onRetry={() => setTick((t) => t + 1)} />
              </div>
            )}
            {!catalog && !failed && <PlansSkeleton />}
            {tiers.length > 0 && (
              <>
                <div className={cn("mt-10 grid gap-4 md:grid-cols-2", tiers.length >= 3 && "lg:grid-cols-3")}>
                  {tiers.map((t, i) => (
                    <Reveal key={t.id}>
                      <TierCard
                        tier={t}
                        featured={tiers.length >= 3 ? i === 1 : i === tiers.length - 1}
                        signedIn={Boolean(user)}
                        beta={Boolean(beta)}
                      />
                    </Reveal>
                  ))}
                </div>
                <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-white/40">
                  {beta
                    ? "Planned prices in US dollars. Nothing can be bought during the public beta and nothing is charged automatically. Paid plans are not yet available in the United States."
                    : "Prices in US dollars. Subscriptions renew monthly until cancelled; cancel at any time in your account and keep access until the end of the paid month. Have a discount code? Enter it on the payment page. Taxes may apply depending on your country. Paid plans are not yet available in the United States."}
                </p>
              </>
            )}
          </Container>
        </section>

        {catalog && (
          <section aria-label="Extra credits" className="pb-16 md:pb-20">
            <Container>
              <div className="grid gap-12 border-t border-white/[0.08] pt-12 md:grid-cols-12">
                <Reveal className="md:col-span-4">
                  <SubHead>{beta ? "Extra credits · planned" : "Extra credits"}</SubHead>
                  <h3 className="mt-5 text-[clamp(1.6rem,2.4vw,2.2rem)] font-normal leading-[1.1] tracking-[-0.03em] text-white">
                    More computation, same plan.
                  </h3>
                </Reveal>
                <Reveal className="md:col-span-7 md:col-start-6" delay={0.06}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {catalog.packs.map((p) => (
                      <div key={p.id} className="rounded-2xl border border-white/[0.09] px-5 py-5">
                        <div className="text-[15px] text-white">{p.name}</div>
                        <div className="mt-1 text-[13px] text-white/50">{p.credits.toLocaleString()} credits</div>
                        <div className="mt-5 text-[22px] font-extralight tabular-nums text-white">
                          {formatMinor(p.price.amount_minor, p.price.currency)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-8 space-y-3 text-[14.5px] leading-relaxed text-white/60">
                    <li>Extra credits need an active subscription. They pay for computation only; they do not unlock features or raise backtest and deployment limits.</li>
                    <li>Monthly credits are used first. Purchased credits are used after them, carry over between months and do not expire.</li>
                    <li>
                      <span className="text-white/85">{REFUND_HEADLINE(rate)}</span> {REFUND_CLARIFIER(rate)}{" "}
                      <Link to="/refunds" className="text-white/80 underline underline-offset-4 hover:text-white">
                        Refund policy
                      </Link>
                    </li>
                    <li>
                      Credits cannot be transferred, traded or exchanged for money other than through that refund. Promotional credits, such as
                      the feedback bonus, are never refundable.
                    </li>
                    <li>
                      <span className="text-white/85">Earn credits for free:</span> 5 for the feedback questionnaire, 50 for citing Convolve in
                      your website or project, and invite rewards: a free month of Research when a friend starts Research or Professional through
                      your link, or 10 credits when they start Starter. Find them under Account, Earn credits.
                    </li>
                  </ul>
                </Reveal>
              </div>
            </Container>
          </section>
        )}

        {catalog && (
          <section aria-label="How credits work" className="pb-20 lg:pb-28">
            <Container>
              <div className="grid gap-12 border-t border-white/[0.08] pt-12 md:grid-cols-12">
                <Reveal className="md:col-span-4">
                  <SubHead>{beta ? "Credits · planned" : "Credits"}</SubHead>
                  <h3 className="mt-5 text-[clamp(1.6rem,2.4vw,2.2rem)] font-normal leading-[1.1] tracking-[-0.03em] text-white">
                    How credits work.
                  </h3>
                </Reveal>
                <Reveal className="md:col-span-7 md:col-start-6" delay={0.06}>
                  <ul className="space-y-5 text-[15.5px] leading-relaxed text-white/60">
                    <li>A run is charged once, when the server accepts it. The price depends on the run's size and is set by Convolve, never by your browser.</li>
                    <li>A run that fails or is interrupted is refunded automatically. A run cancelled before it starts is refunded too.</li>
                    <li>If your balance does not cover a run, it is not started and nothing is charged.</li>
                    <li>Your balance and every charge and refund are listed under Account, Usage &amp; credits.</li>
                  </ul>
                  {runCosts.length > 0 && (
                    <table className="mt-10 w-full border-collapse text-[14px]">
                      <caption className="sr-only">Credits per run at the default configuration</caption>
                      <thead>
                        <tr className="border-b border-white/[0.12] text-left">
                          <th scope="col" className="py-3 font-normal text-white/40">
                            Run, default settings
                          </th>
                          <th scope="col" className="py-3 text-right font-normal text-white/40">
                            Credits
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {runCosts.map((c) => (
                          <tr key={c.tool} className="border-b border-white/[0.06]">
                            <td className="py-3 text-white/80">{c.label}</td>
                            <td className="py-3 text-right font-mono tabular-nums text-white">{c.credits}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <Link
                    to="/contact"
                    className="group mt-10 inline-flex items-center gap-2 text-[15px] text-white/70 transition-colors hover:text-white"
                  >
                    Questions about plans? Get in touch
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </Reveal>
              </div>
            </Container>
          </section>
        )}
    </section>
  );
}
