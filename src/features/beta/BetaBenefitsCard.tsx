import { Link } from "react-router-dom";
import { useApi } from "@/features/account/data";
import { Card, Row, formatDate } from "@/features/account/ui";
import type { FeedbackStatus } from "@/features/feedback/model";
import { BETA_LIMITS_HREF } from "@/features/beta/BetaUI";
import type { FoundingDiscountState } from "@/features/beta/model";

const STATUS_TEXT: Record<FoundingDiscountState["status"], string> = {
  available: "Reserved for your account",
  redeemed: "Used",
  not_eligible: "Not available for this account",
};

/** Account, Plan: founding member offer and the questionnaire bonus, as the server records them. */
export function BetaBenefitsCard({ freeBeta }: { freeBeta: boolean }) {
  const founding = useApi<FoundingDiscountState>("/api/rewards/founding-discount");
  const feedback = useApi<FeedbackStatus>("/api/feedback");
  const f = founding.data;
  const reward = feedback.data?.reward;
  if (!freeBeta && (!f || f.status === "not_eligible") && !reward) return null;
  return (
    <Card
      title={freeBeta ? "Free public beta" : "Beta benefits"}
      description={
        freeBeta
          ? "Convolve is free during the public beta. No subscription required. No automatic charges."
          : undefined
      }
      action={
        freeBeta ? (
          <Link to={BETA_LIMITS_HREF} className="shrink-0 text-sm text-white/55 underline-offset-4 hover:text-white hover:underline">
            Beta limits
          </Link>
        ) : undefined
      }
    >
      {f && f.status !== "not_eligible" && (
        <Row label={`Founding member: ${f.percent}% off the first month`}>
          {STATUS_TEXT[f.status]}
          {f.redeemed_at ? ` · ${formatDate(f.redeemed_at)}` : ""}
        </Row>
      )}
      {f?.status === "available" && (
        <p className="pb-3 text-xs leading-relaxed text-white/45">
          Applied automatically at checkout to the first invoice of Starter, Research or Professional once paid subscriptions
          launch. One-time and tied to this account; it cannot be combined with other discount codes and does not apply to
          credit packs. Nothing is charged unless you choose a plan.
        </p>
      )}
      <Row label="Feedback questionnaire">
        {reward ? (
          <>
            {reward.credits} credits earned{reward.usable_now ? "" : ", saved for the full launch"}
          </>
        ) : feedback.data?.completed ? (
          "Completed"
        ) : (
          <Link to="/dashboard/feedback" className="text-white underline underline-offset-2">
            Earn {feedback.data?.bonus_credits ?? 5} credits
          </Link>
        )}
      </Row>
    </Card>
  );
}
