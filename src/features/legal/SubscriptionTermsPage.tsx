import { Link } from "react-router-dom";
import { Fact, LegalLayout, List, Placeholder, Section } from "./LegalLayout";
import { OPERATOR, OPERATOR_LINE, TERMS_VERSION } from "./meta";

const SECTIONS = [
  { id: "scope", title: "Scope" },
  { id: "plans", title: "Plans" },
  { id: "billing", title: "Price, payment and renewal" },
  { id: "credits", title: "Credits" },
  { id: "packs", title: "Extra credits" },
  { id: "limits", title: "Features, limits and fair use" },
  { id: "changes", title: "Plan changes" },
  { id: "cancel", title: "Cancellation and end of a subscription" },
  { id: "failed", title: "Failed payments and disputes" },
  { id: "tax", title: "Taxes and availability" },
  { id: "changes-terms", title: "Changes to these terms" },
];

export default function SubscriptionTermsPage() {
  return (
    <LegalLayout
      title="Subscription and Credit Terms"
      sections={SECTIONS}
      intro={
        <p>
          These terms apply to paid subscriptions and credit packs for Convolve. They supplement the{" "}
          <Link to="/terms">Terms of Service</Link>. Version {TERMS_VERSION}.{" "}
          <Placeholder>[Draft pending legal review. Paid plans are not on sale until this notice is removed.]</Placeholder>
        </p>
      }
    >
      <Section id="scope" title="1. Scope">
        <p>
          Your contract for a subscription or credit pack is with {OPERATOR_LINE}. Payments are processed by Stripe on our behalf; your card details
          are entered on Stripe&apos;s page and never reach our servers.{" "}
          <Placeholder>[Confirm the Stripe contracting entity shown in the live Stripe account before launch.]</Placeholder>
        </p>
      </Section>

      <Section id="plans" title="2. Plans">
        <p>
          Each plan includes a number of credits per monthly billing period, a set of features, and usage limits such as a
          number of backtests per period and of paper deployments active at the same time. The current plans, prices and
          what each includes are shown on the <Link to="/products#pricing">pricing section of the Products page</Link> and at checkout; what is shown when you
          buy is what you get for that period.
        </p>
      </Section>

      <Section id="billing" title="3. Price, payment and renewal">
        <List
          items={[
            "Subscriptions are billed in advance for one month at a time and renew automatically every month at the then-current price until you cancel.",
            "Before you subscribe we show the price, the billing interval, that the subscription renews automatically and how to cancel. Your agreement is recorded with the checkout.",
            "We will tell you about any price increase in advance. It applies from the next billing period after the notice, and you can cancel before it takes effect.",
            "Prices are shown in the currency displayed at checkout. Your bank or card issuer may charge currency conversion fees.",
            "Discount codes we issue are entered on the payment page. Their terms (amount, duration, eligibility) are shown there; refunds are calculated from the amount actually paid.",
          ]}
        />
      </Section>

      <Section id="credits" title="4. Credits">
        <List
          items={[
            "Credits measure computation. Each research run shows its price in credits before it starts; the price is calculated on our servers from the run's configuration.",
            "A run is charged when our server accepts it. A run that fails or is interrupted is refunded in credits automatically; a run cancelled before it starts is refunded too.",
            "Monthly credits included in a plan are added at the start of each billing period and expire at its end. Unused monthly credits are not carried over and are not refundable.",
            "Credits are personal to your account. They cannot be transferred, sold, traded or exchanged for money, except through a refund of purchased credits under the Refund and Cancellation Policy.",
            "Credits are not a deposit, e-money or a stored-value instrument and earn no interest.",
            "Promotional credits (the feedback questionnaire, citation and ambassador bonuses) are free. They have no cash value, are never refunded and are not purchased credits. They are used before purchased credits.",
            "A complimentary plan period (an ambassador free month, or the complimentary access offered to accounts that existed before paid plans started) is free, does not renew and needs no cancellation. Its monthly credits work like a paid plan's. You can start a paid plan at any time during it.",
          ]}
        />
      </Section>

      <Section id="packs" title="5. Extra credits">
        <List
          items={[
            "With an active subscription you can buy credit packs. Their sizes and prices are shown in your account before purchase.",
            "Purchased credits are used only after the current period's monthly credits are used up. They carry over from month to month and do not expire while your account exists.",
            "Purchased credits pay for computation only. They do not unlock features of a higher plan and do not raise backtest, deployment or other usage limits.",
            "After a subscription ends, purchased credits remain on your account and can be used again when you resubscribe, or refunded as described in the Refund and Cancellation Policy.",
          ]}
        />
      </Section>

      <Section id="limits" title="6. Features, limits and fair use">
        <p>
          Plan limits are enforced by our servers. We may apply technical limits that protect the service, such as the
          number of training jobs that can run at once or the maximum size of a dataset; they are shown in the workspace.
          Plans are for one person&apos;s own research and may not be shared, resold or used to provide services to others.
        </p>
      </Section>

      <Section id="changes" title="7. Plan changes">
        <List
          items={[
            "Upgrading takes effect immediately. The additional monthly credits of the higher plan for the rest of the current period are added at once, and the price difference is charged pro rata by the payment provider.",
            "Downgrading takes effect at the next renewal. You keep the current plan's features and limits until then.",
            "Content created with features of a higher plan stays available to view after a downgrade.",
          ]}
        />
      </Section>

      <Section id="cancel" title="8. Cancellation and end of a subscription">
        <p>
          You can cancel at any time in <Link to="/account?tab=plan">Account, Plan &amp; Billing</Link>. No reason, email or
          call is required, and there is no survey or retention step. Cancelling stops renewal; you keep access until the
          end of the period you have paid for, and a paid period is never ended early because you cancelled.
        </p>
        <p>
          <strong>Cancel anytime and get a 50% refund of unused purchased credits. No questions asked!</strong> The refund is
          50 % of the amount you originally paid for the purchased top-up credits you have not used. Credits included in a
          subscription and promotional credits are not refundable. Your mandatory consumer rights are not affected. Details
          are in the <Link to="/refunds">Refund and Cancellation Policy</Link>.
        </p>
        <p>
          When a subscription ends, your account stays open with read-only access. Your models, datasets, runs and bots are
          kept and remain visible; research tools and scheduled paper-trading bots stop until you subscribe again. Nothing
          is deleted because a subscription ended.
        </p>
      </Section>

      <Section id="failed" title="9. Failed payments and disputes">
        <p>
          If a renewal payment fails, we and the payment provider may retry it, and we will tell you. Access continues until
          the end of the period already paid for. If a payment is disputed or charged back, or refunded in full outside the
          self-service refund, the unused credits it paid for are withdrawn and further refunds of that payment are
          suspended until the dispute is resolved. Ambassador rewards earned through that payment are withdrawn as far as they
          are unused.
        </p>
      </Section>

      <Section id="tax" title="10. Taxes and availability">
        <p>
          Prices include or exclude taxes as shown at checkout.{" "}
          <Placeholder>[VAT registration not yet confirmed; no VAT number is shown until it is. EU VAT on digital services to consumers may be due from the first sale (OSS registration); Swiss VAT applies above the registration threshold. Tax handling to be confirmed before launch.]</Placeholder>
        </p>
        <p>
          Paid plans are not offered to residents of the United States or its territories at this time. Checkout asks for
          your billing address, and our servers check the country you declare, your billing address and the country that
          issued your card. A purchase from an excluded country is refunded in full, any subscription it started is ended
          immediately, and no credits or plan features are granted. Your free account stays available. We may restrict
          the countries in which paid plans are available; this is shown at checkout.
        </p>
      </Section>

      <Section id="changes-terms" title="11. Changes to these terms">
        <p>
          We will notify you of material changes in advance. Changes apply from your next billing period; you can cancel
          before they take effect. Questions: <Fact value={OPERATOR.email} />.
        </p>
      </Section>
    </LegalLayout>
  );
}
