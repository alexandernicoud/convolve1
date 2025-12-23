export default function Vision() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card to-background" />
        
        {/* Layered wave fields */}
        <svg 
          className="absolute inset-0 w-full h-full opacity-20"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id="wave-gradient-1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="wave-gradient-2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Wave layer 1 */}
          <g className="animate-drift" style={{ animationDuration: '40s' }}>
            <path
              d="M0,450 Q360,350 720,450 T1440,450 L1440,900 L0,900 Z"
              fill="url(#wave-gradient-1)"
            />
          </g>
          
          {/* Wave layer 2 */}
          <g className="animate-drift" style={{ animationDuration: '35s', animationDelay: '-10s' }}>
            <path
              d="M0,500 Q360,400 720,500 T1440,500 L1440,900 L0,900 Z"
              fill="url(#wave-gradient-2)"
            />
          </g>
          
          {/* Mesh grid overlay */}
          <g opacity="0.1" stroke="hsl(217, 91%, 60%)" strokeWidth="0.5" fill="none">
            {Array.from({ length: 15 }).map((_, i) => (
              <line key={`h-${i}`} x1="0" y1={i * 60} x2="1440" y2={i * 60} />
            ))}
            {Array.from({ length: 25 }).map((_, i) => (
              <line key={`v-${i}`} x1={i * 60} y1="0" x2={i * 60} y2="900" />
            ))}
          </g>
        </svg>
        
        {/* Radial accent */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative pt-32 pb-24">
        <div className="container-narrow">
          {/* Hero */}
          <div className="max-w-3xl mx-auto text-center mb-24">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground mb-6 opacity-0 animate-fade-up tracking-tight">
              we build visual intelligence for markets.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground opacity-0 animate-fade-up" style={{ animationDelay: '100ms' }}>
              infrastructure for discovering structure in price — not signals, not promises.
            </p>
          </div>

          {/* The Idea */}
          <section className="max-w-2xl mx-auto mb-24 opacity-0 animate-fade-up" style={{ animationDelay: '200ms' }}>
            <h2 className="text-sm uppercase tracking-wider text-primary mb-8 text-center">
              The idea
            </h2>
            <div className="space-y-6 text-muted-foreground leading-relaxed">
              <p>
                Markets encode information visually. Price, time, and volume form patterns that repeat across instruments and timeframes.
              </p>
              <p>
                Traditional quant approaches reduce charts to numbers. We take the opposite path: we train models that see markets the way traders do.
              </p>
              <p>
                This is not about prediction. It is about perception — teaching machines to recognize the visual fingerprints of market structure.
              </p>
            </div>
          </section>

          {/* Our Thesis */}
          <section className="max-w-2xl mx-auto opacity-0 animate-fade-up" style={{ animationDelay: '300ms' }}>
            <h2 className="text-sm uppercase tracking-wider text-primary mb-8 text-center">
              Our thesis
            </h2>
            <div className="bg-card border border-border rounded-lg p-8">
              <p className="text-muted-foreground leading-relaxed">
                The future of systematic trading lies at the intersection of computer vision and market microstructure. We believe that visual representations of price action contain exploitable alpha that cannot be captured by purely numerical methods. By treating candlestick charts as images and applying modern deep learning techniques, we can extract features that traditional quantitative analysis overlooks.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
