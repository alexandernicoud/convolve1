import { useEffect } from "react";
import { describeCost } from "@/features/credits/model";
import { useCreditsStore } from "@/state/creditsStore";

type Props = {
  tool: string;
  className?: string;
};

/** Server price for one run of ``tool``, under its run button. */
export function RunCostHint({ tool, className = "" }: Props) {
  const loaded = useCreditsStore((s) => s.loaded);
  const mode = useCreditsStore((s) => s.mode);
  const cost = useCreditsStore((s) => s.costOf(tool));
  const refresh = useCreditsStore((s) => s.refresh);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  if (!loaded) return null;
  return (
    <p className={`text-center text-[10px] leading-none tabular-nums text-white/38 ${className}`}>{describeCost(mode, cost)}</p>
  );
}
