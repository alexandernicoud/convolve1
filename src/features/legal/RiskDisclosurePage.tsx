import { Link } from "react-router-dom";
import { LegalLayout, List, Section, Table } from "./LegalLayout";

const SECTIONS = [
  { id: "role", title: "What Convolve is and is not" },
  { id: "activities", title: "Four different activities" },
  { id: "models", title: "Model predictions" },
  { id: "backtests", title: "Backtests" },
  { id: "paper", title: "Paper trading" },
  { id: "real", title: "Trading with real money" },
  { id: "responsibility", title: "Your responsibility" },
];

export default function RiskDisclosurePage() {
  return (
    <LegalLayout
      title="Financial risk disclosure"
      sections={SECTIONS}
      intro={
        <p>
          Trading financial instruments involves substantial risk, including the loss of all capital invested. Read this
          disclosure before relying on anything Convolve produces.
        </p>
      }
    >
      <Section id="role" title="What Convolve is and is not">
        <p>
          Convolve is research software. It is not a bank, securities firm, broker, portfolio manager or financial
          adviser. It does not give personal recommendations, does not manage or hold your money or securities, has no
          connection to any brokerage account and does not execute real trades. Nothing on the website or in the
          workspace is an offer, solicitation or recommendation to buy or sell any financial instrument.
        </p>
        <p>
          This disclosure explains risks; it does not change the legal or regulatory obligations that may apply to you
          or to us.
        </p>
      </Section>

      <Section id="activities" title="Four different activities">
        <Table
          head={["Activity", "What happens", "Available today"]}
          rows={[
            ["Research and model development", "You build datasets, train models and analyse what they learn.", "Yes"],
            ["Historical simulation (backtesting)", "A model is applied to past data it was not trained on, with assumed costs.", "Yes"],
            ["Scheduled paper trading", "A bot applies a model on a schedule and records simulated trades with a virtual balance.", "Yes, simulated only"],
            ["Real-money trading", "Orders placed with a broker using real funds.", "No. Convolve does not offer this."],
          ]}
        />
      </Section>

      <Section id="models" title="Model predictions">
        <List
          items={[
            "A convolutional network learns statistical patterns in chart images. Those patterns may be noise, may not persist, and may fail suddenly when market conditions change.",
            "A prediction is a probability produced by a model, not a statement about what will happen.",
            "Interpretability tools such as Grad-CAM show where a model reacts in an image; they do not prove the model is right or that its reasoning is sound.",
          ]}
        />
      </Section>

      <Section id="backtests" title="Backtests">
        <List
          items={[
            "Past performance, real or simulated, does not guarantee future results.",
            "Testing many label rules, thresholds or models on the same history increases the chance that a good result is luck (overfitting and data snooping).",
            "Information leaking from the future into training or threshold selection can make results look better than they could have been.",
            "Assumed commissions and slippage are simplifications. Real costs, spreads, liquidity, taxes and market impact can be higher and can turn a profitable backtest into a loss.",
            "Historical data can contain errors, gaps, survivorship bias and adjustments.",
          ]}
        />
      </Section>

      <Section id="paper" title="Paper trading">
        <List
          items={[
            "Paper trades are simulated. No order reaches a market and no real position exists.",
            "Simulated fills assume prices and quantities that may not have been available, and ignore partial fills, queue position, halts and outages.",
            "Scheduled runs depend on data availability and infrastructure and can be delayed, skipped or paused.",
            "Good paper-trading results do not mean the same strategy would make money with real funds.",
          ]}
        />
      </Section>

      <Section id="real" title="Trading with real money">
        <p>
          If you decide to trade a strategy developed with Convolve, you do so outside Convolve, at your own risk and
          under your broker&apos;s terms. Automated strategies can lose money quickly, including through software
          errors, connectivity problems and unexpected market events. Only trade money you can afford to lose and
          consider seeking independent professional advice.
        </p>
      </Section>

      <Section id="responsibility" title="Your responsibility">
        <p>
          You are responsible for evaluating, testing and monitoring any strategy you build, for the decisions you make,
          and for complying with the laws that apply to you. See also the <Link to="/terms">Terms of Service</Link>.
        </p>
      </Section>
    </LegalLayout>
  );
}
