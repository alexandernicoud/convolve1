import { Archive, ArchiveRestore, Check, Pencil, Plus, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LibraryLabelPatch, ReviewLabelFields } from "@/lib/api";
import { btn, cx, SectionLabel } from "./primitives";

/** Favorite toggle usable inside table rows. */
export function FavoriteToggle({ on, onToggle, disabled }: { on?: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={!!on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      className={cx("shrink-0 text-white/25 transition hover:text-white disabled:opacity-30", on && "text-white")}
    >
      <Star className={cx("h-3.5 w-3.5", on && "fill-white")} />
    </button>
  );
}

/** Rename, tags, favorite, archive and notes. Identity (ids) is never editable. */
export function LabelEditor({
  item,
  derivedName,
  onPatch,
}: {
  item: ReviewLabelFields;
  derivedName: string;
  onPatch: (p: LibraryLabelPatch) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.display_name ?? "");
  const [tag, setTag] = useState("");
  const [notes, setNotes] = useState(item.notes ?? "");

  useEffect(() => {
    setDraft(item.display_name ?? "");
    setNotes(item.notes ?? "");
  }, [item.display_name, item.notes]);

  const commitName = () => {
    const v = draft.trim();
    void onPatch({ display_name: v && v !== derivedName ? v : null });
    setEditing(false);
  };
  const addTag = () => {
    const v = tag.trim();
    if (v) void onPatch({ tags: [...new Set([...(item.tags ?? []), v])] });
    setTag("");
  };

  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>Display name</SectionLabel>
        {editing ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              autoFocus
              value={draft}
              placeholder={derivedName}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") setEditing(false);
              }}
              className="h-9 min-w-0 flex-1 rounded-lg border border-white/20 bg-white/[0.03] px-3 text-[14px] text-white focus:border-white/40 focus:outline-none"
            />
            <button type="button" className={btn} onClick={commitName} aria-label="Save name">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={btn} onClick={() => setEditing(false)} aria-label="Cancel">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[13.5px] text-white/85">{item.display_name || <span className="text-white/40">Derived from metadata</span>}</span>
            <button type="button" className={btn} onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" /> Rename
            </button>
            {item.display_name ? (
              <button type="button" className={btn} onClick={() => void onPatch({ display_name: null })}>
                Reset
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => void onPatch({ favorite: !item.favorite })} aria-pressed={!!item.favorite}>
          <Star className={cx("h-3.5 w-3.5", item.favorite && "fill-white")} /> {item.favorite ? "Favorited" : "Favorite"}
        </button>
        <button type="button" className={btn} onClick={() => void onPatch({ archived: !item.archived })} aria-pressed={!!item.archived}>
          {item.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          {item.archived ? "Unarchive" : "Archive"}
        </button>
      </div>

      <div>
        <SectionLabel>Tags</SectionLabel>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {(item.tags ?? []).map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded border border-white/[0.12] px-1.5 py-[1px] text-[12.5px] text-white/75">
              {t}
              <button
                type="button"
                aria-label={`Remove tag ${t}`}
                onClick={() => void onPatch({ tags: (item.tags ?? []).filter((x) => x !== t) })}
                className="text-white/35 hover:text-white"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1 rounded border border-dashed border-white/[0.14] px-1.5">
            <Plus className="h-2.5 w-2.5 text-white/35" />
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              onBlur={addTag}
              placeholder="add tag"
              aria-label="Add tag"
              className="w-20 bg-transparent py-[1px] text-[12.5px] text-white placeholder:text-white/30 focus:outline-none"
            />
          </span>
        </div>
      </div>

      <div>
        <SectionLabel>Research notes</SectionLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if ((item.notes ?? "") !== notes) void onPatch({ notes: notes.trim() ? notes : null });
          }}
          rows={3}
          placeholder="Observations, hypotheses, caveats… (saved on blur)"
          className="mt-1.5 w-full resize-y rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-[13.5px] leading-relaxed text-white/85 placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
      </div>
    </div>
  );
}
