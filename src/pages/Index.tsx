import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import trainBotVisual from "@/assets/train-bot-visual.png";

const products = [
  {
    title: "Access live trading bots",
    description: "Connect to our automated trading systems running in real-time across global markets. Monitor live performance metrics, manage positions, and track execution quality with comprehensive dashboards designed for professional traders.",
    href: "/products/live-bots",
    image: null,
  },
  {
    title: "Train your own bot",
    description: "Build custom convolutional neural networks using your labeled datasets. Configure network architecture, set training hyperparameters, and monitor learning progress with real-time accuracy curves and validation metrics.",
    href: "/products/train-bot",
    image: trainBotVisual,
  },
  {
    title: "Backtest your bot",
    description: "Validate your trained models against historical market data with institutional-grade backtesting infrastructure. Analyze performance across different market regimes, measure risk-adjusted returns, and stress-test your strategies.",
    href: "/products/backtest",
    image: null,
  },
  {
    title: "Generate training data",
    description: "Create labeled candlestick chart datasets at scale with configurable parameters for any trading strategy. Define entry conditions, holding periods, and labeling criteria to build datasets tailored to your methodology.",
    href: "/products/generate-data",
    image: null,
  },
  {
    title: "Optimize labeling systems",
    description: "Fine-tune your data labeling parameters using systematic optimization algorithms. Test thousands of parameter combinations to discover the configurations that maximize model accuracy and generalization performance.",
    href: "/products/optimize-labeling",
    image: null,
  },
];

function TypewriterText({ text }: { text: string }) {
  const [displayedText, setDisplayedText] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isVisible) {
          setIsVisible(true);
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    let index = 0;
    const interval = setInterval(() => {
      if (index <= text.length) {
        setDisplayedText(text.slice(0, index));
        index++;
      } else {
        clearInterval(interval);
      }
    }, 60);

    return () => clearInterval(interval);
  }, [isVisible, text]);

  return (
    <h2
      ref={ref}
      className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-light tracking-tight text-foreground"
    >
      {displayedText}
      <span className="inline-block w-[3px] h-[1em] bg-primary/60 ml-1 animate-pulse" />
    </h2>
  );
}

function ProductCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const containerTop = rect.top;
      const containerHeight = rect.height;
      const viewportHeight = window.innerHeight;
      
      // Calculate scroll progress through the container
      const scrollProgress = (-containerTop) / (containerHeight - viewportHeight);
      const clampedProgress = Math.max(0, Math.min(1, scrollProgress));
      
      // Map progress to card index
      const newIndex = Math.min(
        products.length - 1,
        Math.floor(clampedProgress * products.length)
      );
      
      setActiveIndex(newIndex);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="relative"
      style={{ height: `${products.length * 60}vh` }}
    >
      <div className="sticky top-32 h-[70vh] flex items-center">
        <div className="w-full max-w-4xl mx-auto relative">
          {products.map((product, index) => {
            const isActive = index === activeIndex;
            const slideFromRight = index % 2 === 0;

            return (
              <div
                key={product.title}
                className={`absolute inset-0 transition-all duration-500 ease-out ${
                  isActive
                    ? "opacity-100 translate-x-0"
                    : slideFromRight
                    ? "opacity-0 translate-x-20 pointer-events-none"
                    : "opacity-0 -translate-x-20 pointer-events-none"
                }`}
              >
                <div className="bg-card/60 backdrop-blur-sm border border-border rounded-xl p-6 hover:border-primary/30 transition-all duration-300">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Image placeholder */}
                    <div className="md:w-2/5 aspect-[4/3] bg-secondary/30 rounded-lg flex items-center justify-center border border-border/50 flex-shrink-0 overflow-hidden">
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground/50">Visual</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex flex-col justify-center flex-grow">
                      <h3 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
                        {product.title}
                      </h3>
                      <p className="text-muted-foreground mb-6 leading-relaxed">
                        {product.description}
                      </p>
                      <Link
                        to={product.href}
                        className="btn-primary inline-flex items-center gap-2 w-fit"
                      >
                        Try now
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          
          {/* Progress indicators */}
          <div className="absolute -right-16 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {products.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  index === activeIndex ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Index() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Clean gradient background - no candles */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-card" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* Hero Section - Left Aligned with Logo */}
      <section className="relative pt-32 pb-24 min-h-screen flex items-center">
        <div className="container-wide relative">
          <div className="max-w-4xl">
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
              <Link
                to="/products/live-bots"
                className="btn-primary inline-flex items-center gap-2"
              >
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

      {/* Quote Section - Typewriter Effect */}
      <section
        id="quote"
        className="relative min-h-[60vh] flex items-center"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/30 to-background" />
        <div className="container-wide relative">
          <TypewriterText text="markets manifest visually" />
        </div>
      </section>

      {/* Products Section - Carousel */}
      <section id="products" className="relative py-24">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/20 to-background" />
        <div className="container-wide relative">
          {/* Section Title */}
          <h2 className="text-3xl md:text-4xl font-semibold text-foreground mb-16 opacity-0 animate-section-reveal">
            What We Built:
          </h2>

          {/* Carousel Cards */}
          <ProductCarousel />
        </div>
      </section>

      <div className="h-24" />
    </div>
  );
}
