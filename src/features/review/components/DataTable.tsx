import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cx, Hint, surface } from "./primitives";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sort key; null/undefined always sort last regardless of direction. */
  sort?: (row: T) => number | string | null | undefined;
  align?: "right";
  className?: string;
  hint?: string;
  /** Secondary column: only shown from this breakpoint up. */
  hideBelow?: "xl" | "2xl";
}

const HIDE = { xl: "hidden xl:table-cell", "2xl": "hidden 2xl:table-cell" } as const;

const PAGE = 150;

export function DataTable<T>({
  rows,
  rowKey,
  columns,
  activeKey,
  onActivate,
  selected,
  onToggleSelect,
  selectLabel = "Select for comparison",
  defaultSort,
  rowClassName,
  minWidth = 880,
  ariaLabel,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  activeKey?: string | null;
  onActivate?: (row: T) => void;
  selected?: Set<string>;
  onToggleSelect?: (row: T) => void;
  selectLabel?: string;
  defaultSort?: { id: string; dir: "asc" | "desc" };
  rowClassName?: (row: T) => string | undefined;
  minWidth?: number;
  ariaLabel: string;
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const [limit, setLimit] = useState(PAGE);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    const dir = sort!.dir === "asc" ? 1 : -1;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const na = va == null || va === "";
      const nb = vb == null || vb === "";
      if (na || nb) return na === nb ? 0 : na ? 1 : -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort, columns]);

  const visible = sorted.slice(0, limit);

  const toggleSort = (id: string) =>
    setSort((s) => (s?.id === id ? (s.dir === "desc" ? { id, dir: "asc" } : null) : { id, dir: "desc" }));

  const focusRow = (idx: number) => {
    const el = bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]")[idx];
    el?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T, idx: number) => {
    if ((e.target as HTMLElement).tagName !== "TR") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(Math.min(idx + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(Math.max(idx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onActivate?.(row);
    } else if (e.key === " " && onToggleSelect) {
      e.preventDefault();
      onToggleSelect(row);
    }
  };

  const onClick = (e: MouseEvent, row: T) => {
    if ((e.target as HTMLElement).closest("a,button,input,textarea,label")) return;
    onActivate?.(row);
  };

  return (
    <div className={cx(surface, "overflow-x-auto")}>
      <table className="w-full border-collapse text-left" style={{ minWidth }} aria-label={ariaLabel}>
        <thead>
          <tr className="border-b border-white/[0.1]">
            {onToggleSelect ? <th className="w-10 py-3 pl-5 pr-1" aria-label={selectLabel} /> : null}
            {columns.map((c) => {
              const active = sort?.id === c.id;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cx(
                    "whitespace-nowrap px-3 py-3 text-[12.5px] font-medium text-white/45 first:pl-5 last:pr-5",
                    c.align === "right" && "text-right",
                    c.hideBelow && HIDE[c.hideBelow],
                  )}
                >
                  <span className={cx("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className={cx("inline-flex items-center gap-1 transition hover:text-white/85 focus:outline-none focus-visible:text-white", active && "text-white")}
                      >
                        {c.header}
                        {active ? sort!.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" /> : null}
                      </button>
                    ) : (
                      c.header
                    )}
                    {c.hint ? <Hint text={c.hint} /> : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {visible.map((row, idx) => {
            const key = rowKey(row);
            const isActive = activeKey === key;
            const isSel = selected?.has(key) ?? false;
            return (
              <tr
                key={key}
                data-row
                tabIndex={0}
                aria-selected={isActive}
                onKeyDown={(e) => onKey(e, row, idx)}
                onClick={(e) => onClick(e, row)}
                className={cx(
                  "cursor-pointer border-b border-white/[0.06] outline-none transition-colors last:border-0",
                  isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03] focus-visible:bg-white/[0.04]",
                  "focus-visible:shadow-[inset_2px_0_0_rgba(255,255,255,0.7)]",
                  isActive && "shadow-[inset_2px_0_0_rgba(255,255,255,0.9)]",
                  rowClassName?.(row),
                )}
              >
                {onToggleSelect ? (
                  <td className="py-3 pl-5 pr-1 align-middle">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => onToggleSelect(row)}
                      aria-label={selectLabel}
                      className="block h-4 w-4 cursor-pointer appearance-none rounded border border-white/30 bg-transparent transition checked:border-white checked:bg-white hover:border-white/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
                    />
                  </td>
                ) : null}
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cx(
                      "px-3 py-3 align-middle text-[13.5px] text-white/85 first:pl-5 last:pr-5",
                      c.align === "right" && "text-right font-digits tabular-nums",
                      c.hideBelow && HIDE[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length > limit ? (
        <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-3 text-[13px] text-white/50">
          <span className="font-digits tabular-nums">
            Showing {limit} of {sorted.length}
          </span>
          <button type="button" className="font-medium text-white/75 hover:text-white" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </button>
        </div>
      ) : null}
    </div>
  );
}
