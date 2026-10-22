import { Archive, Search, Star, Tag as TagIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { ReviewLabelFields } from "@/lib/api";
import { Chip, cx } from "./primitives";

export interface LibraryFilter<T> {
  q: string;
  setQ: (v: string) => void;
  activeTags: string[];
  toggleTag: (t: string) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  favOnly: boolean;
  setFavOnly: (v: boolean) => void;
  allTags: string[];
  archivedCount: number;
  filtered: T[];
}

export function useLibraryFilter<T extends ReviewLabelFields>(
  items: T[],
  haystack: (t: T) => string,
  extra?: (t: T) => boolean,
): LibraryFilter<T> {
  const [q, setQ] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [favOnly, setFavOnly] = useState(false);

  const allTags = useMemo(() => [...new Set(items.flatMap((i) => i.tags ?? []))].sort((a, b) => a.localeCompare(b)), [items]);
  const archivedCount = useMemo(() => items.filter((i) => i.archived).length, [items]);

  const filtered = useMemo(() => {
    const needles = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => {
      if (!showArchived && i.archived) return false;
      if (favOnly && !i.favorite) return false;
      if (extra && !extra(i)) return false;
      if (activeTags.length) {
        const lower = (i.tags ?? []).map((x) => x.toLowerCase());
        if (!activeTags.every((t) => lower.includes(t.toLowerCase()))) return false;
      }
      if (needles.length) {
        const hay = `${haystack(i)} ${(i.tags ?? []).join(" ")} ${i.notes ?? ""}`.toLowerCase();
        if (!needles.every((n) => hay.includes(n))) return false;
      }
      return true;
    });
  }, [items, q, activeTags, showArchived, favOnly, haystack, extra]);

  return {
    q,
    setQ,
    activeTags,
    toggleTag: (t) => setActiveTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t])),
    showArchived,
    setShowArchived,
    favOnly,
    setFavOnly,
    allTags,
    archivedCount,
    filtered,
  };
}

export function LibraryToolbar<T>({
  f,
  noun,
  total,
  children,
  right,
}: {
  f: LibraryFilter<T>;
  noun: string;
  total: number;
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[260px] max-w-md flex-1">
          <span className="sr-only">Search {noun}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            value={f.q}
            onChange={(e) => f.setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && f.setQ("")}
            placeholder={`Search ${noun} by name, symbol, id, tag or note`}
            className="h-9 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] pl-9 pr-3 text-[13.5px] text-white placeholder:text-white/35 transition focus:border-white/30 focus:bg-white/[0.05] focus:outline-none"
          />
        </label>
        {children}
        <span className="mx-1 hidden h-5 w-px bg-white/[0.1] sm:block" aria-hidden />
        <Chip active={f.favOnly} onClick={() => f.setFavOnly(!f.favOnly)}>
          <Star className={cx("h-3.5 w-3.5", f.favOnly && "fill-white")} />
          Favorites
        </Chip>
        <Chip active={f.showArchived} onClick={() => f.setShowArchived(!f.showArchived)}>
          <Archive className="h-3.5 w-3.5" />
          Archived <span className="font-digits tabular-nums text-white/40">{f.archivedCount}</span>
        </Chip>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-digits text-[13px] tabular-nums text-white/45">
            {f.filtered.length === total ? total : `${f.filtered.length} of ${total}`} {total === 1 ? noun.replace(/s$/, "") : noun}
          </span>
          {right}
        </div>
      </div>
      {f.allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <TagIcon className="h-3.5 w-3.5 text-white/35" aria-hidden />
          {f.allTags.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={f.activeTags.includes(t)}
              onClick={() => f.toggleTag(t)}
              className={cx(
                "rounded-md border px-2 py-0.5 text-[12.5px] transition",
                f.activeTags.includes(t) ? "border-white/40 bg-white/10 text-white" : "border-white/[0.1] text-white/55 hover:text-white/90",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
