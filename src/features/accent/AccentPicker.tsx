import { cn } from "@/lib/utils";
import { ACCENT_HEX, ACCENT_OPTIONS, CHART_ACCENT_HEX, type AccentId } from "./model";
import { useAccent } from "./AccentProvider";
import { ConvolveMark } from "@/components/brand/ConvolveMark";

/** Pale accent swatches + live preview of button, chart and brand. */
export function AccentPicker({ className, label = "Accent colour" }: { className?: string; label?: string }) {
  const { accent, setAccent } = useAccent();
  const previewBtn = ACCENT_HEX[accent];
  const previewChart = CHART_ACCENT_HEX[accent];

  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="text-[12px] font-medium text-white/70">{label}</legend>
      <p className="text-[12.5px] leading-relaxed text-white/45">
        Soft pale accents for primary buttons, the logo, navigation highlights and charts. Panels and borders stay
        neutral grey. Default is the original Convolve look.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {ACCENT_OPTIONS.map((o) => {
          const on = accent === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={`${o.label}: ${o.description}`}
              onClick={() => setAccent(o.id as AccentId)}
              className={cn(
                "convolve-press flex min-w-[6.25rem] items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition",
                on ? "border-white/45 bg-white/[0.08]" : "border-white/12 bg-white/[0.02] hover:border-white/25",
              )}
            >
              <span
                className="h-6 w-6 shrink-0 rounded-full border border-white/25 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]"
                style={{ background: o.swatch }}
                aria-hidden
              />
              <span className="text-[12.5px] font-medium text-white/85">{o.label}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/[0.1] bg-black/40 px-3 py-3" aria-live="polite">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">Preview</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <ConvolveMark className="h-9 w-9" />
          <button
            type="button"
            tabIndex={-1}
            className="inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-semibold"
            style={{ background: previewBtn, color: "#0a0a0a" }}
          >
            Launch Bot
          </button>
          <svg width="88" height="28" viewBox="0 0 88 28" aria-hidden className="overflow-visible">
            <path
              d="M2 22 C 18 20, 22 8, 36 12 S 58 26, 72 10 S 82 6, 86 8"
              fill="none"
              stroke={previewChart}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <circle cx="72" cy="10" r="2.5" fill={previewChart} />
          </svg>
          <span className="text-[13px] font-medium" style={{ color: accent === "default" ? "rgba(255,255,255,0.85)" : previewChart }}>
            Highlighted value
          </span>
        </div>
        <p className="mt-2 text-[11.5px] text-white/35">Borders and panel chrome stay grey in every theme.</p>
      </div>
    </fieldset>
  );
}
