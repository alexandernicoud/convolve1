import type { CSSProperties } from "react";
import logoMark from "@/assets/convolve-mark.png";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** When true, uses the workspace accent fill; marketing should leave this false. */
  accented?: boolean;
  title?: string;
  style?: CSSProperties;
};

/**
 * Convolve mark as a mask so the silhouette can take currentColor / accent without image filters.
 * Source PNG is near-white on transparent — mask preserves the recognizable shape.
 */
export function ConvolveMark({ className, accented = true, title, style }: Props) {
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn(accented ? "accent-brand bg-white" : "bg-white", className)}
      style={{
        display: "inline-block",
        WebkitMaskImage: `url(${logoMark})`,
        maskImage: `url(${logoMark})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}
