import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { yfinanceSearch, type YFinanceSearchRow } from "@/lib/api";
import FieldTip from "@/components/generator/FieldTip";

type Props = {
  selectedSymbols: string[];
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  /** Tooltip text for the label; defaults to the generator wording. */
  tipText?: string;
  /** Field label. Defaults to "Symbols" (or "Symbol" when maxSymbols === 1). */
  label?: string;
  /**
   * Cap on selected tickers. When at capacity, adding another symbol still calls
   * `onAdd` so the parent can replace (typical for single-symbol tools).
   */
  maxSymbols?: number;
};

/**
 * Yahoo Finance-style symbol search with suggestion dropdown + selected-ticker chips.
 * Shared by the training Generator page and the test dataset generator.
 */
export default function SymbolBasket({
  selectedSymbols,
  onAdd,
  onRemove,
  tipText,
  label,
  maxSymbols,
}: Props) {
  const [symbolDraft, setSymbolDraft] = useState("");
  const [symbolSuggestions, setSymbolSuggestions] = useState<YFinanceSearchRow[]>([]);
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const single = maxSymbols === 1;
  const fieldLabel = label ?? (single ? "Symbol" : "Symbols");

  useEffect(() => {
    const q = symbolDraft.trim();
    if (q.length < 1) {
      setSymbolSuggestions([]);
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        setSymbolSearchLoading(true);
        try {
          const rows = await yfinanceSearch(q, 12);
          setSymbolSuggestions(rows);
        } catch {
          setSymbolSuggestions([]);
        } finally {
          setSymbolSearchLoading(false);
        }
      })();
    }, 280);
    return () => window.clearTimeout(t);
  }, [symbolDraft]);

  const addSymbol = useCallback(
    (raw: string) => {
      const s = raw.trim().toUpperCase().replace(/\s+/g, "");
      if (!s) return;
      onAdd(s);
      setSymbolDraft("");
      setSymbolSearchOpen(false);
      setSymbolSuggestions([]);
    },
    [onAdd],
  );

  return (
    <div className="relative">
      <label className="mb-2 flex items-center text-sm text-[#F5F5F5]/62">
        {fieldLabel} <span className="text-[#e5e5e5]">*</span>
        <FieldTip
          text={
            tipText ??
            (single
              ? "The actual stock ticker (e.g. AAPL for Apple). Search by company or ticker, pick a suggestion, or press Enter. Choosing another replaces the current one."
              : "The actual stock tickers to chart (e.g. AAPL, MSFT). Search by company or ticker, pick a suggestion, or press Enter. Duplicates are ignored.")
          }
        />
      </label>
      <div className="relative mt-2 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            type="text"
            value={symbolDraft}
            onChange={(e) => {
              setSymbolDraft(e.target.value);
              setSymbolSearchOpen(true);
            }}
            onFocus={() => setSymbolSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSymbolSearchOpen(false), 180)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const q = symbolDraft.trim().toUpperCase();
                if (symbolSuggestions[0]) addSymbol(symbolSuggestions[0].symbol);
                else if (q) addSymbol(q.replace(/[^A-Z0-9.-]/g, ""));
              }
            }}
            className="w-full rounded-lg border border-white/8 bg-[#0a0a0a]/60 py-2 pl-9 pr-3 text-[#F5F5F5] placeholder:text-white/30 focus:border-white/30 focus:ring-1 focus:ring-white/50"
            placeholder={single ? "e.g. AAPL or Apple" : "Search a stock — e.g. AAPL or Apple"}
            autoComplete="off"
          />
          {symbolSearchOpen && (symbolSuggestions.length > 0 || symbolSearchLoading) ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-white/10 bg-[#0f0f0f] py-1 shadow-lg">
              {symbolSearchLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching…
                </div>
              ) : (
                symbolSuggestions.map((row) => {
                  const already = selectedSymbols.includes(row.symbol.toUpperCase());
                  const atCap =
                    !already &&
                    typeof maxSymbols === "number" &&
                    maxSymbols > 1 &&
                    selectedSymbols.length >= maxSymbols;
                  const disabled = already || atCap;
                  return (
                    <button
                      key={row.symbol}
                      type="button"
                      disabled={disabled}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                        disabled ? "cursor-default bg-white/[0.04] opacity-60" : "hover:bg-white/10"
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (!disabled) addSymbol(row.symbol);
                      }}
                    >
                      <span className="mt-0.5 shrink-0">
                        {already ? (
                          <Check className="h-4 w-4 text-white/70" aria-hidden />
                        ) : (
                          <span className="inline-block h-4 w-4 rounded border border-white/20" aria-hidden />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-white">{row.symbol}</span>
                          {already ? (
                            <span className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/75">
                              {single ? "Selected" : "In basket"}
                            </span>
                          ) : null}
                          {atCap ? (
                            <span className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/75">
                              Limit reached
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-white/55">{row.name}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-white/12 bg-white/[0.06] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
            {single ? "Selected ticker" : `Selected tickers (${selectedSymbols.length})`}
          </span>
        </div>
        {selectedSymbols.length === 0 ? (
          <p className="text-xs text-white/45">
            {single
              ? "None yet — search for a real stock (e.g. AAPL) above."
              : "None yet — add real stock tickers (e.g. AAPL, MSFT) above."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedSymbols.map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/[0.08] px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/90"
              >
                {sym}
                <button
                  type="button"
                  className="rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
                  onClick={() => onRemove(sym)}
                  aria-label={`Remove ${sym}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
