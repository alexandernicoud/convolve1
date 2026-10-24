import { Link } from "react-router-dom";
import { describePlanCredits, formatPrice, type CreditSummary, type PlanCatalogue } from "@/features/credits/model";
import type { AccountProfile, Loadable } from "./data";
import { Card, Notice, Row, formatDate } from "./ui";

export function PlanTab({
  profile,
  plans,
  credits,
}: {
  profile: Loadable<AccountProfile>;
  plans: Loadable<PlanCatalogue>;
  credits: Loadable<CreditSummary>;
}) {
  const state = profile.data?.plan ?? credits.data?.plan;
  const plan = plans.data?.plans.find((p) => p.id === state?.plan_id);
  const others = plans.data?.plans.filter((p) => p.id !== state?.plan_id) ?? [];

  return (
    <div className="space-y-6">
      <Card
        title="Current plan"
        action={
          <Link to="/pricing" className="shrink-0 text-sm text-white/55 underline-offset-4 hover:text-white hover:underline">
            Compare plans
          </Link>
        }
      >
        {(profile.error || plans.error) && <Notice kind="error">{profile.error ?? plans.error}</Notice>}
        {state && (
          <>
            <Row label="Plan">{state.name}</Row>
            <Row label="Status">
              <span className="capitalize">{state.status}</span>
            </Row>
            <Row label="Price">{formatPrice(plan?.price ?? null) ?? "—"}</Row>
            <Row label="Credit allocation">{describePlanCredits(state.credits) ?? "—"}</Row>
            {state.current_period_end && <Row label="Next allocation">{formatDate(state.current_period_end)}</Row>}
          </>
        )}
      </Card>

      <Card title="Billing" description="Payment is not available yet.">
        <p className="text-sm leading-relaxed text-white/60">
          Convolve does not process payments and stores no payment details. Paid plans will be announced on the pricing page
          before anything can be bought. If you need more credits now,{" "}
          <Link to="/contact" className="text-white underline underline-offset-2">
            contact us
          </Link>
          .
        </p>
      </Card>

      {others.length > 0 && (
        <Card title="Other plans">
          <ul className="divide-y divide-white/[0.06]">
            {others.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-white/85">{p.name}</div>
                  <div className="text-xs text-white/45">{p.summary}</div>
                </div>
                <span className="shrink-0 text-xs text-white/45">
                  {formatPrice(p.price) ?? (p.availability === "contact" ? "Contact us" : "Coming soon")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
