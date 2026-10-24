import { Link } from "react-router-dom";
import { Fact, LegalLayout, List, Placeholder, Section } from "./LegalLayout";
import { OPERATOR, TERMS_VERSION } from "./meta";

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
          Convolve is operated under the name {OPERATOR.name} (&quot;we&quot;, &quot;us&quot;). Your contract is with{" "}
          <Fact value={OPERATOR.contractingParty} />, <Fact value={OPERATOR.address} />. These terms apply to the website
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
          Historical prices are retrieved from third-party sources. We do not guarantee their accuracy, completeness or
          continued availability, and they may change their terms or stop providing data. Parts of the service rely on
          third-party infrastructure listed in the <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </Section>

      <Section id="fees" title="10. Fees">
        <p>
          Convolve is currently provided free of charge. Before each run the workspace shows its estimated computation in
          credits, calculated by the pricing policy described in the <Link to="/help#credits">help center</Link>. Credits
          measure computation only: they have no monetary value and cannot be bought, sold or redeemed. While charging is
          off, credits are not deducted. If we introduce paid plans, prices and terms will be
          shown before you subscribe, and nothing will be charged without your explicit agreement.
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
          for the International Sale of Goods. Courts at <Placeholder>[place of jurisdiction]</Placeholder>, Switzerland,
          have jurisdiction. If you are a consumer, you also keep the protection of mandatory provisions of the law of
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
