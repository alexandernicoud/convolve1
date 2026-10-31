import { useNavigate } from "react-router-dom";
import { X, AlertTriangle, Lock } from "lucide-react";
import { useCreditsStore } from "@/state/creditsStore";
import { formatMinor, quotaLabel } from "@/features/billing/model";

const TOOL_LABELS: Record<string, string> = {
  "training-chart-generator": "chart generation",
  trainer: "model training",
  analysis: "analysis",
  testdata: "test data generation",
  backtester: "a backtest",
  "labeling-optimizer": "the labeling optimizer",
};

/** Asks before a large run starts. Shows the price, the balance after the run, and whether charging is on. */
export function RunConfirmModal() {
  const quote = useCreditsStore((s) => s.confirming);
  const resolve = useCreditsStore((s) => s.resolveConfirm);
  if (!quote) return null;
  const p = quote.pricing;
  const enforced = quote.mode === "enforce";
  const toolLabel = TOOL_LABELS[quote.tool] ?? "this run";
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => resolve(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-confirm-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0c] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <h2 id="run-confirm-title" className="text-lg font-semibold text-white">
          Start {toolLabel}?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/65">
          This is a large configuration. Nothing runs until you confirm.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm">
          {p.lines.map((l) => (
            <div key={l.label}>
              <dt className="text-[10px] uppercase tracking-wide text-white/40">{l.label}</dt>
              <dd className="tabular-nums text-white/85">{l.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-white/40">Price</dt>
            <dd className="font-semibold tabular-nums text-white">{p.credits} credits</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-white/40">{enforced ? "Remaining after run" : "Charging"}</dt>
            <dd className="tabular-nums text-white/85">
              {enforced ? Math.max((quote.balance ?? 0) - quote.cost, 0) : "Off during beta"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-white/45">
          {enforced
            ? "The credits are deducted when the run is accepted and refunded in full if it fails."
            : "No credits are deducted while charging is off. The price shows the size of the computation."}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            autoFocus
            onClick={() => resolve(true)}
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
          >
            Start run
          </button>
          <button
            type="button"
            onClick={() => resolve(false)}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/10"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown when billing refuses an action: no subscription, a feature outside the plan, a used-up quota or country. */
export function BillingBlockModal() {
  const navigate = useNavigate();
  const block = useCreditsStore((s) => s.block);
  const close = useCreditsStore((s) => s.closeBlock);
  const freeBeta = useCreditsStore((s) => s.beta !== null);
  if (!block) return null;

  const title = {
    subscription_required: "A subscription is needed",
    feature_locked: block.code === "feature_locked" && block.required_tier_name ? `Included in ${block.required_tier_name}` : "Not included in your plan",
    quota_exceeded: block.code === "quota_exceeded" ? `${quotaLabel(block.quota)}: limit reached` : "Limit reached",
    country_restricted: "Not available in your country",
  }[block.code];
  const primary = freeBeta
    ? null
    : block.code === "subscription_required"
      ? { label: "See plans", to: "/products#pricing" }
      : block.code === "feature_locked" && block.required_tier_name
        ? { label: `Compare plans`, to: "/products#pricing" }
        : block.code === "quota_exceeded" && block.upgrade_tier_name
          ? { label: `Upgrade to ${block.upgrade_tier_name}`, to: "/account?tab=plan" }
          : null;
  const go = (to: string) => {
    close();
    navigate(to);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-block-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0c] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04]">
            <Lock className="h-5 w-5 text-white/70" />
          </span>
          <h2 id="billing-block-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-white/70">{block.message}</p>
        <p className="mt-2 text-xs text-white/45">Nothing was started and nothing was charged.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {primary && (
            <button
              type="button"
              autoFocus
              onClick={() => go(primary.to)}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              {primary.label}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown when the server refuses (or would refuse) a run for lack of credits. */
export default function CreditGuardModal() {
  const navigate = useNavigate();
  const open = useCreditsStore((s) => s.insufficientOpen);
  const balance = useCreditsStore((s) => s.balance);
  const pendingTool = useCreditsStore((s) => s.pendingTool);
  const shortfall = useCreditsStore((s) => s.shortfall);
  const packs = useCreditsStore((s) => s.packs);
  const costOf = useCreditsStore((s) => s.costOf);
  const close = useCreditsStore((s) => s.closeInsufficient);
  const freeBeta = useCreditsStore((s) => s.beta !== null);

  if (!open) return null;

  const toolLabel = pendingTool ? TOOL_LABELS[pendingTool] ?? "this run" : "this run";
  const cost = shortfall?.cost ?? (pendingTool ? costOf(pendingTool) : null);
  const have = shortfall?.balance ?? balance;
  const go = (to: string) => {
    close();
    navigate(to);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-guard-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0c] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            </span>
            <h2 id="credit-guard-title" className="text-lg font-semibold text-white">
              Not enough credits
            </h2>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-white/70">
            {cost != null && have != null ? (
              <>
                Starting {toolLabel} needs <span className="font-semibold text-white">{cost} credits</span>. Your balance is{" "}
                <span className="font-semibold text-red-300">{have}</span>.
              </>
            ) : (
              <>Your balance does not cover {toolLabel}.</>
            )}{" "}
            Nothing was started and nothing was charged.{" "}
            {freeBeta
              ? "Convolve is free during the public beta; contact us if this keeps happening."
              : packs
                ? "Buy extra credits, or wait for your next monthly credits."
                : "Paid plans are not available yet; see the plans page for what is planned, or contact us if you need more credits now."}
          </p>

          {!freeBeta && packs && packs.length > 0 && (
            <ul className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] text-sm">
              {packs.map((p) => (
                <li key={p.id} className="flex justify-between px-3.5 py-2.5 text-white/75">
                  <span>
                    {p.name} · {p.credits.toLocaleString()} credits
                  </span>
                  <span className="tabular-nums text-white/90">{formatMinor(p.price.amount_minor, p.price.currency)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => go(freeBeta ? "/contact" : packs ? "/account?tab=plan#credits" : "/products#pricing")}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              {freeBeta ? "Contact us" : packs ? "Buy credits" : "View plans"}
            </button>
            <button
              type="button"
              onClick={() => go("/account?tab=usage")}
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/10"
            >
              Usage &amp; credits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
