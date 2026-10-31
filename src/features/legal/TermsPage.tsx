import { Link } from "react-router-dom";
import { Fact, LegalLayout, List, Placeholder, Section } from "./LegalLayout";
import { DATA_SOURCE, OPERATOR, OPERATOR_LINE, TERMS_VERSION } from "./meta";

const SECTIONS = [
  { id: "provider", title: "Provider and scope" },
  { id: "service", title: "The service" },
  { id: "account", title: "Accounts" },
  { id: "use", title: "Acceptable use" },
  { id: "content", title: "Your content" },
  { id: "ip", title: "Convolve's intellectual property" },
  { id: "results", title: "Research results and risk" },
  { id: "bots", title: "Paper-trading bots" },
  { id: "thirdparty", title: "Market data and third parties" },
  { id: "fees", title: "Fees" },
  { id: "availability", title: "Availability and changes" },
  { id: "termination", title: "Suspension, termination and deletion" },
  { id: "liability", title: "Liability" },
  { id: "law", title: "Governing law and disputes" },
  { id: "final", title: "Final provisions" },
];

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      sections={SECTIONS}
      intro={
        <p>
          These terms govern your use of Convolve, a research workspace for building, testing and paper-trading
          convolutional neural network models on financial chart data. Version {TERMS_VERSION}.
        </p>
      }
    >
      <Section id="provider" title="1. Provider and scope">
        <p>
          Convolve is a product operated by {OPERATOR_LINE} (&quot;we&quot;, &quot;us&quot;). Convolve is not an incorporated
          company; your contract is with {OPERATOR.owner} personally, as sole proprietor. These terms apply to the website
          and the workspace. By creating an account and accepting these terms you enter into an agreement with us. If you use Convolve on behalf of an
          organisation, you confirm that you may bind it, and these terms apply to it as well.
        </p>
      </Section>

      <Section id="service" title="2. The service">
        <p>Convolve currently lets you:</p>
        <List
          items={[
            "generate labelled chart-image datasets from historical market data, or upload your own;",
            "train, upload and analyse convolutional neural network models;",
            "backtest models on historical data with configurable costs and thresholds;",
            "run models as scheduled paper-trading bots that simulate trades with a virtual balance.",
          ]}
        />
        <p>
          Convolve is a software tool. It does not provide investment advice, portfolio management, brokerage or
          custody services, does not connect to any brokerage account, does not hold client money or assets and does not
          execute real trades. Features described as planned are not part of the service until they are released.
        </p>
      </Section>

      <Section id="account" title="3. Accounts">
        <List
          items={[
            "You must be at least 18 years old and able to enter into a binding contract.",
            "Provide accurate information and keep your email address current.",
            "Keep your sign-in credentials confidential. You are responsible for activity under your account; tell us promptly if you suspect misuse.",
            "One person per account. Accounts may not be shared or resold.",
          ]}
        />
      </Section>

      <Section id="use" title="4. Acceptable use">
        <p>You may not:</p>
        <List
          items={[
            "access, or attempt to access, other users' accounts, data or models, or circumvent authentication, ownership checks or usage limits;",
            "probe, scan or test the vulnerability of the service without our written permission;",
            "use the service's computing resources for purposes unrelated to research on Convolve, such as cryptocurrency mining, or impose an unreasonable load;",
            "upload malware, unlawful content, or data you have no right to use;",
            "use automated means to scrape or copy the service, except through interfaces we provide for that purpose;",
            "use Convolve to provide regulated financial services to others without the authorisations those services require.",
          ]}
        />
      </Section>

      <Section id="content" title="5. Your content">
        <p>
          You keep all rights to the datasets, models, configurations, strategies and notes you upload or create
          (&quot;your content&quot;). You grant us a non-exclusive licence to host, copy, process and display your content
          solely to provide the service to you. We do not use your content to train our own models or share it with
          other users.
        </p>
        <p>
          You are responsible for having the rights to the content and data you upload, including any licence terms
          that apply to market data you provide.
        </p>
      </Section>

      <Section id="ip" title="6. Convolve's intellectual property">
        <p>
          The software, website, design, documentation and the Convolve name and logo belong to us or our licensors. We
          grant you a personal, non-transferable right to use the service in accordance with these terms for as long as
          your account exists.
        </p>
      </Section>

      <Section id="results" title="7. Research results and risk">
        <p>
          Model predictions, analyses, backtests and paper-trading results are produced by statistical models applied to
          historical data. They can be wrong, are not forecasts of future performance and are not recommendations to buy
          or sell any financial instrument. Backtests can be affected by overfitting, look-ahead effects, data errors
          and simplified assumptions about costs and execution. Read the{" "}
          <Link to="/risk-disclosure">risk disclosure</Link> before relying on any result. Any decision to trade with real
          money is yours alone.
        </p>
      </Section>

      <Section id="bots" title="8. Paper-trading bots">
        <p>
          Bots simulate trades with a virtual balance. Their scheduled execution depends on market-data availability and
          our infrastructure, and runs may be delayed, skipped or paused. Simulated fills use simplified assumptions and do
          not reproduce real order books, liquidity, slippage, partial fills or outages. Real-money trading is not offered.
        </p>
      </Section>

      <Section id="thirdparty" title="9. Market data and third parties">
        <p>
          Historical prices are currently retrieved from {DATA_SOURCE}. We have no agreement with Yahoo and hold no
          commercial licence for this data. It is used to generate charts and run your research inside Convolve; we do
          not sell it, and these terms grant you no right to the underlying data. Use any data you obtain through
          Convolve for your own research only and in accordance with the source&apos;s terms.
        </p>
        <p>
          Market data may be inaccurate, delayed, incomplete, adjusted after the fact or temporarily or permanently
          unavailable, and the source may change its terms or stop providing data. We may replace the source at any
          time. We do not guarantee the accuracy, completeness or continued availability of any market data.{" "}
          <Placeholder>[A commercially licensed data source is required before paid plans launch.]</Placeholder>
        </p>
        <p>
          Parts of the service rely on third-party infrastructure listed in the <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </Section>

      <Section id="fees" title="10. Fees">
        <p>
          Creating an account and browsing your work are free. Running research tools uses credits, calculated per run by
          the pricing policy described in the <Link to="/help#credits">help center</Link> and shown before each run.
        </p>
        <p>
          Paid subscriptions and credit packs, once offered, are governed by the{" "}
          <Link to="/subscription-terms">Subscription and Credit Terms</Link> and the{" "}
          <Link to="/refunds">Refund and Cancellation Policy</Link>, which form part of these terms. Prices, what a plan
          includes and how it renews are shown before you buy, and nothing is charged without your explicit agreement.
          Paid plans are not offered to residents of the United States or its territories at this time. We check the
          country you declare, your billing address and the country that issued your card; a purchase from an excluded
          country is refunded in full and no credits or plan are granted.
        </p>
        <p>
          <strong>Promotional credits.</strong> We may grant free credits, for example for completing the feedback
          questionnaire or for a citation of Convolve that we have reviewed and approved. Promotional credits have no cash
          value, are never refunded or paid out, cannot be transferred or exchanged for money, and are not purchased
          credits for the purposes of the <Link to="/refunds">Refund and Cancellation Policy</Link>. Each promotion can be
          claimed once per verified account; we may withdraw credits obtained through abuse, such as multiple accounts.
        </p>
        <p>
          <strong>Ambassador programme.</strong> You can create a personal invite code. A reward is earned once per new
          account that signed up with your code, when the first payment of its first paid subscription succeeds, and
          depends on that plan. Starter: that account receives 5 promotional credits and you receive 10. Research or
          Professional: that account receives 20 promotional credits and you receive one free month of the Research plan;
          if you have no paid subscription, a complimentary month that ends by itself and is never charged; if you have one,
          a credit of the Research monthly price against your next invoices. Free months and invoice credits are limited to
          12 per year. Invite codes are for new accounts only and cannot be used on your own account or between two
          accounts that invited each other; a subscription fully covered by a discount does not qualify. If the qualifying
          payment is refunded in full, disputed or charged back, rewards from it that are still unused are withdrawn.
          Rewards have no cash value and are not refunded. We may refuse or withdraw rewards obtained through
          self-referral, multiple accounts or other abuse, and we may change or end the programme for future invites.
        </p>
        <p>
          While paid plans are not available in your country or account, Convolve is provided free of charge and credits are
          either not deducted or granted as a free allowance with no monetary value.
        </p>
      </Section>

      <Section id="availability" title="11. Availability and changes">
        <p>
          We aim to keep Convolve available but do not guarantee uninterrupted operation. We may change, suspend or
          discontinue features, for example for maintenance, security or legal reasons. We will give reasonable notice of
          material changes where possible. We may update these terms; if a change is material we will ask you to accept
          the new version before you continue using the workspace.
        </p>
      </Section>

      <Section id="termination" title="12. Suspension, termination and deletion">
        <p>
          You can stop using Convolve and delete your account at any time in <Link to="/account">Account settings</Link>.
          Deletion is permanent and removes your content as described in the Privacy Policy; export anything you want to
          keep first. We may suspend or terminate accounts that breach these terms or put the service or other users at
          risk, with notice where reasonable.
        </p>
        <p>
          When a subscription ends, your account stays open with read-only access: your models, datasets, runs and bots
          are kept and remain visible, but research tools and scheduled bots stop until you subscribe again. Ending a
          subscription never deletes your content.
        </p>
      </Section>

      <Section id="liability" title="13. Liability">
        <p>
          To the extent permitted by law, we exclude liability for damages caused by slight negligence, for indirect or
          consequential damages, and for trading or investment losses resulting from the use of research results, models,
          backtests or paper-trading output. We remain liable for damage caused intentionally or by gross negligence and
          wherever liability cannot be excluded by law, including under mandatory consumer-protection rules.{" "}
          <Placeholder>[Liability clause to be reviewed by counsel.]</Placeholder>
        </p>
      </Section>

      <Section id="law" title="14. Governing law and disputes">
        <p>
          These terms are governed by Swiss law, excluding its conflict-of-law rules and the UN Convention on Contracts
          for the International Sale of Goods. The courts at the operator&apos;s place of business, currently Hausen AG
          (Canton of Aargau), Switzerland, have jurisdiction.{" "}
          <Placeholder>[Counsel to confirm the jurisdiction clause.]</Placeholder> If you are a consumer, you also keep the protection of mandatory provisions of the law of
          your country of residence and may bring proceedings where the law allows.
        </p>
      </Section>

      <Section id="final" title="15. Final provisions">
        <p>
          If a provision of these terms is invalid, the remaining provisions remain in effect. Contact:{" "}
          <Fact value={OPERATOR.email} />.
        </p>
      </Section>
    </LegalLayout>
  );
}
