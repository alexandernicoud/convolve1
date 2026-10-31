import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders that mirror the real layout in flat monochrome geometry.
 *
 * Every placeholder group sits inside `LoadingRegion`, which announces "Loading …" once to
 * screen readers (`role="status"`, `aria-busy`) and hides the shapes themselves. Motion is
 * a slow opacity breath and stops entirely under `prefers-reduced-motion`.
 *
 * Skeletons only stand in for content that has not arrived. They never replace real
 * progress (training epochs, run status) and never hide an error: use `AsyncBoundary`
 * to keep loading, empty, failed and loaded states distinct.
 */

export function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("rounded-md bg-white/[0.06] motion-safe:animate-skeleton", className)} style={style} />;
}

export function LoadingRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden className={className}>
        {children}
      </div>
    </div>
  );
}

const WIDTHS = ["w-11/12", "w-9/12", "w-10/12", "w-7/12", "w-8/12"];

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} className={cn("h-3", i === lines - 1 ? "w-5/12" : WIDTHS[i % WIDTHS.length])} />
      ))}
    </div>
  );
}

export function SkeletonStatGrid({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.07] px-4 py-3.5">
          <Bone className="h-6 w-16" />
          <Bone className="mt-2 h-2.5 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Rows of a list or table: leading mark, two text lines, trailing value. */
export function SkeletonRows({ rows = 5, className, trailing = true }: { rows?: number; className?: string; trailing?: boolean }) {
  return (
    <ul className={cn("divide-y divide-white/[0.06]", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-4 py-3.5">
          <Bone className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className={cn("h-3", WIDTHS[i % WIDTHS.length])} style={{ maxWidth: 280 }} />
            <Bone className="h-2.5 w-32" />
          </div>
          {trailing && <Bone className="h-3 w-14 shrink-0" />}
        </li>
      ))}
    </ul>
  );
}

export function SkeletonTable({ rows = 6, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-white/[0.07]", className)}>
      <div className="grid gap-4 border-b border-white/[0.07] px-4 py-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }, (_, i) => (
          <Bone key={i} className="h-2.5 w-16" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="grid gap-4 border-b border-white/[0.04] px-4 py-3.5 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Bone key={c} className={cn("h-3", c === 0 ? "w-10/12" : "w-7/12")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Grid of library cards (models, datasets, bots): thumbnail, title, meta line. */
export function SkeletonCards({ count = 6, className, thumb = true }: { count?: number; className?: string; thumb?: boolean }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-4">
          {thumb && <Bone className="mb-4 aspect-[16/9] w-full rounded-xl" />}
          <Bone className="h-3.5 w-8/12" />
          <Bone className="mt-2.5 h-2.5 w-5/12" />
          <div className="mt-4 flex gap-2">
            <Bone className="h-5 w-14 rounded-full" />
            <Bone className="h-5 w-10 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A chart frame: axis baseline and flat bars of fixed heights (no fake data shape). */
export function SkeletonChart({ className, height = 160 }: { className?: string; height?: number }) {
  return (
    <div className={cn("rounded-xl border border-white/[0.07] p-4", className)}>
      <Bone className="h-3 w-28" />
      <div className="mt-4 flex items-end gap-[3px]" style={{ height }}>
        <Bone className="h-full w-full rounded-lg" />
      </div>
    </div>
  );
}

/** A titled panel (account cards, analysis panels) with rows of label/value pairs. */
export function SkeletonPanel({ rows = 3, className, title = true }: { rows?: number; className?: string; title?: boolean }) {
  return (
    <div className={cn("rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5 sm:p-7", className)}>
      {title && <Bone className="mb-6 h-4 w-40" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between border-t border-white/[0.06] py-3.5 first:border-t-0 first:pt-0">
          <Bone className="h-3 w-24" />
          <Bone className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A square image placeholder (charts, Grad-CAM maps). */
export function SkeletonImage({ className }: { className?: string }) {
  return <Bone className={cn("aspect-square w-full rounded-xl", className)} />;
}

/** After this long a loading state says so and offers a retry instead of spinning on. */
export const SLOW_AFTER_MS = 15_000;

export function useSlow(loading: boolean, after = SLOW_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), after);
    return () => window.clearTimeout(t);
  }, [loading, after]);
  return slow;
}

export function LoadFailed({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("rounded-xl border border-red-400/20 bg-red-500/[0.03] px-4 py-4 text-sm", className)}>
      <p className="text-red-200/90">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-white/70 underline underline-offset-2 hover:text-white">
          Try again
        </button>
      )}
    </div>
  );
}

export function SlowNotice({ onRetry }: { onRetry?: () => void }) {
  return (
    <p className="mt-3 text-xs text-white/45">
      This is taking longer than usual.{" "}
      {onRetry && (
        <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-white">
          Retry
        </button>
      )}
    </p>
  );
}

type AsyncState<T> = { data: T | null; error: string | null; loading: boolean; reload?: () => void };

/**
 * Loading, empty, failed and loaded stay four distinct states:
 * - first load: the skeleton (plus a "slow" notice and retry after SLOW_AFTER_MS);
 * - error with no data: the error and a retry, never a skeleton;
 * - error after data: the data stays and the error is shown above it;
 * - loaded but empty: the `empty` content.
 */
export function AsyncBoundary<T>({
  state,
  label,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  state: AsyncState<T>;
  label: string;
  skeleton: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const slow = useSlow(state.loading && state.data == null);
  if (state.data == null) {
    if (state.error) return <LoadFailed message={state.error} onRetry={state.reload} />;
    return (
      <>
        <LoadingRegion label={label}>{skeleton}</LoadingRegion>
        {slow && <SlowNotice onRetry={state.reload} />}
      </>
    );
  }
  return (
    <>
      {state.error && <LoadFailed message={`Could not refresh: ${state.error}`} onRetry={state.reload} className="mb-3" />}
      {empty !== undefined && isEmpty?.(state.data) ? empty : children(state.data)}
    </>
  );
}
