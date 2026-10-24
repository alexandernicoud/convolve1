import { Link } from "react-router-dom";
import { LegalLayout, List, Placeholder, Section, Table } from "./LegalLayout";
import { OPERATOR } from "./meta";

const SECTIONS = [
  { id: "controller", title: "Who is responsible" },
  { id: "scope", title: "Scope and applicable law" },
  { id: "data", title: "What we process" },
  { id: "purposes", title: "Purposes and legal bases" },
  { id: "providers", title: "Service providers" },
  { id: "transfers", title: "International transfers" },
  { id: "retention", title: "Retention and deletion" },
  { id: "rights", title: "Your rights" },
  { id: "security", title: "Security" },
  { id: "other", title: "Other information" },
];

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      sections={SECTIONS}
      intro={
        <p>
          This policy explains which personal data Convolve processes when you visit the website or use the research
          workspace, why, where it is stored and which rights you have. It describes the service as it operates today.
        </p>
      }
    >
      <Section id="controller" title="1. Who is responsible">
        <p>The controller responsible for processing personal data on this website and in the Convolve workspace is:</p>
        <p>
          <Placeholder>{OPERATOR.name}</Placeholder>
          <br />
          <Placeholder>{OPERATOR.address}</Placeholder>
          <br />
          Email: <Placeholder>{OPERATOR.privacyEmail}</Placeholder>
        </p>
        <p>
          For questions about privacy or to exercise your rights, contact us at the address above. Further operator
          details are listed in the <Link to="/legal">legal notice</Link>.
        </p>
      </Section>

      <Section id="scope" title="2. Scope and applicable law">
        <p>
          Convolve is operated from Switzerland. We process personal data in accordance with the Swiss Federal Act on
          Data Protection (FADP). Because the service is available to users in the European Union and European
          Economic Area, the EU General Data Protection Regulation (GDPR) may also apply to processing that relates to
          those users; where it does, the GDPR-specific information in this policy applies as well.
        </p>
      </Section>

      <Section id="data" title="3. What we process">
        <p>
          <strong>Account data.</strong> When you create an account we process your email address, a user identifier,
          your sign-in method, whether your email address is verified, the time the account was created and your last
          sign-in, an optional display name, and the version and time at which you accepted the Terms of Service.
          Passwords are handled by our authentication provider and stored only as a cryptographic hash; we never see
          them. If you sign in with Google, Google shares your name, email address and Google account identifier with
          us.
        </p>
        <p>
          <strong>Research content.</strong> The workspace stores what you create or upload: chart datasets and their
          settings, uploaded and trained models, training and analysis runs, backtest reports, labels, tags and notes,
          and their metadata. This content is linked to your account. It usually concerns financial instruments rather
          than people, but it is personal data insofar as it is linked to you.
        </p>
        <p>
          <strong>Paper-trading bots.</strong> If you deploy a bot we store its configuration (symbol, model, thresholds,
          schedule, simulated capital and costs) and its history of predictions, simulated trades and simulated equity.
        </p>
        <p>
          <strong>Technical data.</strong> When you use the website or the API, our hosting and authentication
          providers process your IP address, browser and device information, request times, requested URLs and
          error information in server logs.
        </p>
        <p>
          <strong>Contact messages.</strong> If you use the contact form we process your name, email address and
          message.
        </p>
        <p>
          <strong>Browser storage.</strong> The website stores your sign-in session and workspace preferences in your
          browser&apos;s local storage. Details are in the <Link to="/cookies">cookie and storage notice</Link>.
        </p>
        <p>
          <strong>Usage and credits.</strong> We record which tools you run, when, and how long each run takes, together
          with your plan and a ledger of credits granted, used and refunded. This is shown to you on your account page
          and included in your data export.
        </p>
        <p>
          We do <strong>not</strong> use analytics, advertising or social-media tracking, do not send marketing emails,
          and do not process payment data, because Convolve currently has no paid plans.
        </p>
      </Section>

      <Section id="purposes" title="4. Purposes and legal bases">
        <Table
          head={["Purpose", "Data", "Legal basis where the GDPR applies"]}
          rows={[
            ["Creating and running your account, signing you in", "Account data, technical data", "Performance of a contract (Art. 6(1)(b))"],
            ["Providing the workspace: storing, processing and showing your research, models, backtests and bots", "Research content, bot data", "Performance of a contract (Art. 6(1)(b))"],
            ["Keeping each account's data separate and the service secure; detecting abuse", "Account data, technical data", "Legitimate interests in a secure service (Art. 6(1)(f))"],
            ["Sending service emails such as verification, password reset and email-change confirmations", "Email address", "Performance of a contract (Art. 6(1)(b))"],
            ["Showing your usage, keeping your credit balance and enforcing plan limits", "Usage and credits", "Performance of a contract (Art. 6(1)(b))"],
            ["Answering contact requests", "Contact messages", "Legitimate interests / pre-contractual steps (Art. 6(1)(f), (b))"],
            ["Recording acceptance of the Terms of Service", "Terms version and time", "Legitimate interests in proving the agreement (Art. 6(1)(f))"],
            ["Complying with legal obligations", "As required", "Legal obligation (Art. 6(1)(c))"],
          ]}
        />
        <p>We do not use your data for automated decisions that have legal or similarly significant effects on you.</p>
      </Section>

      <Section id="providers" title="5. Service providers">
        <p>We use the following providers to operate Convolve. They process personal data on our behalf and under our instructions, or, where stated, as independent controllers.</p>
        <Table
          head={["Provider", "Role", "Location of processing"]}
          rows={[
            ["Supabase", "User accounts and sign-in; database for account data, research metadata and bot data", "EU (Ireland); Supabase Inc. is based in the USA"],
            ["Google Cloud", "Application servers, model training, file storage for datasets, models and reports, server logs", <>Switzerland (Zurich) for servers; storage region <Placeholder>[to be confirmed]</Placeholder></>],
            ["Vercel", "Hosting and delivery of the website", "Global edge network; Vercel Inc. is based in the USA"],
            ["Google (sign-in)", "Optional sign-in with a Google account (independent controller for your Google account)", "Global"],
            ["Google Fonts", "Typefaces loaded by your browser; Google receives your IP address", "Global"],
            ["Web3Forms", "Delivery of contact-form messages by email, where enabled", <Placeholder key="w">[to be confirmed]</Placeholder>],
            [<>Email delivery for account emails</>, "Verification, password-reset and email-change messages", <Placeholder key="e">[provider and location to be confirmed]</Placeholder>],
          ]}
        />
        <p>
          Market prices are retrieved by our servers from public market-data sources (currently Yahoo Finance). No
          personal data is sent to them.
        </p>
      </Section>

      <Section id="transfers" title="6. International transfers">
        <p>
          Some providers are based in, or may access data from, the United States and other countries that may not
          offer a level of data protection equivalent to Switzerland or the EU. Where this is the case, transfers rely
          on the Swiss–U.S. and EU–U.S. Data Privacy Frameworks where the provider is certified, or on the European
          Commission&apos;s standard contractual clauses as recognised by the Swiss Federal Data Protection and
          Information Commissioner. <Placeholder>[Confirm the transfer mechanism for each provider.]</Placeholder>
        </p>
      </Section>

      <Section id="retention" title="7. Retention and deletion">
        <List
          items={[
            "Account data and research content are kept for as long as your account exists, or until you delete the individual item.",
            "Incomplete direct uploads are deleted automatically after one day.",
            <>Server and authentication logs are kept according to our providers&apos; log retention, <Placeholder>[retention period to be confirmed]</Placeholder>.</>,
            <>Database backups are kept by our database provider for <Placeholder>[backup retention to be confirmed]</Placeholder>.</>,
            "Contact messages are kept as long as needed to answer them and for any follow-up.",
          ]}
        />
        <p>
          <strong>Deleting your account.</strong> You can delete your account in Account settings. This removes your
          account, profile, research runs, datasets, models, stored files, analyses, backtests, bots and their
          paper-trading history from our active systems. Copies can remain in backups until those backups expire. We keep
          a minimal record that a deletion took place (account identifier and time) in server logs, and we keep
          information we are legally required to retain. <Placeholder>[Confirm retention of deletion records.]</Placeholder>
        </p>
      </Section>

      <Section id="rights" title="8. Your rights">
        <p>Subject to the applicable law, you have the right to:</p>
        <List
          items={[
            "obtain information about and a copy of the personal data we hold about you;",
            "have incorrect data corrected;",
            "have your data deleted;",
            "receive data you provided in a structured, machine-readable format (data portability);",
            "object to processing based on legitimate interests and, under the GDPR, request restriction of processing;",
            "withdraw consent at any time where processing is based on consent, without affecting earlier processing.",
          ]}
        />
        <p>
          You can correct your display name and email address, download a copy of your account data and delete your
          account yourself in <Link to="/account">Account settings</Link>. For anything else, contact us at{" "}
          <Placeholder>{OPERATOR.privacyEmail}</Placeholder>. We may need to verify your identity before acting on a
          request.
        </p>
        <p>
          You can lodge a complaint with the Swiss Federal Data Protection and Information Commissioner (FDPIC). If the
          GDPR applies, you can also complain to the supervisory authority in your country of residence or work.
        </p>
      </Section>

      <Section id="security" title="9. Security">
        <p>
          We use technical and organisational measures appropriate to the risk. Connections to the website and API are
          encrypted with TLS. Every API request is checked against your signed-in session, and the server verifies that
          you own each dataset, model, run and bot you access. Database tables are not reachable directly from browsers,
          and stored files are kept under a separate area per account. No system is completely secure, and we cannot
          guarantee the security of data transmitted over the internet.
        </p>
      </Section>

      <Section id="other" title="10. Other information">
        <p>
          Convolve is not directed at persons under 18. If you believe a minor has created an account, contact us and we
          will delete it.
        </p>
        <p>
          We may update this policy when the service or the law changes. The date at the top shows the latest version.
          Material changes will be announced in the workspace.
        </p>
      </Section>
    </LegalLayout>
  );
}
