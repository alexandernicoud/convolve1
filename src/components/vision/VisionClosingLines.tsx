import { useEffect, useState } from "react";

const LINE_TARGETS = [
  "Stop guessing.",
  "Research. Build. Deploy.",
  "Trade convolutional.*",
] as const;

const CHAR_MS = 24;
const LINE_PAUSE_MS = 380;

type Props = {
  active: boolean;
  reducedMotion: boolean;
};

function renderLine3(typed: string) {
  const base = "Trade convolutional";
  if (typed.length <= base.length) {
    return typed;
  }
  return (
    <>
      {base}
      <span className="text-white/90">{typed.slice(base.length)}</span>
    </>
  );
}

/**
 * Closing statements: sequential smooth typewriter; reduced motion shows full lines.
 */
export function VisionClosingLines({ active, reducedMotion }: Props) {
  const [line0, setLine0] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");

  useEffect(() => {
    if (!active) {
      setLine0("");
      setLine1("");
      setLine2("");
      return;
    }
    if (reducedMotion) {
      setLine0(LINE_TARGETS[0]);
      setLine1(LINE_TARGETS[1]);
      setLine2(LINE_TARGETS[2]);
      return;
    }

    let cancelled = false;

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const run = async () => {
      setLine0("");
      setLine1("");
      setLine2("");

      for (let li = 0; li < LINE_TARGETS.length; li++) {
        const target = LINE_TARGETS[li];
        for (let c = 1; c <= target.length; c++) {
          if (cancelled) return;
          await sleep(CHAR_MS);
          const slice = target.slice(0, c);
          if (li === 0) setLine0(slice);
          if (li === 1) setLine1(slice);
          if (li === 2) setLine2(slice);
        }
        if (li < LINE_TARGETS.length - 1 && !cancelled) {
          await sleep(LINE_PAUSE_MS);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [active, reducedMotion]);

  const lineClass = (i: number) =>
    i === 0
      ? "font-extralight leading-[1.06] tracking-[-0.03em] text-white [font-size:clamp(2.35rem,6vw,4.5rem)]"
      : i === 1
        ? "mt-6 font-extralight leading-[1.06] tracking-[-0.03em] text-white [font-size:clamp(2.35rem,6vw,4.5rem)] md:mt-8"
        : "mt-6 font-extralight leading-[1.04] tracking-[-0.03em] text-white [font-size:clamp(2.5rem,6.5vw,5rem)] md:mt-9";

  const typing = active && !reducedMotion && line2.length < LINE_TARGETS[2].length;
  const cursor = (
    <span className="ml-0.5 inline-block h-[0.85em] w-px animate-pulse bg-white/45 align-baseline" aria-hidden />
  );

  const showC0 =
    typing &&
    (line0.length < LINE_TARGETS[0].length ||
      (line0.length === LINE_TARGETS[0].length && line1.length === 0 && line2.length === 0));
  const showC1 =
    typing &&
    line0.length === LINE_TARGETS[0].length &&
    (line1.length < LINE_TARGETS[1].length ||
      (line1.length === LINE_TARGETS[1].length && line2.length === 0));
  const showC2 =
    typing && line1.length === LINE_TARGETS[1].length && line2.length < LINE_TARGETS[2].length;

  return (
    <div className="w-full text-center">
      <p className={lineClass(0)}>
        {line0}
        {showC0 ? cursor : null}
      </p>
      <p className={lineClass(1)}>
        {line1}
        {showC1 ? cursor : null}
      </p>
      <p className={lineClass(2)}>
        {line2.length > 0 ? renderLine3(line2) : null}
        {showC2 ? cursor : null}
      </p>
    </div>
  );
}
