import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const products = [
  {
    title: "Access live trading bots",
    description: "Connect to automated trading systems running in real-time. Monitor performance and manage positions.",
    href: "/products/live-bots",
  },
  {
    title: "Train your own bot",
    description: "Build custom convolutional neural networks using your datasets. Full control over architecture and training.",
    href: "/products/train-bot",
  },
  {
    title: "Backtest your bot",
    description: "Validate model performance with historical data. Comprehensive metrics and risk analysis.",
    href: "/products/backtest",
  },
  {
    title: "Generate training data",
    description: "Create labeled candlestick chart datasets at scale. Configurable parameters for any strategy.",
    href: "/products/generate-data",
  },
  {
    title: "Optimize labeling systems",
    description: "Fine-tune labeling parameters to maximize model accuracy. Data-driven parameter selection.",
    href: "/products/optimize-labeling",
  },
];

export default function Index() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Candlestick Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-card" />
        
        <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
          <defs>
            <pattern id="diagonalLines" patternUnits="userSpaceOnUse" width="60" height="60" patternTransform="rotate(30)">
              <line x1="0" y1="0" x2="0" y2="60" stroke="hsl(var(--primary))" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#diagonalLines)" />
        </svg>
        
        <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3/4 h-full opacity-30" viewBox="0 0 800 600" preserveAspectRatio="xMaxYMid slice">
          <defs>
            <linearGradient id="fadeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="30%" stopColor="hsl(var(--muted-foreground))" stopOpacity="0.1" />
              <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          
          {[100, 200, 300, 400, 500].map((y) => (
            <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="url(#fadeGradient)" strokeWidth="1" />
          ))}
          
          {[
            { x: 50, open: 450, close: 420, high: 410, low: 460 },
            { x: 90, open: 420, close: 380, high: 370, low: 430 },
            { x: 130, open: 380, close: 400, high: 370, low: 410, bearish: true },
            { x: 170, open: 400, close: 360, high: 350, low: 410 },
            { x: 210, open: 360, close: 340, high: 330, low: 370 },
            { x: 250, open: 340, close: 370, high: 330, low: 380, bearish: true },
            { x: 290, open: 370, close: 320, high: 310, low: 380 },
            { x: 330, open: 320, close: 290, high: 280, low: 330 },
            { x: 370, open: 290, close: 260, high: 250, low: 300 },
            { x: 410, open: 260, close: 280, high: 250, low: 290, bearish: true },
            { x: 450, open: 280, close: 240, high: 230, low: 290 },
            { x: 490, open: 240, close: 210, high: 200, low: 250 },
            { x: 530, open: 210, close: 230, high: 200, low: 240, bearish: true },
            { x: 570, open: 230, close: 190, high: 180, low: 240 },
            { x: 610, open: 190, close: 160, high: 150, low: 200 },
            { x: 650, open: 160, close: 180, high: 150, low: 190, bearish: true },
            { x: 690, open: 180, close: 140, high: 130, low: 190 },
            { x: 730, open: 140, close: 120, high: 110, low: 150 },
            { x: 770, open: 120, close: 100, high: 90, low: 130 },
          ].map((candle, i) => (
            <g key={i}>
              <line
                x1={candle.x}
                y1={candle.high}
                x2={candle.x}
                y2={candle.low}
                stroke={candle.bearish ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))"}
                strokeWidth="1.5"
                opacity="0.6"
              />
              <rect
                x={candle.x - 8}
                y={Math.min(candle.open, candle.close)}
                width="16"
                height={Math.abs(candle.close - candle.open)}
                fill={candle.bearish ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))"}
                opacity={candle.bearish ? "0.3" : "0.5"}
              />
            </g>
          ))}
          
          <line
            x1="50"
            y1="470"
            x2="770"
            y2="80"
            stroke="hsl(var(--primary))"
            strokeWidth="1"
            strokeDasharray="8 4"
            opacity="0.4"
          />
          
          {[
            { cx: 150, cy: 520 },
            { cx: 280, cy: 480 },
            { cx: 420, cy: 400 },
            { cx: 550, cy: 320 },
            { cx: 680, cy: 250 },
            { cx: 100, cy: 300 },
            { cx: 350, cy: 150 },
            { cx: 500, cy: 500 },
          ].map((dot, i) => (
            <circle
              key={i}
              cx={dot.cx}
              cy={dot.cy}
              r="2"
              fill="hsl(var(--primary))"
              opacity="0.4"
            />
          ))}
        </svg>
        
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* Hero Section */}
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
            
            <p className="text-lg md:text-xl text-muted-foreground mb-10 opacity-0 animate-fade-up" style={{ animationDelay: '100ms' }}>
              Perceive the markets through the AI-lense.
            </p>
            
            <div className="flex flex-wrap items-center gap-3 opacity-0 animate-fade-up" style={{ animationDelay: '200ms' }}>
              <Link 
                to="/products/live-bots" 
                className="btn-primary inline-flex items-center gap-2"
              >
                Try the Bot
              </Link>
              <Link 
                to="/products/train-bot" 
                className="btn-secondary"
              >
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

      {/* Quote Section */}
      <section id="quote" className="relative min-h-screen flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/30 to-background" />
        <div className="relative text-center px-8">
          <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-light tracking-tight text-foreground/90 opacity-0 animate-fade-up">
            markets manifest visually
          </h2>
        </div>
      </section>

      {/* Products Section */}
      <section id="products" className="relative py-32">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/20 to-background" />
        <div className="container-wide relative">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {products.map((product, index) => (
              <ProductCard
                key={product.title}
                title={product.title}
                description={product.description}
                href={product.href}
                index={index}
              />
            ))}
          </div>
        </div>
      </section>

      <div className="h-24" />
    </div>
  );
}

function ProductCard({ 
  title, 
  description, 
  href, 
  index 
}: { 
  title: string; 
  description: string; 
  href: string; 
  index: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className={`transition-all duration-700 ease-out ${
        isVisible 
          ? 'opacity-100 translate-y-0' 
          : 'opacity-0 translate-y-8'
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="group h-full flex flex-col p-6 bg-card/50 border border-border rounded-xl hover:border-primary/30 hover:bg-card transition-all duration-300">
        {/* Image placeholder */}
        <div className="aspect-video bg-secondary/30 rounded-lg mb-4 flex items-center justify-center border border-border/50">
          <span className="text-xs text-muted-foreground/50">Visual</span>
        </div>
        
        <h3 className="text-base font-medium text-foreground mb-2 group-hover:text-primary transition-colors">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed flex-grow">
          {description}
        </p>
        <Link
          to={href}
          className="text-sm font-medium text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all"
        >
          Try now
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
