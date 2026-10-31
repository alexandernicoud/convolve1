import { Link } from "react-router-dom";
import { Fact, LegalLayout, List, Placeholder, Section, Table } from "./LegalLayout";
import { OPERATOR, OPERATOR_LINE, TERMS_VERSION } from "./meta";

const SECTIONS = [
  { id: "summary", title: "Summary" },
  { id: "cancel", title: "Cancelling a subscription" },
  { id: "refund", title: "Refund of unused purchased credits" },
  { id: "calc", title: "How the refund is calculated" },
  { id: "statutory", title: "Your statutory rights" },
  { id: "excluded", title: "What is not refunded" },
  { id: "process", title: "How refunds are paid" },
  { id: "contact", title: "Questions" },
];

export default function RefundPolicyPage() {
  return (
    <LegalLayout
      title="Refund and Cancellation Policy"
      sections={SECTIONS}
      intro={
        <p>
          How to cancel, and what you get back. Part of the <Link to="/subscription-terms">Subscription and Credit Terms</Link>. Version{" "}
          {TERMS_VERSION}. Refunds are made by {OPERATOR_LINE}.{" "}
          <Placeholder>[Draft pending legal review in Switzerland, the EU, the UK and other target markets. Not to be applied internationally before that review.]</Placeholder>
        </p>
      }
    >
      <Section id="summary" title="1. Summary">
        <p className="text-white/90">
          <strong>Cancel anytime and get a 50% refund of unused purchased credits. No questions asked!</strong>
        </p>
        <p>
          The refund is 50 % of the amount you originally paid for the purchased top-up credits you have not used. Credits
          included in a subscription and promotional credits are not refundable. Your mandatory consumer rights are not affected.
        </p>
        <List
          items={[
            "Cancel any time in your account, entirely self-service. No reason, email, call, survey or retention step is needed.",
            "Cancelling stops renewal. You keep access until the end of the period you have paid for.",
            "The refund is calculated per purchase from the amount actually paid (after any discount) and paid to your original payment method. The exact amount is shown before you confirm.",
            "Where the law gives you more, for example a statutory right of withdrawal, the law applies and nothing is deducted.",
          ]}
        />
      </Section>

      <Section id="cancel" title="2. Cancelling a subscription">
        <p>
          In <Link to="/account?tab=plan">Account, Plan &amp; Billing</Link>, choose <strong>Cancel subscription</strong>.
          Renewal stops immediately and is confirmed on screen{" "}
          <Placeholder>[and by email, once billing emails are set up]</Placeholder>. You keep your plan, its monthly credits and
          your purchased credits until the end of the paid period. Paper-trading bots keep running until then and stop when
          the subscription ends; they are not deleted. You can restart renewal before the period ends.
        </p>
      </Section>

      <Section id="refund" title="3. Refund of unused purchased credits">
        <p>
          Choose <strong>Cancel and refund unused purchased credits</strong>. Before you confirm, the dialog shows, for each
          credit pack: the price paid, how many of its credits are unused, their unused value, the refund percentage, the
          amount refunded and the amount retained. It also explains what happens to your subscription and bots. On
          confirmation we stop renewal and start the refund immediately. Your current paid period is not ended early.
        </p>
        <p>
          This voluntary refund is offered in addition to your statutory rights. We may change or withdraw it for future
          purchases with notice; purchases already made keep the terms that applied when you bought them.
        </p>
      </Section>

      <Section id="calc" title="4. How the refund is calculated">
        <p>For each purchase separately:</p>
        <p className="font-mono text-[14px] text-white/80">refund = amount paid × unused credits ÷ credits bought × 50 %</p>
        <p>
          &quot;Amount paid&quot; is what you were actually charged for that pack, after any discount code. Several packs are
          calculated one by one and listed separately before you confirm.
        </p>
        <p>
          The result is rounded half up to the smallest unit of the payment currency (for example the cent), and never
          exceeds the part of that payment not already refunded. The remaining 50 % of the unused value covers payment
          processing, taxes already paid and administrative costs, and is retained.
        </p>
        <Table
          head={["Example", "Value"]}
          rows={[
            ["Research Pack bought", "400 credits for USD 29.00"],
            ["Unused", "300 credits"],
            ["Unused value", "USD 29.00 × 300 ÷ 400 = USD 21.75"],
            ["Refund (50 %)", "USD 10.875, rounded to USD 10.88"],
            ["Retained (50 %)", "USD 10.87"],
          ]}
        />
        <p>Purchased credits are used after monthly credits; within purchased credits, the oldest purchase is used first.</p>
      </Section>

      <Section id="statutory" title="5. Your statutory rights">
        <List
          items={[
            "Consumers in the EU, the EEA and the United Kingdom can withdraw from a credit-pack purchase within 14 days without giving a reason and get a full refund, unless they asked for immediate access and acknowledged that they lose this right once they start using the credits. A pack that is completely unused within 14 days is refunded in full.",
            "Where the law of your country requires a full refund of unused prepaid credit, or forbids a deduction, the refund is made in full.",
            "Nothing in this policy limits rights you have under mandatory consumer law, including for a service that is not provided as agreed.",
          ]}
        />
        <p>
          <Placeholder>[Counsel to confirm: withdrawal-right wording and model form; treatment of the subscription fee within the withdrawal period; any country where the 50 % retention is not permitted; Swiss law position.]</Placeholder>
        </p>
      </Section>

      <Section id="excluded" title="6. What is not refunded">
        <List
          items={[
            "Monthly credits included in a subscription. They expire at the end of the period.",
            "Promotional credits: the feedback questionnaire, citation and ambassador bonuses, and complimentary plan periods. They are free and have no cash value.",
            "Credits held by runs that are still queued or running. If such a run fails, its credits are returned to your balance as credits.",
            "Credits already used for completed runs.",
            "Payments that are disputed or charged back, until the dispute is resolved.",
          ]}
        />
      </Section>

      <Section id="process" title="7. How refunds are paid">
        <p>
          Refunds go back to the original payment method, in the original currency. We start the refund at once; your bank
          or card issuer usually shows it within 5–10 business days, which is outside our control. Each refund appears in
          your billing history as processing, refunded, or failed. If the payment provider cannot complete a refund, we retry
          automatically; if it is refused for good, the credits are restored to your balance and we contact you.
        </p>
      </Section>

      <Section id="contact" title="8. Questions">
        <p>
          Contact <Fact value={OPERATOR.email} />. You never need to contact us to cancel.
        </p>
      </Section>
    </LegalLayout>
  );
}
