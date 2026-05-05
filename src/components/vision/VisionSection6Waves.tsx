/**
 * Diagonal animated wave field (section 6) — same sine geometry; optional `thin` for landing hero background.
 */

const VIEW = 100;
const STEPS = 100;

function wavePath(index: number, waveCount: number, amp: number): string {
  const baseY = 4 + (index / Math.max(1, waveCount - 1)) * 92;
  const phase = index * 0.55;
  const cycles = 3.2;
  let d = "";
  for (let s = 0; s <= STEPS; s++) {
    const x = (s / STEPS) * VIEW;
    const t = (x / VIEW) * Math.PI * 2 * cycles + phase;
    const y = baseY + amp * Math.sin(t);
    d += `${s === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
}

type Props = {
  reducedMotion?: boolean;
  /**
   * Landing hero: same diagonal wave pattern as section 6, but finer strokes and gentler amplitude
   * so it stays clearly in the background.
   */
  thin?: boolean;
};

export function VisionSection6Waves({ reducedMotion = false, thin = false }: Props) {
  const waves = thin ? 12 : 10;
  const amp = thin ? 1.45 : 2.1;

  const paths = Array.from({ length: waves }, (_, i) => {
    const opacity = thin
      ? Math.max(0.14, 0.72 - i * (0.52 / Math.max(1, waves - 1)))
      : 1 - i * (0.9 / Math.max(1, waves - 1));
    const duration = thin ? 24 + i * 1.5 : 18 + i * 2.2;
    const delay = thin ? -i * 0.85 : -i * 1.1;
    return {
      d: wavePath(i, waves, amp),
      opacity,
      duration,
      delay,
    };
  });

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-36deg] ${
          thin ? "h-[220%] w-[220%]" : "h-[240%] w-[240%]"
        }`}
      >
        <svg
          className={`h-full w-full ${thin ? "text-white" : "text-white"}`}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          preserveAspectRatio="none"
        >
          {paths.map((p, i) => (
            <g
              key={i}
              className={reducedMotion ? "" : "vision-s6-wave-arm"}
              style={
                reducedMotion
                  ? undefined
                  : {
                      animationDuration: `${p.duration}s`,
                      animationDelay: `${p.delay}s`,
                    }
              }
            >
              <path
                d={p.d}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth={
                  thin
                    ? 0.14 + (i / Math.max(1, waves - 1)) * 0.1
                    : 0.32 + (1 - p.opacity) * 0.14
                }
                style={{
                  opacity: p.opacity,
                }}
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
