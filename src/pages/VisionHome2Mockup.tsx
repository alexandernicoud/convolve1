import { motion } from "framer-motion";
import visionMacbookMockup from "@/assets/Macbook_Air_Mockup_1.png";
import { cn } from "@/lib/utils";

export type GlowPlacement = "hero" | "science" | "hub" | "cta";

type Home2GlowMockupProps = {
  heroReducedMotion: boolean;
  glowPlacement?: GlowPlacement;
  /** Centered, dominant mockup (advantages section). */
  hub?: boolean;
  /** Hero (section 1) — larger device frame. */
  heroLarge?: boolean;
  /** Soft white halo instead of purple/pink (e.g. /home4 capabilities). */
  neutralGlow?: boolean;
  /** Disable halo/glow layers entirely. */
  disableGlow?: boolean;
};

export function Home2GlowMockup({
  heroReducedMotion,
  glowPlacement = "hero",
  hub = false,
  heroLarge = false,
  neutralGlow = false,
  disableGlow = false,
}: Home2GlowMockupProps) {
  const effective = hub ? "hub" : glowPlacement;

  const glowShell =
    effective === "hero"
      ? heroLarge
        ? "left-1/2 top-[50%] h-[min(60dvh,680px)] w-[min(102vw,1120px)] -translate-x-1/2 -translate-y-1/2 sm:h-[min(64dvh,740px)] sm:w-[min(106vw,1200px)] lg:h-[min(68dvh,820px)] lg:w-[min(112vw,1320px)]"
        : "left-1/2 top-[50%] h-[min(56dvh,620px)] w-[min(98vw,1040px)] -translate-x-1/2 -translate-y-1/2 sm:h-[min(58dvh,680px)] sm:w-[min(102vw,1120px)] lg:h-[min(62dvh,760px)] lg:w-[min(108vw,1240px)]"
      : effective === "science"
        ? "bottom-[-6%] left-[-14%] right-auto top-auto h-[min(52dvh,580px)] w-[min(104vw,1080px)] translate-y-0 sm:bottom-[-4%] sm:left-[-10%] lg:bottom-[4%] lg:left-[-18%] lg:h-[min(58dvh,680px)] lg:w-[min(112vw,1180px)]"
        : effective === "hub"
          ? "left-1/2 top-[46%] h-[min(72dvh,820px)] w-[min(118vw,1320px)] -translate-x-1/2 -translate-y-1/2 sm:h-[min(76dvh,900px)] sm:w-[min(122vw,1380px)] lg:h-[min(80dvh,960px)] lg:w-[min(128vw,1480px)]"
          : "right-[-8%] top-[32%] h-[min(54dvh,640px)] w-[min(100vw,1100px)] -translate-y-1/2 sm:right-[-4%] lg:right-[-10%] lg:top-[40%]";

  const glowPrimary = neutralGlow
    ? effective === "hub"
      ? "h-full w-full rounded-[50%] bg-[rgba(255,255,255,0.11)] blur-[100px] sm:blur-[112px] lg:blur-[124px]"
      : "h-full w-full rounded-[46%] bg-[rgba(255,255,255,0.09)] blur-[92px] sm:blur-[102px] lg:blur-[112px]"
    : effective === "hero"
      ? "h-full w-full rounded-[48%] bg-[rgba(174,133,246,0.16)] blur-[88px] sm:blur-[100px] lg:blur-[110px]"
      : effective === "science"
        ? "h-full w-full rounded-[42%] bg-[rgba(240,160,216,0.14)] blur-[92px] sm:blur-[104px] lg:blur-[118px]"
        : effective === "hub"
          ? "h-full w-full rounded-[50%] bg-[rgba(165,121,232,0.2)] blur-[100px] sm:blur-[112px] lg:blur-[124px]"
          : "h-full w-full rounded-[44%] bg-[rgba(174,133,246,0.14)] blur-[90px] sm:blur-[102px]";

  const glowInner = neutralGlow
    ? effective === "hub"
      ? "absolute inset-[14%] rounded-[46%] bg-[rgba(255,255,255,0.045)] blur-[68px]"
      : "absolute inset-[16%] rounded-[42%] bg-[rgba(255,255,255,0.035)] blur-[60px]"
    : effective === "hero"
      ? "absolute inset-[18%] rounded-[48%] bg-[rgba(214,154,246,0.055)] blur-[56px]"
      : effective === "science"
        ? "absolute inset-[12%] left-[28%] top-[8%] rounded-[40%] bg-[rgba(165,121,232,0.12)] blur-[72px]"
        : effective === "hub"
          ? "absolute inset-[14%] rounded-[46%] bg-[rgba(240,160,216,0.09)] blur-[68px]"
          : "absolute inset-[16%] right-[10%] top-[12%] rounded-[42%] bg-[rgba(240,160,216,0.08)] blur-[64px]";

  const outerJustify = hub ? "justify-center" : "justify-center lg:justify-end";
  const minHeights = hub
    ? "min-h-[min(72dvh,560px)] sm:min-h-[min(78dvh,620px)] md:min-h-[min(82dvh,680px)] lg:min-h-[min(88dvh,760px)]"
    : "min-h-[min(52dvh,500px)] sm:min-h-[min(56dvh,540px)] md:min-h-[min(58dvh,560px)] lg:min-h-[min(64dvh,640px)]";

  const scaleWrap = hub
    ? "scale-[1.22] motion-reduce:scale-100 sm:scale-[1.28] lg:scale-[1.34] xl:scale-[1.4]"
    : heroLarge
      ? "scale-[1.38] motion-reduce:scale-100 sm:scale-[1.44] lg:scale-[1.5] xl:scale-[1.56]"
      : "scale-[1.3] motion-reduce:scale-100 lg:scale-[1.34] xl:scale-[1.38]";

  const imgClass = hub
    ? "mx-auto block h-auto w-[min(94vw,1120px)] max-h-[min(78dvh,920px)] object-contain object-center drop-shadow-[0_44px_110px_-22px_rgba(0,0,0,0.85)] sm:w-[min(92vw,1200px)] sm:max-h-[min(80dvh,980px)] md:w-[min(90vw,1280px)] lg:w-[min(84vw,1320px)] lg:max-h-[min(82dvh,1000px)]"
    : heroLarge
      ? "mx-auto block h-auto w-[min(94vw,1120px)] max-h-[min(82dvh,940px)] object-contain object-center drop-shadow-[0_48px_118px_-26px_rgba(0,0,0,0.84)] sm:w-[min(92vw,1200px)] sm:max-h-[min(84dvh,1000px)] md:w-[min(90vw,1280px)] md:max-h-[min(86dvh,1040px)] lg:w-[min(82vw,1360px)] lg:max-h-[min(88dvh,1080px)]"
      : "mx-auto block h-auto w-[min(92vw,1040px)] max-h-[min(78dvh,880px)] object-contain object-center drop-shadow-[0_44px_110px_-28px_rgba(0,0,0,0.82)] sm:w-[min(90vw,1120px)] sm:max-h-[min(80dvh,960px)] md:w-[min(88vw,1200px)] md:max-h-[min(82dvh,1020px)] lg:w-[min(76vw,1280px)] lg:max-h-[min(84dvh,1080px)]";

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-none min-w-0 shrink-0 overflow-visible",
        hub ? "lg:mx-auto lg:max-w-[100%]" : "lg:ml-auto lg:mr-[-4%]"
      )}
    >
      <motion.div
        className={`relative z-[2] mx-auto flex w-full ${outerJustify} lg:pr-0`}
        initial={heroReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          delay: heroReducedMotion ? 0 : effective === "science" ? 0.2 : effective === "hub" ? 0.15 : 0.45,
          duration: heroReducedMotion ? 0 : 0.58,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        <div
          className={`relative flex w-full items-center justify-center overflow-visible px-2 py-4 sm:px-4 sm:py-6 md:px-5 md:py-8 ${minHeights}`}
        >
          {!disableGlow ? (
            <div className={`pointer-events-none absolute -z-[1] ${glowShell}`} aria-hidden>
              <div className={glowPrimary} />
              <div className={glowInner} />
            </div>
          ) : null}

          <div className={`relative z-[10] mx-auto origin-center ${scaleWrap}`}>
            <img
              src={visionMacbookMockup}
              alt=""
              className={imgClass}
              loading={effective === "hero" ? "eager" : "lazy"}
              decoding="async"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
