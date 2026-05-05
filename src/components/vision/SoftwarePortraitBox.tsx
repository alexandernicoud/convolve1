import softwareTrainImg from "@/assets/training.png";
import softwareBacktestImg from "@/assets/backtester.png";
import softwareDeployImg from "@/assets/dashboard.png";

export const SOFTWARE_PORTRAIT_TILES: Array<{
  id: string;
  src: string;
  label: string;
  topPct: number;
  leftPct: number;
  widthPct: number;
  z: number;
  rotateDeg: number;
}> = [
  { id: "train", src: softwareTrainImg, label: "Train", topPct: 4, leftPct: 2, widthPct: 70, z: 1, rotateDeg: -1.6 },
  { id: "backtest", src: softwareBacktestImg, label: "Backtest", topPct: 28, leftPct: 28, widthPct: 70, z: 2, rotateDeg: 0.8 },
  { id: "deploy", src: softwareDeployImg, label: "Deploy", topPct: 52, leftPct: 4, widthPct: 70, z: 3, rotateDeg: 1.6 },
];

type Variant = "vision" | "home2";

/**
 * Overlapping Train / Backtest / Deploy screenshots — §02 on Vision; neutral variant for /home2.
 */
export function SoftwarePortraitBox({ variant = "vision" }: { variant?: Variant }) {
  const isHome2 = variant === "home2";

  return (
    <div className="relative w-full max-w-[min(94vw,920px)] [aspect-ratio:1/1]">
      <div
        className={
          isHome2
            ? "absolute inset-0 overflow-hidden rounded-[2.25rem] border border-white/[0.1] shadow-[0_28px_90px_-42px_rgba(0,0,0,0.85)]"
            : "absolute inset-0 overflow-hidden rounded-[2.25rem] border border-white/[0.08] shadow-[0_30px_120px_-40px_rgba(190,90,180,0.55)]"
        }
        style={
          isHome2
            ? {
                background:
                  "radial-gradient(ellipse 88% 72% at 28% 18%, rgba(255,255,255,0.09) 0%, rgba(52,58,58,0.45) 38%, rgba(14,16,20,0.92) 78%, rgba(6,7,10,0.98) 100%)",
              }
            : {
                background:
                  "radial-gradient(ellipse 90% 70% at 25% 15%, rgba(255,180,220,0.55) 0%, rgba(220,120,200,0.42) 28%, rgba(150,80,180,0.30) 55%, rgba(70,40,90,0.20) 82%, rgba(20,12,28,0.65) 100%)",
              }
        }
        aria-hidden
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={
            isHome2
              ? {
                  background:
                    "radial-gradient(ellipse 55% 38% at 78% 88%, rgba(120,200,180,0.12) 0%, transparent 58%), radial-gradient(ellipse 42% 28% at 12% 82%, rgba(255,255,255,0.06) 0%, transparent 62%)",
                }
              : {
                  background:
                    "radial-gradient(ellipse 60% 40% at 80% 90%, rgba(255,140,200,0.30) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 10% 80%, rgba(160,110,255,0.22) 0%, transparent 65%)",
                }
          }
        />
      </div>

      <div className="absolute inset-0">
        {SOFTWARE_PORTRAIT_TILES.map((tile) => (
          <div
            key={tile.id}
            className="absolute"
            style={{
              top: `${tile.topPct}%`,
              left: `${tile.leftPct}%`,
              width: `${tile.widthPct}%`,
              zIndex: tile.z,
              transform: `rotate(${tile.rotateDeg}deg)`,
              transformOrigin: "center center",
            }}
          >
            <div
              className="relative overflow-hidden rounded-[1.25rem] ring-1 ring-white/[0.18]"
              style={{
                boxShadow: isHome2
                  ? "0 0 0 1px rgba(255,255,255,0.07) inset, 0 22px 50px -20px rgba(0,0,0,0.65)"
                  : "0 0 0 1px rgba(255,255,255,0.08) inset, 0 22px 50px -18px rgba(0,0,0,0.55), 0 0 30px rgba(255,210,240,0.10)",
                background: "rgba(10,10,12,0.85)",
              }}
            >
              <img
                src={tile.src}
                alt={`${tile.label} screenshot`}
                className="block h-auto w-full object-cover object-left-top"
                loading="lazy"
                decoding="async"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1/3"
                style={{
                  background: "linear-gradient(to bottom, rgba(255,255,255,0.10), transparent)",
                }}
              />
            </div>
            {isHome2 && tile.id === "deploy" ? null : (
              <span className="absolute -bottom-3 left-3 inline-flex items-center rounded-full border border-white/15 bg-black/65 px-2.5 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/80 backdrop-blur-md">
                {tile.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
