import { useEffect, useRef, useState } from "react";

export type ProofStatConfig = {
  id: string;
  label: string;
  mode: "up";
  end: number;
  suffix: "" | "+" | "k" | "M+" | "/7";
  /** Renders as `<` + value while counting (e.g. &lt;20) */
  prefix?: "<";
};

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

export function formatProofStatFinal(config: ProofStatConfig): string {
  return formatUp(config.end, config.end, config.suffix, config.prefix);
}

function formatUp(
  n: number,
  end: number,
  suffix: ProofStatConfig["suffix"],
  prefix?: "<"
) {
  const v = Math.round(Math.min(n, end));
  if (prefix === "<") {
    return `${prefix}${v}`;
  }
  if (suffix === "/7") {
    return `${v}/7`;
  }
  if (v === 0 && suffix !== "") {
    return "0";
  }
  if (suffix === "M+") return `${v}M+`;
  if (suffix === "k") return `${v}k`;
  if (suffix === "+") return `${v}+`;
  return `${v}`;
}

function VisionProofStatCell({
  config,
  active,
  reducedMotion,
}: {
  config: ProofStatConfig;
  active: boolean;
  reducedMotion: boolean;
}) {
  const finalStr = formatUp(config.end, config.end, config.suffix, config.prefix);

  const [display, setDisplay] = useState("0");
  const rafRef = useRef<number>();

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (!active) {
      setDisplay("0");
      return;
    }
    if (reducedMotion) {
      setDisplay(finalStr);
      return;
    }

    const durationMs = 1900;
    let start: number | null = null;

    const frame = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const e = easeOutCubic(t);
      const n = config.end * e;
      setDisplay(formatUp(n, config.end, config.suffix, config.prefix));

      if (t < 1) rafRef.current = requestAnimationFrame(frame);
      else setDisplay(finalStr);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, reducedMotion, config, finalStr]);

  return (
    <div className="max-w-[min(100%,16rem)]">
      <p
        className="tabular-nums text-[clamp(3.6rem,9.4vw,6.8rem)] font-extralight leading-none tracking-[-0.04em] text-white"
        aria-live="polite"
      >
        {display}
      </p>
      <p className="mt-5 text-[13px] font-normal normal-case leading-snug text-white/85 md:text-sm">
        {config.label}
      </p>
    </div>
  );
}

export const proofStatConfigs: ProofStatConfig[] = [
  {
    id: "setups",
    mode: "up",
    end: 100,
    suffix: "k",
    label: "Setups to train a model",
  },
  {
    id: "years",
    mode: "up",
    end: 50,
    suffix: "",
    label: "Years of historic stock market data",
  },
  {
    id: "assets",
    mode: "up",
    end: 1000,
    suffix: "+",
    label: "Trainable assets",
  },
  {
    id: "clicks",
    mode: "up",
    end: 20,
    suffix: "",
    prefix: "<",
    label: "Clicks to generate your own CNN-bot",
  },
  {
    id: "loc",
    mode: "up",
    end: 0,
    suffix: "",
    label: "Lines of code",
  },
  {
    id: "analysis",
    mode: "up",
    end: 24,
    suffix: "/7",
    label: "Bot analysis",
  },
];

export function VisionProofStats({
  active,
  reducedMotion,
}: {
  active: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className="mt-16 grid grid-cols-2 justify-items-center gap-x-10 gap-y-20 text-center md:grid-cols-3 md:gap-y-24">
      {proofStatConfigs.map((row) => (
        <VisionProofStatCell key={row.id} config={row} active={active} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}
