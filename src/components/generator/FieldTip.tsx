import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Small inline info icon with a tooltip — shared by the generator-style forms. */
export default function FieldTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex align-middle text-[#F5F5F5]/45 hover:text-white"
          aria-label="Info"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="max-w-xs border border-white/10 bg-[#0a0a0a] text-xs text-neutral-200"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
