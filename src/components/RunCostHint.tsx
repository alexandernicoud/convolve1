import { RUN_COST } from "@/state/creditsStore";

type Props = {
  className?: string;
};

/** Small credit price under a run button. */
export function RunCostHint({ className = "" }: Props) {
  return (
    <p className={`text-center text-[10px] leading-none tabular-nums text-white/38 ${className}`}>
      {RUN_COST} credits
    </p>
  );
}
