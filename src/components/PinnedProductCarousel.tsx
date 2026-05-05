import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface PinnedProduct {
  title: string;
  description: string;
  href: string;
  image?: string | null;
}

// Extend window interface for TradingView
declare global {
  interface Window {
    TradingView: {
      widget: new (config: any) => any;
    };
  }
}

// TradingView Widget Component
function TradingViewWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear any existing widget
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      "autosize": true,
      "symbol": "NASDAQ:AAPL",
      "interval": "D",
      "timezone": "America/New_York",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "enable_publishing": false,
      "withdateranges": true,
      "hide_side_toolbar": false,
      "allow_symbol_change": true,
      "show_popup_button": true,
      "popup_width": "1000",
      "popup_height": "650",
      "container_id": "tradingview-widget"
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current && containerRef.current.contains(script)) {
        containerRef.current.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="tradingview-widget-container w-full h-full" ref={containerRef}>
      <div className="tradingview-widget-container__widget w-full h-full"></div>
            </div>
  );
}

export default function PinnedProductCarousel({
  title,
  products,
}: {
  title: string;
  products: PinnedProduct[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  const nextProduct = () => {
    setActiveIndex((prev) => (prev + 1) % products.length);
  };

  const prevProduct = () => {
    setActiveIndex((prev) => (prev - 1 + products.length) % products.length);
  };

  // Animation variants
  const cardVariants = {
    initial: { opacity: 0, x: 50 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
  };

  const transition = {
    duration: 0.4,
    ease: [0.25, 0.46, 0.45, 0.94],
  };

  return (
    <section className="relative min-h-screen flex items-center py-12">
      <div className="container-aligned w-full">
        <h2 className="mb-8 text-4xl font-semibold tracking-tight text-white md:text-5xl lg:text-6xl">
          {title}
        </h2>

        <div className="relative flex items-center justify-center min-h-[600px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              variants={cardVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
              className="w-full max-w-5xl mx-auto"
            >
              <article className="bg-[#0a0a0a]/60 backdrop-blur-sm border border-white/8 rounded-xl p-5 md:p-8 shadow-2xl min-h-[520px]">
                <div className="text-xs uppercase tracking-[0.2em] text-white/40 mb-4">
                  {products[activeIndex].title}
                </div>
                {activeIndex === 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6 min-h-[520px]">
                    {/* TradingView area */}
                    <div className="rounded-xl border border-white/10 bg-[#0a0a0a]/40 overflow-hidden">
                      <div className="h-full min-h-[320px]">
                        <TradingViewWidget />
                      </div>
                    </div>

                    {/* Bot Status panel */}
                    <div className="rounded-xl border border-white/10 bg-[#0a0a0a]/40 p-5 flex flex-col">
                      <div className="text-xs uppercase tracking-[0.2em] text-white/50 mb-4">
                        Bot Status
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="text-white/50">Model</span>
                          <span className="text-white font-medium">CNN-v2.4</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="text-white/50">Symbol</span>
                          <span className="text-white font-medium">AAPL</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-white/5 pb-4">
                          <span className="text-white/50">State</span>
                          <span className="text-white font-medium">LIVE</span>
                        </div>
                      </div>

                      <div className="mt-4 border-t border-white/10 pt-4">
                        <div className="text-xs uppercase tracking-[0.2em] text-white/50 mb-2">
                          Signal
                        </div>
                        <div className="text-3xl font-semibold text-emerald-300">LONG</div>
                      </div>

                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs text-white/60 mb-2">
                          <span>Confidence</span>
                          <span className="font-mono text-white/80">74%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full w-[74%] bg-emerald-400 rounded-full" />
                        </div>
                      </div>

                      <div className="mt-5 border-t border-white/10 pt-4">
                        <div className="text-xs uppercase tracking-[0.2em] text-white/50 mb-2">
                          Risk Params
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                          <div className="flex flex-col">
                            <span className="text-white/40">TP</span>
                            <span className="text-emerald-300">+2.0%</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-white/40">SL</span>
                            <span className="text-rose-300">-1.2%</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-white/40">R:R</span>
                            <span className="text-white/80">1.67</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 border-t border-white/10 pt-4 flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-xs uppercase tracking-[0.2em] text-white/50 mb-1">
                            Accuracy
                          </span>
                          <span className="text-2xl font-semibold text-white">61%</span>
                          <span className="text-xs text-white/40">last 3 months</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs uppercase tracking-[0.2em] text-white/50">
                            Regime
                          </span>
                          <div className="text-sm font-mono text-white/80 mt-1">TRENDING</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col md:flex-row gap-5 md:gap-8 min-h-[440px]">
                    {/* Visual Area */}
                    <div className="md:w-2/5 aspect-[4/3] bg-[#0a0a0a]/40 rounded-lg flex flex-col border border-white/8 flex-shrink-0 overflow-hidden min-h-[320px]">
                      {products[activeIndex].image ? (
                        <img
                          src={products[activeIndex].image}
                          alt={`${products[activeIndex].title} visual`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-[#F5F5F5]/40">Visual</span>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex flex-col justify-center flex-grow">
                      <h3 className="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-semibold text-[#F5F5F5] mb-2 md:mb-3 leading-tight">
                        {products[activeIndex].title}
                      </h3>
                      <p className="text-[#F5F5F5]/62 mb-4 md:mb-5 leading-relaxed text-sm md:text-base">
                        {products[activeIndex].description}
                      </p>
                      <Link to={products[activeIndex].href}>
                        <button className="px-4 py-2 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200 inline-flex items-center gap-2">
                          <span className="text-white">Try now</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </Link>
                    </div>
                  </div>
                )}
              </article>
            </motion.div>
          </AnimatePresence>

          {/* Navigation Arrows */}
          <button
            onClick={prevProduct}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-6 w-12 h-12 bg-[#0a0a0a]/80 backdrop-blur-sm border border-white/8 rounded-full flex items-center justify-center text-[#F5F5F5] hover:bg-white/10 hover:border-white/30 transition-all duration-200 z-10"
            aria-label="Previous product"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            onClick={nextProduct}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-6 w-12 h-12 bg-[#0a0a0a]/80 backdrop-blur-sm border border-white/8 rounded-full flex items-center justify-center text-[#F5F5F5] hover:bg-white/10 hover:border-white/30 transition-all duration-200 z-10"
            aria-label="Next product"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          {/* Dots Indicator */}
          <div className="flex justify-center mt-8 gap-2">
          {products.map((_, i) => (
              <button
              key={i}
                onClick={() => setActiveIndex(i)}
                className={`w-3 h-3 rounded-full transition-all duration-200 ${
                i === activeIndex
                    ? "bg-[#e5e5e5] scale-125"
                    : "bg-[#F5F5F5]/30 hover:bg-[#F5F5F5]/50"
              }`}
                aria-label={`Go to product ${i + 1}`}
            />
          ))}
        </div>
      </div>
      </div>
    </section>
  );
}
