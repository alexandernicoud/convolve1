import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MotionConfig, motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { describePlanCredits, formatPrice, type Plan, type PlanCatalogue } from "@/features/credits/model";
import { Container, EASE, M2Footer, Reveal } from "@/features/marketing2/ui";

function Label({ num, children }: { num: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">
      <span className="text-white/85">{num}</span>
      <span className="h-px w-8 bg-white/25" />
      {children}
    </div>
  );
}

function Rule() {
  return (
    <motion.div
      aria-hidden
      className="h-px w-full origin-left bg-white/[0.12]"
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 1.2, ease: EASE }}
    />
  );
}

function priceLabel(plan: Plan): string {
  const price = formatPrice(plan.price);
  if (price) return price;
  return plan.availability === "contact" ? "Contact us" : "Coming soon";
}

function PlanAction({ plan }: { plan: Plan }) {
  if (plan.availability === "available") {
    return (
      <Link
        to="/signup"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[14px] font-medium text-[#0a0a0a] transition hover:bg-white/90"
      >
        Start free
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    );
  }
  if (plan.availability === "contact") {
    return (
      <Link
        to="/contact"
        className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-5 py-3 text-[14px] text-white/85 transition hover:bg-white/[0.06]"
      >
        Contact us
      </Link>
    );
  }
  return (
    <span
      aria-disabled="true"
      className="inline-flex w-full cursor-default items-center justify-center rounded-full border border-white/[0.1] px-5 py-3 text-[14px] text-white/40"
    >
      Coming soon
    </span>
  );
}

function PlanCard({ plan, featured }: { plan: Plan; featured: boolean }) {
  const credits = describePlanCredits(plan.credits);
  return (
    <article
      className={`flex h-full flex-col rounded-2xl border p-6 ${
        featured ? "border-white/25 bg-white/[0.04]" : "border-white/[0.09] bg-white/[0.015]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[18px] font-medium text-white">{plan.name}</h3>
        {plan.availability !== "available" && (
          <span className="rounded-full border border-white/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
            {plan.availability === "contact" ? "On request" : "Planned"}
          </span>
        )}
      </div>
      <p className="mt-5 text-[clamp(1.8rem,2.6vw,2.3rem)] font-extralight leading-none tracking-[-0.03em] text-white">
        {priceLabel(plan)}
      </p>
      <p className="mt-3 min-h-[1.25rem] text-[13px] text-white/50">{credits ?? "Allocation to be announced"}</p>
      <p className="mt-5 text-[14.5px] leading-relaxed text-white/65">{plan.summary}</p>
      <ul className="mt-6 flex-1 space-y-2.5 border-t border-white/[0.08] pt-5">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2.5 text-[13.5px] leading-snug text-white/70">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a6ecc8]" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <PlanAction plan={plan} />
      </div>
    </article>
  );
}

function Comparison({ plans }: { plans: Plan[] }) {
  const rows: [string, (p: Plan) => ReactNode][] = [
    ["Price", (p) => priceLabel(p)],
    ["Credits", (p) => describePlanCredits(p.credits) ?? "To be announced"],
    ["Dataset generation, training, analysis, backtesting", () => "Included"],
    ["Paper-trading bots", () => "Included"],
    ["Data export and account deletion", () => "Included"],
  ];
  return (
    <div className="mt-12 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
        <caption className="sr-only">Plan comparison</caption>
        <thead>
          <tr className="border-b border-white/[0.12]">
            <th scope="col" className="py-4 pr-4 font-normal text-white/40" />
            {plans.map((p) => (
              <th key={p.id} scope="col" className="px-4 py-4 font-medium text-white">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cell]) => (
            <tr key={label} className="border-b border-white/[0.06]">
              <th scope="row" className="py-4 pr-4 font-normal text-white/55">
                {label}
              </th>
              {plans.map((p) => (
                <td key={p.id} className="px-4 py-4 text-white/80">
                  {cell(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PricingPage() {
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = "Pricing | convolve.";
    let live = true;
    fetchApi("/api/plans")
      .then((r) => (r.ok ? (r.json() as Promise<PlanCatalogue>) : Promise.reject(new Error(String(r.status)))))
      .then((c) => live && setCatalogue(c))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const plans = catalogue?.plans ?? [];
  const charging = catalogue?.charging_enabled ?? false;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-x-clip bg-[#050506] text-white antialiased">
        <section className="pb-16 pt-36 md:pb-24 md:pt-44">
          <Container>
            <Reveal>
              <Label num="00">Pricing</Label>
              <h1 className="mt-8 max-w-5xl text-[clamp(2.6rem,6vw,5.6rem)] font-extralight leading-[1] tracking-[-0.05em] text-white">
                Pay for the research you run.
                <br />
                <span className="text-white/40">Nothing else.</span>
              </h1>
              <p className="mt-8 max-w-xl text-[16.5px] leading-[1.65] text-white/60">
                Each run of a research tool uses credits. Browsing results, exporting data and running paper bots do not.
                {catalogue &&
                  (charging
                    ? " Paid plans are not available yet."
                    : " During the beta, runs are not charged and paid plans are not available yet.")}
              </p>
            </Reveal>
          </Container>
        </section>

        <section className="pb-20 md:pb-28">
          <Container>
            <Rule />
            <div className="mt-12">
              <Label num="I">Plans</Label>
            </div>
            {failed && (
              <p className="mt-10 text-[15px] text-white/55">
                Plans could not be loaded right now. Please try again later or{" "}
                <Link to="/contact" className="text-white underline underline-offset-4">
                  contact us
                </Link>
                .
              </p>
            )}
            {!catalogue && !failed && <div className="mt-10 h-72 animate-pulse rounded-2xl bg-white/[0.02]" aria-hidden />}
            {plans.length > 0 && (
              <>
                <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {plans.map((p) => (
                    <Reveal key={p.id}>
                      <PlanCard plan={p} featured={p.id === catalogue?.default_plan_id} />
                    </Reveal>
                  ))}
                </div>
                <p className="mt-6 text-[13px] text-white/40">
                  Plans marked planned or on request are not on sale. Their prices and allocations have not been set; nothing
                  here is an offer.
                </p>
              </>
            )}
          </Container>
        </section>

        {plans.length > 0 && (
          <section className="pb-20 md:pb-28">
            <Container>
              <Rule />
              <div className="mt-12">
                <Label num="II">Compare</Label>
              </div>
              <Comparison plans={plans} />
            </Container>
          </section>
        )}

        {catalogue && (
          <section className="pb-28 md:pb-40">
            <Container>
              <Rule />
              <div className="mt-12 grid gap-12 md:grid-cols-12">
                <Reveal className="md:col-span-4">
                  <Label num="III">Credits</Label>
                  <h2 className="mt-7 text-[clamp(2rem,3.6vw,3.3rem)] font-extralight leading-[1.06] tracking-[-0.04em] text-white">
                    How credits work.
                  </h2>
                </Reveal>
                <Reveal className="md:col-span-7 md:col-start-6" delay={0.06}>
                  <ul className="space-y-5 text-[15.5px] leading-relaxed text-white/60">
                    <li>A run is charged once, when the server accepts it. The price is set by Convolve, never by your browser.</li>
                    <li>A run that fails or is interrupted is refunded automatically. A run cancelled before it starts is refunded too.</li>
                    <li>If your balance does not cover a run, it is not started and nothing is charged.</li>
                    <li>Your balance and every charge and refund are listed under Account, Usage &amp; credits.</li>
                  </ul>
                  <table className="mt-10 w-full border-collapse text-[14px]">
                    <caption className="sr-only">Credits per run</caption>
                    <thead>
                      <tr className="border-b border-white/[0.12] text-left">
                        <th scope="col" className="py-3 font-normal text-white/40">
                          Run
                        </th>
                        <th scope="col" className="py-3 text-right font-normal text-white/40">
                          Credits
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {catalogue.run_costs.map((c) => (
                        <tr key={c.tool} className="border-b border-white/[0.06]">
                          <td className="py-3 text-white/80">{c.label}</td>
                          <td className="py-3 text-right font-mono tabular-nums text-white">{c.credits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

        <M2Footer />
      </div>
    </MotionConfig>
  );
}
