type Props = {
  /** 0–1; hero atmosphere fades out as section 01 takes the viewport */
  opacity?: number;
  className?: string;
};

/**
 * Animated wave lines — use inside hero only; opacity controlled by scroll.
 */
export function VisionWaveField({ opacity = 1, className = "" }: Props) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden bg-transparent ${className}`}
      style={{ opacity }}
      aria-hidden
    >
      <svg
        className="vision-wave-svg absolute -left-[10%] top-0 h-full w-[120%] min-h-[100%] opacity-100"
        viewBox="0 0 2400 1200"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="visionWaveFade" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.38)" />
            <stop offset="45%" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.1)" />
          </linearGradient>
        </defs>
        <g className="vision-wave-group vision-wave-group--a" fill="none" stroke="url(#visionWaveFade)" strokeWidth="1.35">
          <path d="M0,180 Q300,140 600,180 T1200,180 T1800,160 T2400,190" />
          <path d="M0,320 Q400,280 800,320 T1600,300 T2400,330" />
          <path d="M0,480 Q350,440 700,480 T1400,460 T2100,500 T2400,470" />
          <path d="M0,640 Q450,600 900,640 T1800,620 T2400,660" />
          <path d="M0,800 Q380,760 760,800 T1520,780 T2400,820" />
          <path d="M0,960 Q420,920 840,960 T1680,940 T2400,980" />
        </g>
        <g
          className="vision-wave-group vision-wave-group--b"
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="1"
          opacity="1"
        >
          <path d="M0,240 Q320,200 640,240 T1280,220 T1920,260 T2400,230" />
          <path d="M0,560 Q380,520 760,560 T1520,540 T2400,580" />
          <path d="M0,880 Q400,840 800,880 T1600,860 T2400,900" />
        </g>
      </svg>
    </div>
  );
}
