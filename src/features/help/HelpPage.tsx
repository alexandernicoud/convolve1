import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fetchApi } from "@/lib/api";
import type { PlanCatalogue } from "@/features/credits/model";
import { Container, M2Footer } from "@/features/marketing2/ui";
import { PipelineVisual } from "@/features/onboarding/OnboardingHost";
import { TOUR_STEPS } from "@/features/onboarding/steps";
import { useOnboardingStore } from "@/features/onboarding/store";
import { ANNOTATIONS } from "./annotations";

const SECTIONS = [
  { id: "how-it-works", title: "How Convolve works" },
  { id: "tour", title: "Guided tour" },
  { id: "generate", title: "Build a dataset" },
  { id: "labeling", title: "Labeling rules" },
  { id: "train", title: "Train a model" },
  { id: "analyze", title: "Analyze a model" },
  { id: "backtest", title: "Backtest" },
  { id: "results", title: "Read your results" },
  { id: "bots", title: "Paper bots" },
  { id: "credits", title: "Credits and pricing" },
  { id: "account", title: "Account and data" },
  { id: "terms", title: "Terminology" },
  { id: "risk", title: "Risk" },
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-white/[0.08] py-10 first:border-t-0 first:pt-0">
      <h2 className="text-[1.35rem] font-semibold tracking-tight text-white">{title}</h2>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-white/65 [&_strong]:font-medium [&_strong]:text-white/90">{children}</div>
    </section>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-white/[0.06] py-3 sm:grid-cols-[11rem_1fr] sm:gap-6">
      <dt className="text-[14px] font-medium text-white/90">{name}</dt>
      <dd className="text-[14px] leading-relaxed text-white/60">{children}</dd>
    </div>
  );
}

function TourControls() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { loaded, server, load, start, openWelcome } = useOnboardingStore();

  useEffect(() => {
    if (session && !loaded) void load();
  }, [session, loaded, load]);

  if (!session) {
    return (
      <p>
        The tour runs inside the workspace.{" "}
        <Link to="/signup?next=%2Fdashboard" className="text-white underline-offset-4 hover:underline">
          Create an account
        </Link>{" "}
        or{" "}
        <Link to="/login?next=%2Fhelp%23tour" className="text-white underline-offset-4 hover:underline">
          sign in
        </Link>{" "}
        to take it.
      </p>
    );
  }

  const go = (step: number) => {
    start(step);
    navigate(TOUR_STEPS[step].route);
  };
  const resumable = server && server.status !== "completed" && server.step > 0;
  const btn = "inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium transition";

  return (
    <div className="space-y-4">
      <p>
        Six steps, about three minutes. The tour highlights each tool in the sidebar, then the controls on its page. It never starts a
        run. {server?.status === "completed" ? "You have completed it; you can take it again any time." : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {resumable ? (
          <button type="button" onClick={() => go(server.step)} className={`${btn} bg-white text-[#0a0a0a] hover:bg-white/90`}>
            Resume at step {server.step + 1} <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => go(0)}
          className={`${btn} ${resumable ? "border border-white/15 text-white/80 hover:bg-white/10" : "bg-white text-[#0a0a0a] hover:bg-white/90"}`}
        >
          {server?.status === "new" ? "Start the tour" : "Restart from the beginning"}
        </button>
        <button
          type="button"
          onClick={() => {
            openWelcome();
            navigate("/dashboard");
          }}
          className={`${btn} border border-white/15 text-white/80 hover:bg-white/10`}
        >
          Show the welcome screen
        </button>
      </div>
      <div>
        <p className="text-[13px] text-white/45">Or jump to one tool:</p>
        <ol className="mt-2 flex flex-wrap gap-2">
          {TOUR_STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => go(i)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-white/70 transition hover:border-white/25 hover:text-white"
              >
                {i + 1} · {s.label}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function PricingTable() {
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetchApi("/api/plans")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: PlanCatalogue) => live && setCatalogue(c))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="text-white/45">The price list could not be loaded. Every run still shows its estimate before it starts.</p>;
  if (!catalogue) return <div className="h-40 animate-pulse rounded-xl bg-white/[0.03]" aria-hidden />;
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="w-full min-w-[34rem] text-left text-[13.5px]">
        <thead className="text-[11px] uppercase tracking-[0.14em] text-white/40">
          <tr>
            <th className="px-4 py-3 font-medium">Run</th>
            <th className="px-4 py-3 font-medium">Typical</th>
            <th className="px-4 py-3 font-medium">Range</th>
            <th className="px-4 py-3 font-medium">How it is calculated</th>
          </tr>
        </thead>
        <tbody>
          {catalogue.run_costs.map((c) => (
            <tr key={c.tool} className="border-t border-white/[0.06] align-top">
              <td className="px-4 py-3 text-white/85">{c.label}</td>
              <td className="px-4 py-3 font-digits tabular-nums text-white">{c.credits}</td>
              <td className="px-4 py-3 font-digits tabular-nums text-white/60">
                {c.min != null && c.max != null ? (c.min === c.max ? c.min : `${c.min}–${c.max}`) : "—"}
              </td>
              <td className="px-4 py-3 text-white/55">{c.formula ?? "Fixed price."}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-white/[0.06] px-4 py-2.5 text-[12px] text-white/40">
        Pricing policy {catalogue.pricing_version ?? "—"} ·{" "}
        {catalogue.charging_enabled ? "Credits are charged when a run starts." : "Charging is off: runs are free during the beta."}
      </p>
    </div>
  );
}

export default function HelpPage() {
  const { hash } = useLocation();
  const { session } = useAuth();

  useEffect(() => {
    document.title = "Help | convolve.";
  }, []);

  useEffect(() => {
    if (!hash) return;
    const id = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 60);
    return () => window.clearTimeout(id);
  }, [hash]);

  return (
    <div className="bg-[#050506] text-white">
      <Container className="grid gap-12 pb-24 pt-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16 lg:pt-16">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">Help center</p>
          <nav aria-label="Help topics" className="mt-4">
            <ol className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-white/50 lg:flex-col">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="transition-colors hover:text-white">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          {session ? (
            <Link to="/dashboard" className="mt-8 hidden text-[13px] text-white/50 hover:text-white lg:block">
              ← Back to workspace
            </Link>
          ) : null}
        </aside>

        <article className="min-w-0 max-w-[46rem]">
          <h1 className="text-[clamp(2rem,4vw,2.8rem)] font-semibold tracking-tight">How can we help?</h1>
          <p className="mt-3 text-[16px] leading-relaxed text-white/60">
            Organised by what you are trying to do. Inside the workspace, the <strong className="font-medium text-white/85">Explain</strong>{" "}
            button in the top bar outlines every control on the page; click one to see what it does.
          </p>

          <div className="mt-12">
            <Section id="how-it-works" title="How Convolve works">
              <p>
                Convolve turns price history into a supervised image-classification problem. Each chart window is rendered as a candlestick
                image and labelled by what happened next: <strong>1</strong> if price reached the take-profit before the stop-loss within
                the horizon, otherwise <strong>0</strong>. A convolutional network (CNN) learns to predict that label from the image.
              </p>
              <PipelineVisual />
              <p>
                The workflow: <strong>generate</strong> a labelled dataset, <strong>train</strong> a CNN, <strong>analyze</strong> what it
                looks at, <strong>backtest</strong> its signals on a later period, then <strong>deploy</strong> it as a paper-trading bot
                and <strong>monitor</strong> it. Training, evaluating, backtesting and paper bots are separate stages; Convolve does not
                place real orders at any stage.
              </p>
            </Section>

            <Section id="tour" title="Guided tour">
              <TourControls />
            </Section>

            <Section id="generate" title="Build a dataset">
              <p>
                In the <strong>Generator</strong>, pick assets, a dataset size or calendar period, a timeframe and a labeling rule. Convolve
                downloads daily, weekly or monthly prices, renders each window as an image and sorts it into label folders.
              </p>
              <p>
                Keep a later period aside: the Backtester and its test-data generator should use dates after your training data, otherwise
                results are measured on what the model has already seen.
              </p>
              <p>{ANNOTATIONS["gen-balance"].body}</p>
            </Section>

            <Section id="labeling" title="Labeling rules">
              <p>
                A rule has three parts: <strong>take profit</strong> (a rise in percent), <strong>stop loss</strong> (a fall in percent) and{" "}
                <strong>horizon</strong> (how many bars to wait). The label answers one question: from the chart's last close, was the
                take-profit reached before the stop-loss within the horizon?
              </p>
              <p>
                The <strong>Labeling optimizer</strong> ranks rules on a stock's daily history before you generate data. {ANNOTATIONS["opt-grid"].body}
              </p>
            </Section>

            <Section id="train" title="Train a model">
              <p>
                The <strong>Trainer</strong> uses your latest dataset unless you pick another or upload a ZIP. {ANNOTATIONS["train-standard"].body}{" "}
                {ANNOTATIONS["train-standard"].more}
              </p>
              <p>Training runs on the server; you can leave the page and come back to the session to follow progress.</p>
            </Section>

            <Section id="analyze" title="Analyze a model">
              <p>
                The <strong>Analysis lab</strong> opens a trained model on its own dataset. Explorer shows a Grad-CAM heatmap: the regions
                of the chart that contributed most to the prediction. Further modules test whether masking that evidence changes the output
                and how the network organises features.
              </p>
              <p>{ANNOTATIONS["lab-modules"].more}</p>
            </Section>

            <Section id="backtest" title="Backtest">
              <p>
                The <strong>Backtester</strong> scores every test image with your model and simulates trades: a BUY signal when the
                probability is at or above the threshold, closed at take-profit, stop-loss or the horizon. Commission, slippage, position
                size and a drawdown limit apply.
              </p>
              <p>A backtest is a simulation on past data. It is not an evaluation on future data and does not predict returns.</p>
            </Section>

            <Section id="results" title="Read your results">
              <dl>
                <Term name={ANNOTATIONS["validation-accuracy"].title}>
                  {ANNOTATIONS["validation-accuracy"].body} {ANNOTATIONS["validation-accuracy"].more}
                </Term>
                <Term name={ANNOTATIONS["bt-threshold"].title}>{ANNOTATIONS["bt-threshold"].body}</Term>
                <Term name={ANNOTATIONS["take-profit"].title}>{ANNOTATIONS["take-profit"].body}</Term>
                <Term name={ANNOTATIONS["max-drawdown"].title}>{ANNOTATIONS["max-drawdown"].body}</Term>
                <Term name="Benchmark">Passive comparisons over the same calendar and capital: buy-and-hold of the underlying, an equal-weight basket and an exposure-matched mix. A strategy that does not beat them after costs has not added value.</Term>
              </dl>
            </Section>

            <Section id="bots" title="Paper bots">
              <p>
                <strong>Deploy</strong> runs a trained model on a schedule: after each completed bar it renders the latest chart, scores
                it and records a simulated trade if the probability clears the threshold. Bots use a paper wallet. No brokerage account is
                connected and no real orders are sent; real-money trading is not supported.
              </p>
              <p>
                The <strong>Dashboard</strong> shows each bot's evaluations, simulated trades, equity and health events.
              </p>
            </Section>

            <Section id="credits" title="Credits and pricing">
              <p>
                Credits measure computation. Every run button shows the price the server calculates from your settings, for example{" "}
                <strong>Train model (14 credits)</strong>, and <strong>How it's priced</strong> below it shows the formula. Prices are fixed
                when the run starts and are not metered while it runs, so stopping early or a slow machine does not change them. If an input
                is not known yet (for example the size of an uploaded dataset), the price is marked <strong>est.</strong>
              </p>
              <p>
                Runs above 25 credits ask for confirmation. When charging is on, a failed run is refunded and a double-click cannot charge
                twice. During the beta charging is off and nothing is deducted.
              </p>
              <PricingTable />
            </Section>

            <Section id="account" title="Account and data">
              <p>
                Your <Link to="/account" className="text-white underline-offset-4 hover:underline">account</Link> shows your plan, usage and
                runs. You can export your data or delete your account there. Sign-in is handled by Supabase; see the{" "}
                <Link to="/privacy" className="text-white underline-offset-4 hover:underline">privacy policy</Link> for what is stored.
              </p>
              <p>
                Questions or problems: <Link to="/contact" className="text-white underline-offset-4 hover:underline">contact us</Link>.
              </p>
            </Section>

            <Section id="terms" title="Terminology">
              <dl>
                <Term name="Dataset">Labelled chart images produced by the Generator, split into label folders.</Term>
                <Term name="Label">1 if take-profit was reached before stop-loss within the horizon, otherwise 0.</Term>
                <Term name="Timeframe">{ANNOTATIONS["gen-timeframe"].body}</Term>
                <Term name="Horizon">{ANNOTATIONS["gen-horizon"].body}</Term>
                <Term name="Epoch">One full pass of the network over the training images.</Term>
                <Term name={ANNOTATIONS["train-val_split"].title}>{ANNOTATIONS["train-val_split"].body}</Term>
                <Term name="Grad-CAM">A heatmap of the chart regions that contributed most to a prediction.</Term>
                <Term name="Backtest">A simulation of trades from model signals on historical test data.</Term>
                <Term name="Paper bot">A scheduled model that records simulated trades on new market data. No real orders.</Term>
                <Term name="Credit">The unit of computation used to price runs.</Term>
              </dl>
            </Section>

            <Section id="risk" title="Risk">
              <p>
                Convolve is a research tool, not investment advice. Model accuracy, backtests and paper-bot results describe the past or a
                simulation; they do not predict future returns. Read the{" "}
                <Link to="/risk" className="text-white underline-offset-4 hover:underline">risk disclosure</Link>.
              </p>
            </Section>
          </div>
        </article>
      </Container>
      <M2Footer />
    </div>
  );
}
