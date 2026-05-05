import { useEffect, useRef, useState } from 'react';

// Types for candlestick data
interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Layout {
  width: number;
  height: number;
  padding: number;
  chartWidth: number;
  chartHeight: number;
  candleWidth: number;
  scaleX: (index: number) => number;
  scaleY: (price: number) => number;
}

// Step data structure
interface StepData {
  label: string;
  headline: string;
  description: string;
}

// Generate deterministic synthetic candlestick data
function generateCandleData(count: number, seed: number = 42): CandleData[] {
  const data: CandleData[] = [];
  let price = 100; // Starting price

  // Simple seeded random number generator for consistency
  let seedValue = seed;
  const random = () => {
    seedValue = (seedValue * 9301 + 49297) % 233280;
    return seedValue / 233280;
  };

  for (let i = 0; i < count; i++) {
    // Generate OHLC with some trend and volatility
    const trend = Math.sin(i / 20) * 0.5; // Long-term trend
    const noise = (random() - 0.5) * 4; // Short-term noise
    const volatility = 2 + random() * 2; // Variable volatility

    const open = price + trend + noise;
    const close = open + (random() - 0.5) * volatility;
    const high = Math.max(open, close) + random() * volatility * 0.5;
    const low = Math.min(open, close) - random() * volatility * 0.5;

    data.push({ open, high, low, close });
    price = close; // Carry over to next candle
  }

  return data;
}

// Compute layout for canvas
function computeLayout(width: number, height: number, data: CandleData[]): Layout {
  const padding = 40;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const candleWidth = Math.max(2, chartWidth / data.length - 1);

  // Find price range for scaling
  const prices = data.flatMap(candle => [candle.open, candle.high, candle.low, candle.close]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  const scaleX = (index: number) => padding + (index / (data.length - 1)) * chartWidth;
  const scaleY = (price: number) => padding + ((maxPrice - price) / priceRange) * chartHeight;

  return {
    width,
    height,
    padding,
    chartWidth,
    chartHeight,
    candleWidth,
    scaleX,
    scaleY
  };
}

// Draw the complete scene based on progress
function drawScene(ctx: CanvasRenderingContext2D, progress: number, layout: Layout, data: CandleData[]) {
  const { width, height, padding, scaleX, scaleY, candleWidth } = layout;

  // Clear canvas with dark background
  ctx.fillStyle = '#0A0B14';
  ctx.fillRect(0, 0, width, height);

  // Draw very faint horizontal guide lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;

  for (let i = 0; i < 4; i++) {
    const y = padding + (i / 3) * (height - padding * 2);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  // Segment 1: Candle reveal (p 0.00–0.25)
  const revealFraction = Math.min(1, Math.max(0, (progress - 0) / 0.25));
  const candlesToShow = Math.floor(revealFraction * data.length);

  if (candlesToShow > 0) {
    // Draw revealed candles
    for (let i = 0; i < Math.min(candlesToShow, data.length); i++) {
      const candle = data[i];
      const x = scaleX(i);
      const openY = scaleY(candle.open);
      const closeY = scaleY(candle.close);
      const highY = scaleY(candle.high);
      const lowY = scaleY(candle.low);

      const isUp = candle.close > candle.open;
      const bodyHeight = Math.abs(closeY - openY);
      const bodyY = Math.min(openY, closeY);

      // Draw wick
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();

      // Draw body
      ctx.fillStyle = isUp
        ? 'rgba(34, 211, 238, 0.7)' // Cyan tint for up candles
        : 'rgba(255, 79, 216, 0.6)'; // Pink tint for down candles

      if (bodyHeight < 1) {
        ctx.fillRect(x, bodyY - 0.5, candleWidth, 1);
      } else {
        ctx.fillRect(x, bodyY, candleWidth, bodyHeight);
      }
    }
  }

  // Segment 2: Scan window sweep (p 0.25–0.55)
  const scanProgress = Math.min(1, Math.max(0, (progress - 0.25) / 0.3));
  if (scanProgress > 0 && candlesToShow > 10) {
    // Scan window spans 8 candles, moves across the chart
    const windowWidth = 8;
    const maxStartIndex = Math.max(0, candlesToShow - windowWidth);
    const windowStartIndex = Math.floor(scanProgress * maxStartIndex);

    // Draw scan window overlay
    const windowStartX = scaleX(windowStartIndex);
    const windowEndX = scaleX(Math.min(windowStartIndex + windowWidth, data.length - 1)) + candleWidth;

    ctx.fillStyle = 'rgba(124, 92, 255, 0.1)';
    ctx.fillRect(windowStartX, padding, windowEndX - windowStartX, height - padding * 2);

    // Window border
    ctx.strokeStyle = 'rgba(124, 92, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(windowStartX, padding, windowEndX - windowStartX, height - padding * 2);

    // Segment 3: Features emerge (p 0.55–0.80)
    const featureProgress = Math.min(1, Math.max(0, (progress - 0.55) / 0.25));
    if (featureProgress > 0) {
      // Highlight candle edges within window
      for (let i = windowStartIndex; i < Math.min(windowStartIndex + windowWidth, candlesToShow); i++) {
        const candle = data[i];
        const x = scaleX(i);
        const highY = scaleY(candle.high);
        const lowY = scaleY(candle.low);

        // Enhanced wick
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, highY);
        ctx.lineTo(x + candleWidth / 2, lowY);
        ctx.stroke();
      }

      // Feature map overlay - subtle geometric blocks
      const blockSize = 20;
      const blocksX = Math.floor((windowEndX - windowStartX) / blockSize);
      const blocksY = Math.floor((height - padding * 2) / blockSize);

      ctx.fillStyle = `rgba(46, 107, 255, ${featureProgress * 0.2})`;
      for (let bx = 0; bx < blocksX; bx++) {
        for (let by = 0; by < blocksY; by++) {
          if ((bx + by) % 3 === Math.floor(featureProgress * 3)) {
            const blockX = windowStartX + bx * blockSize;
            const blockY = padding + by * blockSize;
            ctx.fillRect(blockX, blockY, blockSize - 2, blockSize - 2);
          }
        }
      }
    }

    // Segment 4: Layers -> signal (p 0.80–1.00)
    const layerProgress = Math.min(1, Math.max(0, (progress - 0.80) / 0.20));
    if (layerProgress > 0) {
      // CNN layer panels (right side of chart)
      const panelWidth = 80;
      const panelHeight = 30;
      const panelSpacing = 8;
      const layers = ['Conv1', 'Conv2', 'Pool', 'Dense'];

      layers.forEach((layer, i) => {
        const panelX = width - padding - panelWidth;
        const panelY = padding + i * (panelHeight + panelSpacing);
        const activation = Math.min(1, layerProgress * 4 - i);

        // Panel background
        ctx.fillStyle = `rgba(124, 92, 255, ${activation * 0.3})`;
        ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

        // Panel border
        ctx.strokeStyle = `rgba(124, 92, 255, ${activation * 0.6})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

        // Layer text
        ctx.fillStyle = `rgba(255, 255, 255, ${activation})`;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(layer, panelX + panelWidth / 2, panelY + panelHeight / 2 + 3);
      });

      // Connection line from scan window to active panel
      const activePanelIndex = Math.min(3, Math.floor(layerProgress * 4));
      if (activePanelIndex >= 0) {
        const panelX = width - padding - panelWidth / 2;
        const panelY = padding + activePanelIndex * (panelHeight + panelSpacing) + panelHeight / 2;
        const windowCenterX = (windowStartX + windowEndX) / 2;
        const windowCenterY = height / 2;

        ctx.strokeStyle = 'rgba(124, 92, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(windowCenterX, windowCenterY);
        ctx.lineTo(panelX, panelY);
        ctx.stroke();
      }

      // Output node and signal
      const outputX = width - padding + 60;
      const outputY = height / 2;

      // Output node
      ctx.fillStyle = `rgba(34, 211, 238, ${layerProgress})`;
      ctx.beginPath();
      ctx.arc(outputX, outputY, 12, 0, Math.PI * 2);
      ctx.fill();

      // Output label
      ctx.fillStyle = `rgba(255, 255, 255, ${layerProgress})`;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('signal: long', outputX + 20, outputY - 5);
      ctx.fillText('(0.74)', outputX + 20, outputY + 8);
    }
  }
}

export default function CnnScrollStory() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const animationFrameRef = useRef<number>();
  const [isMobile, setIsMobile] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // Animation state (stored in refs to avoid re-renders)
  const currentProgressRef = useRef(0);
  const targetProgressRef = useRef(0);
  const candleDataRef = useRef<CandleData[]>([]);
  const layoutRef = useRef<Layout | null>(null);

  // Step data
  const steps: StepData[] = [
    {
      label: "STEP 01",
      headline: "Market Data to Visual Patterns",
      description: "Historical price data transforms into structured visual representations. Each candlestick becomes part of a larger pattern that CNNs can learn to recognize."
    },
    {
      label: "STEP 02",
      headline: "Feature Extraction Pipeline",
      description: "The neural network processes raw pixel data through convolutional layers, automatically discovering spatial relationships in price action."
    },
    {
      label: "STEP 03",
      headline: "Pattern Recognition Engine",
      description: "Trained models identify recurring formations, momentum shifts, and microstructural patterns that traditional indicators miss."
    },
    {
      label: "STEP 04",
      headline: "Signal Generation",
      description: "Visual intelligence converts to actionable signals. The system learns what successful trading looks like, not just what the numbers say."
    }
  ];

  // Compute scroll progress for the section
  const updateScrollProgress = () => {
    const section = sectionRef.current;
    if (!section) return;

    const rect = section.getBoundingClientRect();
    const windowHeight = window.innerHeight;

    // Progress starts when section top enters viewport, ends when bottom reaches a threshold
    const start = windowHeight * 0.8; // Start when 80% of viewport height
    const end = -rect.height + windowHeight * 0.2; // End when 20% of section remains

    const progress = Math.max(0, Math.min(1,
      (start - rect.top) / (start - end)
    ));

    targetProgressRef.current = progress;

    // Update active step based on progress
    const newActiveStep = Math.min(3, Math.floor(progress * 4));
    if (newActiveStep !== activeStep) {
      setActiveStep(newActiveStep);
    }
  };

  // Animation loop using requestAnimationFrame
  const animate = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !layoutRef.current) return;

    // Smooth lerp towards target progress
    const diff = targetProgressRef.current - currentProgressRef.current;
    currentProgressRef.current += diff * 0.1; // Smooth interpolation

    // Draw the scene
    drawScene(ctx, currentProgressRef.current, layoutRef.current, candleDataRef.current);

    animationFrameRef.current = requestAnimationFrame(animate);
  };

  // Initialize canvas and data
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Generate candle data once
    candleDataRef.current = generateCandleData(120);

    const resizeCanvas = () => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      ctx.scale(dpr, dpr);

      // Compute layout
      layoutRef.current = computeLayout(rect.width, rect.height, candleDataRef.current);
    };

    // Initial setup
    resizeCanvas();

    // Handle resize
    const resizeObserver = new ResizeObserver(resizeCanvas);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Set up scroll listening and animation
  useEffect(() => {
    const handleScroll = () => {
      updateScrollProgress();
    };

    // Initial progress calculation
    updateScrollProgress();

    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(animate);

    // Listen to scroll
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [activeStep]);

  // Handle mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <section ref={sectionRef} id="vision-story" className="relative min-h-screen bg-[#0a0a0a] py-20 lg:py-32">
      {/* Background structure */}
      <div className="absolute inset-0 opacity-30">
        {/* Soft radial gradient */}
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-white/5 to-white/10" />
      </div>

      <div className="relative container-aligned max-w-7xl">
        {/* Section title */}
        <div className="text-center mb-16 lg:mb-24">
          <h2 className="text-4xl font-light tracking-tight text-white md:text-5xl lg:text-6xl">
            CNN Chart Processing Pipeline
          </h2>
          <p className="text-lg md:text-xl text-[#F5F5F5]/60 mt-4 max-w-3xl mx-auto">
            How raw market data becomes visual intelligence through deep learning
          </p>
        </div>

        {/* Main content layout */}
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-12' : 'lg:grid-cols-2 gap-16'}`}>
          {/* Left column: Steps */}
          <div className="space-y-12 lg:space-y-16">
            {steps.map((step, index) => (
              <div
                key={index}
                className={`relative transition-all duration-500 ${
                  index === activeStep
                    ? 'opacity-100 scale-105'
                    : 'opacity-60 scale-100'
                }`}
                style={{
                  '--step-accent-color': index === activeStep ? '#ffffff' : '#F5F5F5'
                } as React.CSSProperties}
              >
                {/* Step label */}
                <div
                  className={`font-mono text-sm tracking-wider uppercase mb-3 transition-colors duration-500 ${
                    index === activeStep ? 'text-white' : 'text-[#F5F5F5]/50'
                  }`}
                >
                  {step.label}
                </div>

                {/* Headline */}
                <h3 className={`text-xl md:text-2xl font-light mb-4 leading-tight transition-all duration-500 ${
                  index === activeStep ? 'text-[#F5F5F5]' : 'text-[#F5F5F5]/70'
                }`}>
                  {step.headline}
                </h3>

                {/* Description */}
                <p className={`leading-relaxed transition-all duration-500 ${
                  index === activeStep ? 'text-[#F5F5F5]/90' : 'text-[#F5F5F5]/50'
                }`}>
                  {step.description}
                </p>

                {/* Active accent line */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 bg-white transition-opacity duration-500 ${
                  index === activeStep ? 'opacity-100' : 'opacity-0'
                }`} />

                {/* Subtle connector line */}
                {index < steps.length - 1 && (
                  <div className="absolute left-0 top-full mt-8 h-8 w-px bg-gradient-to-b from-white/30 to-transparent" />
                )}
              </div>
            ))}
          </div>

          {/* Right column: Chart stage */}
          <div className={`${isMobile ? '' : 'lg:sticky lg:top-32'}`}>
            <div className="relative">
              {/* Chart container */}
              <div
                ref={containerRef}
                className="relative bg-[#0A0B14]/80 backdrop-blur-sm border border-white/10 rounded-2xl p-6 shadow-2xl hover:border-white/20 transition-all duration-300"
                style={{ height: '520px' }}
              >
                {/* Chart canvas */}
                <canvas
                  ref={canvasRef}
                  className="absolute inset-6 w-[calc(100%-3rem)] h-[calc(100%-3rem)] rounded-lg"
                  style={{ imageRendering: 'crisp-edges' }}
                />

                {/* Subtle glow effect */}
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 via-transparent to-white/5" />
              </div>

              {/* Legend strip */}
              <div className="mt-4 flex items-center justify-center space-x-6 text-xs text-[#F5F5F5]/50 font-mono">
                <span>candles</span>
                <span>•</span>
                <span>scan window</span>
                <span>•</span>
                <span>features</span>
                <span>•</span>
                <span>signal</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
