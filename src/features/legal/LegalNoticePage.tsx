import { Link } from "react-router-dom";
import { Fact, LegalLayout, Section } from "./LegalLayout";
import { DATA_SOURCE, OPERATOR, PRODUCT } from "./meta";

export default function LegalNoticePage() {
  return (
    <LegalLayout title="Legal notice">
      <Section id="operator" title="Operator">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          {[
            ["Operator", OPERATOR.owner],
            ["Legal form", OPERATOR.form],
            ["UID", OPERATOR.uid],
            ["Status", OPERATOR.status],
            ["Address", OPERATOR.address],
            ["Product", `${PRODUCT}, a product operated by ${OPERATOR.owner}`],
            ["Email", OPERATOR.email],
            ["Responsible person", OPERATOR.representative],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-white/45">{k}</dt>
              <dd>
                <Fact value={v} />
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section id="disclaimer" title="Disclaimer">
        <p>
          The content of this website is provided by {OPERATOR.owner} for information about the Convolve software. It is not investment
          advice and not an offer or recommendation to buy or sell financial instruments. See the{" "}
          <Link to="/risk-disclosure">risk disclosure</Link>.
        </p>
        <p>
          We take care to keep the information on this website accurate but give no warranty for its completeness or
          timeliness. Links to third-party websites are provided for convenience; we are not responsible for their
          content.
        </p>
      </Section>
      <Section id="paid" title="Paid services">
        <p>
          Subscriptions and credit packs are governed by the{" "}
          <Link to="/subscription-terms">Subscription and Credit Terms</Link> and the{" "}
          <Link to="/refunds">Refund and Cancellation Policy</Link>. Paid plans are not offered to residents of the
          United States or its territories at this time.
        </p>
      </Section>
      <Section id="data" title="Market data">
        <p>
          Historical market data shown in Convolve currently comes from {DATA_SOURCE}. Convolve has no agreement with
          Yahoo and holds no commercial licence for this data; it is provided without warranty. See the{" "}
          <Link to="/terms#thirdparty">Terms of Service</Link>.
        </p>
      </Section>
      <Section id="copyright" title="Copyright">
        <p>
          Texts, graphics, visualisations and software on this website belong to {OPERATOR.owner} unless stated otherwise.
          Reproduction requires prior written permission.
        </p>
      </Section>
    </LegalLayout>
  );
}
