import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { runButtonCost, type QuoteResponse } from "@/features/credits/model";
import { fetchRunQuote, useCreditsStore, type RunParams } from "@/state/creditsStore";

type Props = {
  tool: string;
  /** The run's configuration as the server prices it (see backend ``app/pricing.py``). */
  params?: RunParams;
  className?: string;
};

const QUOTE_TTL_MS = 5_000;
const quotes = new Map<string, { at: number; quote: Promise<QuoteResponse | null> }>();

/** One server request per configuration, shared by the button label and the note below it. */
function sharedQuote(tool: string, key: string): Promise<QuoteResponse | null> {
  const id = `${tool}|${key}`;
  const hit = quotes.get(id);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.quote;
  const quote = fetchRunQuote(tool, JSON.parse(key) as RunParams);
  quotes.set(id, { at: Date.now(), quote });
  return quote;
}

/** Live server quote for ``params``; refetched (debounced) whenever the configuration changes. */
export function useRunQuote(tool: string, params: RunParams | undefined): { quote: QuoteResponse | null; loading: boolean } {
  const key = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      void sharedQuote(tool, key).then((q) => {
        if (cancelled) return;
        setQuote(q);
        setLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [tool, key]);
  return { quote, loading };
}

/** The server's price for this configuration, for use inside a run button's label. */
export function RunCost({ tool, params }: Props) {
  const { quote, loading } = useRunQuote(tool, params);
  return <span className="font-normal tabular-nums opacity-60">({runButtonCost(quote, loading)})</span>;
}

/** One line under a run button: whether credits are charged, and how the price is formed. */
export function RunCostHint({ tool, params, className = "" }: Props) {
  const loaded = useCreditsStore((s) => s.loaded);
  const refresh = useCreditsStore((s) => s.refresh);
  const { quote } = useRunQuote(tool, params);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  if (!quote || quote.cost <= 0) return null;
  const p = quote.pricing;
  const enforced = quote.mode === "enforce";
  const status = enforced
    ? quote.sufficient
      ? quote.balance != null
        ? `Balance ${quote.balance} → ${Math.max(quote.balance - quote.cost, 0)}`
        : null
      : "Your balance does not cover this run."
    : "Credits are not charged during the beta.";

  return (
    <div data-help="credits-estimate" className={`text-[11px] leading-relaxed text-white/40 ${className}`} aria-live="polite">
      <span className={enforced && !quote.sufficient ? "text-red-300" : undefined}>{status}</span>{" "}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="underline decoration-white/20 underline-offset-2 hover:text-white/70"
        aria-expanded={open}
      >
        How it's priced
      </button>
      {open ? (
        <span className="mt-1 block">
          <span className="font-mono text-white/55">{p.formula}</span>
          {p.clamped ? `, capped at ${p.bounds[1]} credits` : ""}.{" "}
          {p.kind === "fixed"
            ? "Fixed when you start."
            : "One input is not known yet; the exact price is set when you start, and you are asked again if it is higher."}{" "}
          Failed runs are refunded.{" "}
          <Link to="/help#credits" className="underline decoration-white/20 underline-offset-2 hover:text-white/70">
            Policy {p.version}
          </Link>
        </span>
      ) : null}
    </div>
  );
}
