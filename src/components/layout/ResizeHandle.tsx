import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  /** "x" resizes a width from a right edge; "y" resizes a height from a bottom edge. */
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  step: number;
  label: string;
  onChange: (value: number, commit: boolean) => void;
  onDragChange?: (dragging: boolean) => void;
  className?: string;
};

/**
 * Drag, keyboard (arrows, Shift for larger steps, Home/End) and double-click/Enter reset.
 * Pointer capture keeps the drag on the handle so links underneath never receive the click.
 */
export function ResizeHandle({ axis, value, min, max, defaultValue, step, label, onChange, onDragChange, className }: Props) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const setBodyDragging = (on: boolean) => {
    const b = document.body.style;
    b.userSelect = on ? "none" : "";
    b.cursor = on ? (axis === "x" ? "col-resize" : "row-resize") : "";
  };

  const end = (e: React.PointerEvent) => {
    if (!start.current) return;
    const delta = (axis === "x" ? e.clientX : e.clientY) - start.current.pos;
    onChange(start.current.value + delta, true);
    start.current = null;
    setDragging(false);
    onDragChange?.(false);
    setBodyDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}. Drag to resize, double-click to reset.`}
      className={cn(
        "group absolute z-20 touch-none outline-none",
        axis === "x" ? "inset-y-0 -right-[9px] w-[8px] cursor-col-resize" : "inset-x-3 -bottom-[9px] h-[8px] cursor-row-resize",
        className,
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: axis === "x" ? e.clientX : e.clientY, value };
        setDragging(true);
        onDragChange?.(true);
        setBodyDragging(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const delta = (axis === "x" ? e.clientX : e.clientY) - start.current.pos;
        onChange(start.current.value + delta, false);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(defaultValue, true)}
      onKeyDown={(e) => {
        const big = e.shiftKey ? step * 3 : step;
        const grow = axis === "x" ? "ArrowRight" : "ArrowDown";
        const shrink = axis === "x" ? "ArrowLeft" : "ArrowUp";
        let next: number | null = null;
        if (e.key === grow) next = value + big;
        else if (e.key === shrink) next = value - big;
        else if (e.key === "Home") next = min;
        else if (e.key === "End") next = max;
        else if (e.key === "Enter") next = defaultValue;
        if (next == null) return;
        e.preventDefault();
        onChange(next, true);
      }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-full bg-white/0 transition-colors duration-150",
          "group-hover:bg-white/30 group-focus-visible:bg-white/50",
          dragging && "bg-white/50",
          axis === "x" ? "inset-y-6 left-1/2 w-[2px] -translate-x-1/2" : "inset-x-10 top-1/2 h-[2px] -translate-y-1/2",
        )}
      />
    </div>
  );
}
