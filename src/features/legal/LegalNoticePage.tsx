import { Link } from "react-router-dom";
import { Fact, LegalLayout, Section } from "./LegalLayout";
import { OPERATOR, PRODUCT } from "./meta";

export default function LegalNoticePage() {
  return (
    <LegalLayout title="Legal notice">
      <Section id="operator" title="Operator">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          {[
            ["Product", PRODUCT],
            ["Operated under the name", OPERATOR.name],
            ["Contracting party", OPERATOR.contractingParty],
            ["Legal form", OPERATOR.form],
            ["Address", OPERATOR.address],
            ["Email", OPERATOR.email],
            ["Responsible person", OPERATOR.representative],
            ["Commercial register", OPERATOR.register],
            ["UID / VAT number", OPERATOR.uid],
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
          The content of this website is provided by {OPERATOR.name} for information about the Convolve software. It is not investment
          advice and not an offer or recommendation to buy or sell financial instruments. See the{" "}
          <Link to="/risk-disclosure">risk disclosure</Link>.
        </p>
        <p>
          We take care to keep the information on this website accurate but give no warranty for its completeness or
          timeliness. Links to third-party websites are provided for convenience; we are not responsible for their
          content.
        </p>
      </Section>
      <Section id="copyright" title="Copyright">
        <p>
          Texts, graphics, visualisations and software on this website belong to {OPERATOR.name} unless stated otherwise.
          Reproduction requires prior written permission.
        </p>
      </Section>
    </LegalLayout>
  );
}
