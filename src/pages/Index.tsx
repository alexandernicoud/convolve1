import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown } from "lucide-react";

export default function Index() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Candlestick Background */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-card" />
        
        {/* Diagonal line overlay */}
        <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
          <defs>
            <pattern id="diagonalLines" patternUnits="userSpaceOnUse" width="60" height="60" patternTransform="rotate(30)">
              <line x1="0" y1="0" x2="0" y2="60" stroke="hsl(var(--primary))" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#diagonalLines)" />
        </svg>
        
        {/* Candlestick chart visualization */}
        <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3/4 h-full opacity-30" viewBox="0 0 800 600" preserveAspectRatio="xMaxYMid slice">
          {/* Subtle grid lines */}
          <defs>
            <linearGradient id="fadeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="30%" stopColor="hsl(var(--muted-foreground))" stopOpacity="0.1" />
              <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          
          {/* Horizontal grid lines */}
          {[100, 200, 300, 400, 500].map((y) => (
            <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="url(#fadeGradient)" strokeWidth="1" />
          ))}
          
          {/* Candlesticks - arranged in an uptrend pattern */}
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
              {/* Wick */}
              <line
                x1={candle.x}
                y1={candle.high}
                x2={candle.x}
                y2={candle.low}
                stroke={candle.bearish ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))"}
                strokeWidth="1.5"
                opacity="0.6"
              />
              {/* Body */}
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
          
          {/* Trend line */}
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
          
          {/* Scattered dots */}
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
        
        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* Hero Section */}
      <section className="relative pt-32 pb-24 min-h-screen flex items-center">
        <div className="container-wide relative">
          <div className="max-w-4xl">
            {/* Stacked headline */}
            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] mb-8 opacity-0 animate-fade-up">
              <span className="block text-foreground">TRADE</span>
              <span className="block text-primary">DIFFERENTLY.</span>
              <span className="block text-foreground">TRADE</span>
              <span className="block text-primary">VISUALLY.</span>
              <span className="block text-foreground">TRADE</span>
              <span className="block text-primary">CONVOLUTIONAL.</span>
            </h1>
            
            {/* Subline */}
            <p className="text-lg md:text-xl text-muted-foreground mb-10 opacity-0 animate-fade-up" style={{ animationDelay: '100ms' }}>
              Perceive the markets through the AI-lense.
            </p>
            
            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3 opacity-0 animate-fade-up" style={{ animationDelay: '200ms' }}>
              <Link 
                to="/products/generator" 
                className="btn-primary inline-flex items-center gap-2"
              >
                Try the Bot
              </Link>
              <Link 
                to="/products/trainer" 
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
                href="#products" 
                className="btn-secondary inline-flex items-center gap-2"
              >
                View what we build
                <ArrowDown className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section id="products" className="relative py-24 bg-gradient-to-b from-transparent to-card/50">
        <div className="container-wide">
          <div className="text-center mb-16 opacity-0 animate-fade-up">
            <h2 className="text-2xl md:text-3xl font-semibold text-foreground mb-4">
              The toolkit
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              End-to-end infrastructure for building and testing visual market models.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <ProductCard
              title="Generator"
              description="Create labeled candlestick chart datasets at scale. Generate thousands of training samples with configurable parameters."
              href="/products/generator"
              delay={100}
            />
            <ProductCard
              title="Trainer"
              description="Train convolutional neural networks on your generated datasets. Monitor progress and analyze model behavior."
              href="/products/trainer"
              delay={200}
            />
            <ProductCard
              title="Backtester"
              description="Validate model performance with comprehensive backtesting. Analyze returns, drawdowns, and risk metrics."
              href="/products/backtester"
              delay={300}
            />
          </div>
        </div>
      </section>

      {/* Footer spacer */}
      <div className="h-24" />
    </div>
  );
}

function ProductCard({ title, description, href, delay = 0 }: { 
  title: string; 
  description: string; 
  href: string; 
  delay?: number;
}) {
  return (
    <Link 
      to={href}
      className="group block p-6 bg-card/50 border border-border rounded-xl hover:border-primary/30 hover:bg-card transition-all duration-300 opacity-0 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <h3 className="text-lg font-medium text-foreground mb-2 group-hover:text-primary transition-colors">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        {description}
      </p>
      <span className="text-sm text-primary font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
        Open tool
        <ArrowRight className="w-4 h-4" />
      </span>
    </Link>
  );
}
