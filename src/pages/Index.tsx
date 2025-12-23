import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown } from "lucide-react";
import trainBotVisual from "@/assets/train-bot-visual.png";
import TypewriterText from "@/components/TypewriterText";
import PinnedProductCarousel, {
  type PinnedProduct,
} from "@/components/PinnedProductCarousel";
import MetricsCards from "@/components/MetricsCards";

const products: PinnedProduct[] = [
  {
    title: "Access live trading bots",
    description:
      "Observe live automated systems with professional dashboards for execution quality, positions, and regime-aware performance monitoring.",
    href: "/products/live-bots",
    image: null,
  },
  {
    title: "Train your own bot",
    description:
      "Train convolutional models on your labeled charts, iterate on architecture and hyperparameters, and track learning curves as your dataset evolves.",
    href: "/products/train-bot",
    image: trainBotVisual,
  },
  {
    title: "Backtest your bot",
    description:
      "Run controlled historical simulations to understand stability across regimes, quantify drawdowns, and compare variants under identical assumptions.",
    href: "/products/backtest",
    image: null,
  },
  {
    title: "Generate training data",
    description:
      "Generate labeled chart sets at scale with configurable parameters, holding periods, and labeling rules that match your research workflow.",
    href: "/products/generate-data",
    image: null,
  },
  {
    title: "Optimize labeling systems",
    description:
      "Search labeling parameter space systematically to identify configurations that improve downstream model generalization and consistency.",
    href: "/products/optimize-labeling",
    image: null,
  },
];

const metrics = [
  {
    value: "+1000",
    subtitle: "Train Bots on +1000 assets",
  },
  {
    value: "50y+",
    subtitle: "Backtest on over 50y of data",
  },
  {
    value: "125’000",
    subtitle: "Analyze 125'000 different parameter constellations in one run.",
  },
  {
    value: ">50",
    subtitle: ">50 clicks to generate your own trading bot",
  },
];

export default function Index() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      {/* Clean gradient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-card" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* Hero Section (align with header container) */}
      <section className="relative pt-32 pb-24 min-h-screen flex items-center">
        <div className="container-aligned w-full relative">
          <div className="max-w-5xl">
            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] mb-8 opacity-0 animate-fade-up">
              <span className="block text-foreground">TRADE</span>
              <span className="block text-primary">DIFFERENTLY.</span>
              <span className="block text-foreground">TRADE</span>
              <span className="block text-primary">VISUALLY.</span>
              <span className="block text-foreground">TRADE</span>
              <span className="block text-primary">CONVOLUTIONAL.</span>
            </h1>

            <p
              className="text-lg md:text-xl text-muted-foreground mb-10 opacity-0 animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              Perceive the markets through the AI-lense.
            </p>

            <div
              className="flex flex-wrap items-center gap-3 opacity-0 animate-fade-up"
              style={{ animationDelay: "200ms" }}
            >
              <Link to="/products/live-bots" className="btn-primary">
                Try the Bot
              </Link>
              <Link to="/products/train-bot" className="btn-secondary">
                Build Your Bot
              </Link>
              <Link
                to="/vision"
                className="btn-secondary inline-flex items-center gap-2"
              >
                Learn More
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#quote"
                className="btn-secondary inline-flex items-center gap-2"
              >
                View what we build
                <ArrowDown className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Quote Section - full viewport */}
      <section id="quote" className="relative min-h-screen flex items-center">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/25 to-background" />
        <div className="container-aligned relative">
          <TypewriterText text="markets manifest visually" />
        </div>
      </section>

      {/* Products Section - pinned scroll-driven showcase */}
      <PinnedProductCarousel title="What We Built:" products={products} />

      {/* Metrics page */}
      <MetricsCards items={metrics} />

      <div className="h-24" />
    </main>
  );
}
