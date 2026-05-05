/** Compact visual hint for model attention / label mix — placeholder data, integration-ready shape. */
const demoLabels = [
  { k: "Long", pct: 38 },
  { k: "Short", pct: 27 },
  { k: "Neutral", pct: 35 },
];

export function ModelInsightPreview() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-300">
        Label distribution
      </p>
      <div className="flex flex-1 min-h-0 flex-col justify-center gap-1">
        {demoLabels.map((row) => (
          <div key={row.k} className="flex items-center gap-2">
            <span className="w-16 shrink-0 font-digits text-[11px] font-medium text-white">{row.k}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-white/50 to-white/90"
                style={{ width: `${row.pct}%` }}
              />
            </div>
            <span className="w-8 text-right font-digits text-[11px] text-white/90">{row.pct}%</span>
          </div>
        ))}
      </div>
      <div
        className="mt-0.5 grid h-10 shrink-0 grid-cols-12 gap-px rounded-lg overflow-hidden border border-white/[0.07] opacity-95"
        style={{ background: "rgba(255,255,255,0.04)" }}
        title="Attention heatmap (preview)"
      >
        {Array.from({ length: 48 }).map((_, i) => {
          const heat = 0.15 + ((i * 17) % 11) / 20 + (i % 3) * 0.05;
          return (
            <div
              key={i}
              className="aspect-square min-h-0 bg-white"
              style={{ opacity: heat }}
            />
          );
        })}
      </div>
    </div>
  );
}
