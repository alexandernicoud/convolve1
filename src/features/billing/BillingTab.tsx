import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AsyncBoundary, SkeletonPanel, SkeletonRows, SkeletonStatGrid } from "@/components/skeleton/Skeleton";
import { useCreditsStore } from "@/state/creditsStore";
import { cn } from "@/lib/utils";
import { Button, Card, Empty, Notice, Row, Stat, formatDate } from "@/features/account/ui";
import { BetaBenefitsCard } from "@/features/beta/BetaBenefitsCard";
import {
  cancelAndRefund,
  changePlan,
  completeSimulatedCheckout,
  fetchRefundQuote,
  newRequestId,
  openPortal,
  setCancel,
  startCheckout,
  useBillingCatalog,
  useBillingHistory,
  useBillingState,
} from "./api";
import {
  BASIS_LABELS,
  PENDING_CHECKOUT_KEY,
  REFUND_CLARIFIER,
  REFUND_HEADLINE,
  REFUND_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  WITHDRAWAL_COUNTRIES,
  cancellationConsequences,
  checkoutConfirmed,
  countryOptions,
  describeQuota,
  formatMinor,
  formatTierPrice,
  itemName,
  percent,
  quotaLabel,
  tierById,
  type BillingCatalog,
  type BillingState,
  type Pack,
  type PendingCheckout,
  type RefundQuote,
  type Tier,
} from "./model";

type Msg = { kind: "ok" | "error" | "info"; text: string } | null;

/** Plan & Billing while billing is on (sandbox or live). */
export function BillingTab() {
  const catalog = useBillingCatalog();
  const state = useBillingState();
  const history = useBillingHistory();
  const refreshCredits = useCreditsStore((s) => s.refresh);
  const reloadAll = () => {
    state.reload();
    history.reload();
    void refreshCredits();
  };

  return (
    <div className="space-y-6">
      {catalog.data?.mode === "sandbox" && (
        <p className="rounded-xl border border-white/[0.09] px-4 py-3 text-xs leading-relaxed text-white/55">
          Sandbox: payments use the provider's test mode and never charge a card. Prices shown are proposals pending approval.
        </p>
      )}
      <BetaBenefitsCard freeBeta={false} />
      <SimulatedCheckout onDone={reloadAll} provider={state.data?.provider ?? null} />
      <CheckoutReturn state={state.data} reload={reloadAll} />
      <AsyncBoundary
        state={{ data: catalog.data && state.data ? { c: catalog.data, s: state.data } : null, error: catalog.error ?? state.error, loading: catalog.loading || state.loading, reload: () => (catalog.reload(), state.reload()) }}
        label="Loading subscription"
        skeleton={
          <div className="space-y-6">
            <SkeletonPanel rows={4} />
            <SkeletonStatGrid count={4} />
          </div>
        }
      >
        {({ c, s }) => (
          <>
            <SubscriptionCard catalog={c} state={s} onChanged={reloadAll} />
            <CreditsCard catalog={c} state={s} onChanged={reloadAll} />
            {s.subscription.active && !s.subscription.complimentary && <CancelCard catalog={c} state={s} onChanged={reloadAll} />}
          </>
        )}
      </AsyncBoundary>
      <Card title="Billing history" description="Payments and refunds. Refunds go back to the original payment method; banks can take several business days to show them.">
        <AsyncBoundary
          state={history}
          label="Loading billing history"
          skeleton={<SkeletonRows rows={3} />}
          isEmpty={(h) => h.payments.length === 0 && h.refunds.length === 0}
          empty={<Empty>No payments yet.</Empty>}
        >
          {(h) => (
            <ul className="divide-y divide-white/[0.06] text-sm">
              {h.refunds.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-white/85">
                      Refund of {r.credits} purchased credits · {percent(r.rate_bps)} of {formatMinor(r.unused_value_minor, r.currency)}
                    </div>
                    <div className="text-xs text-white/45">
                      {formatDate(r.created_at)} · {BASIS_LABELS[r.basis]}
                      {r.status === "failed" && r.failure_reason ? ` · ${r.failure_reason}` : ""}
                      {r.status === "pending" && r.attempts > 1 ? " · retrying automatically" : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusPill status={r.status} />
                    <span className="tabular-nums text-white/85">−{formatMinor(r.amount_minor, r.currency)}</span>
                  </div>
                </li>
              ))}
              {h.payments.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-white/85">{p.kind === "subscription" ? `${itemName(p.item_id)} subscription` : `${itemName(p.item_id)} credit pack`}</div>
                    <div className="text-xs text-white/45">
                      {formatDate(p.created_at)}
                      {p.refunded_minor > 0 ? ` · ${formatMinor(p.refunded_minor, p.currency)} refunded` : ""}
                      {p.status === "disputed" ? " · disputed" : ""}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-white/85">{formatMinor(p.amount_minor, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </AsyncBoundary>
      </Card>
    </div>
  );
}

function StatusPill({ status }: { status: "pending" | "succeeded" | "failed" }) {
  const tone = { pending: "border-white/20 text-white/70", succeeded: "border-[#a6ecc8]/40 text-[#a6ecc8]", failed: "border-red-300/40 text-red-200" }[status];
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>{REFUND_STATUS_LABELS[status]}</span>;
}

/** Sandbox stand-in for the provider's hosted payment page. */
function SimulatedCheckout({ provider, onDone }: { provider: string | null; onDone: () => void }) {
  const [params, setParams] = useSearchParams();
  const sid = params.get("simulated_checkout");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  if (!sid || provider !== "simulator") return null;
  const clear = () => {
    params.delete("simulated_checkout");
    setParams(params, { replace: true });
  };
  const pay = async () => {
    setBusy(true);
    try {
      await completeSimulatedCheckout(sid);
      clear();
      onDone();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Test payment failed" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Test payment" description="This sandbox simulates the payment provider. No card is charged and no money moves.">
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => void pay()} disabled={busy}>
          {busy ? "Processing…" : "Complete test payment"}
        </Button>
        <Button onClick={clear} disabled={busy}>
          Cancel payment
        </Button>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </Card>
  );
}

function readPending(): PendingCheckout | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_CHECKOUT_KEY) || "null") as PendingCheckout | null;
    return p && Date.now() - p.at < 24 * 3600e3 ? p : null;
  } catch {
    return null;
  }
}

/** Back from the payment page: the provider's confirmation (webhook) can arrive after the redirect. */
function CheckoutReturn({ state, reload }: { state: BillingState | null; reload: () => void }) {
  const [params, setParams] = useSearchParams();
  const result = params.get("checkout");
  const [pending] = useState(readPending);
  const [timedOut, setTimedOut] = useState(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const confirmed = Boolean(state && (pending ? checkoutConfirmed(pending, state) : state.subscription.active));

  useEffect(() => {
    if (result !== "success" || confirmed) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > 90_000) {
        setTimedOut(true);
        window.clearInterval(id);
        return;
      }
      reloadRef.current();
    }, 3000);
    return () => window.clearInterval(id);
  }, [result, confirmed]);

  useEffect(() => {
    if (result === "success" && confirmed) sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
  }, [result, confirmed]);

  const dismiss = () => {
    params.delete("checkout");
    setParams(params, { replace: true });
  };
  if (result !== "success" && result !== "cancel") return null;
  const text =
    result === "cancel"
      ? "Payment cancelled. Nothing was charged."
      : confirmed
        ? "Payment confirmed. Your plan and credits are updated below."
        : timedOut
          ? "Your payment is still being confirmed by the payment provider. Refresh this page in a few minutes; please don't pay again."
          : "Payment received. Confirming with the payment provider…";
  return (
    <div role="status" className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.09] px-4 py-3 text-sm text-white/75">
      <span>{text}</span>
      {(result === "cancel" || confirmed || timedOut) && (
        <button type="button" onClick={dismiss} className="shrink-0 text-xs text-white/50 underline-offset-4 hover:text-white hover:underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

function CountrySelect({ value, onChange, blocked }: { value: string; onChange: (v: string) => void; blocked: string[] }) {
  const options = useMemo(() => countryOptions(blocked), [blocked]);
  return (
    <label className="block text-sm text-white/60">
      Billing country
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 block w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-white/40 focus:outline-none sm:max-w-xs"
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.code} value={o.code} disabled={o.blocked}>
            {o.name}
            {o.blocked ? " (not yet available)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function useCheckout(onChanged: () => void, purchaseBefore: number) {
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const busy = busyItem !== null;
  const setBusy = (on: boolean, itemId: string | null = null) => setBusyItem(on ? itemId : null);
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && setBusyItem(null);
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  const go = async (kind: "subscription" | "topup", itemId: string, country: string, waived: boolean) => {
    if (!country) return setMsg({ kind: "error", text: "Select your billing country first." });
    setBusy(true, itemId);
    setMsg(null);
    try {
      const out = await startCheckout({ kind, item_id: itemId, country, withdrawal_waived: waived }, newRequestId());
      const pending: PendingCheckout = { kind, item_id: itemId, purchase_before: purchaseBefore, at: Date.now() };
      sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pending));
      if (out.url.startsWith("/")) {
        window.history.pushState(null, "", out.url);
        window.dispatchEvent(new PopStateEvent("popstate"));
        onChanged();
        setBusy(false);
      } else {
        // Stays busy while the browser leaves for the payment page.
        window.location.assign(out.url);
      }
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Checkout could not start" });
      setBusy(false);
    }
  };
  return { busy, busyItem, msg, go, setMsg };
}

function SubscriptionCard({ catalog, state, onChanged }: { catalog: BillingCatalog; state: BillingState; onChanged: () => void }) {
  const sub = state.subscription;
  const tier = tierById(catalog, sub.tier_id);
  const pending = tierById(catalog, sub.pending_tier_id);
  const [country, setCountry] = useState(sub.country ?? "");
  const checkout = useCheckout(onChanged, state.balances.purchase);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [params] = useSearchParams();
  const wanted = tierById(catalog, params.get("plan"))?.id ?? null;
  const wantedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (wanted) wantedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [wanted]);

  const change = async (t: Tier) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await changePlan(t.id);
      setMsg({
        kind: "ok",
        text:
          out.change === "upgrade"
            ? `Upgraded to ${t.name}. ${out.credits_added ?? 0} additional credits were added for this period.`
            : out.change === "downgrade"
              ? `${t.name} starts at your next renewal. You keep your current plan until then.`
              : "No change.",
      });
      onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not change plan" });
    } finally {
      setBusy(false);
    }
  };

  const portal = async () => {
    try {
      window.location.assign((await openPortal()).url);
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Not available" });
    }
  };

  if (!sub.active || sub.complimentary) {
    return (
      <Card
        title="Choose a plan"
        description={
          sub.complimentary
            ? `Your free month of ${tier?.name ?? "Research"} runs until ${formatDate(sub.period_end)}. It is a reward, so it does not renew and nothing is charged. Subscribe to keep research tools after that.`
            : sub.status === "expired"
              ? "Your subscription has ended. Everything you created stays available to view; research tools need an active plan."
              : "Creating an account and browsing are free. Running research tools needs a subscription."
        }
      >
        <CountrySelect value={country} onChange={setCountry} blocked={state.blocked_countries} />
        <div className={cn("mt-5 grid gap-4 sm:grid-cols-2", catalog.tiers.length >= 3 && "xl:grid-cols-3")}>
          {catalog.tiers.map((t) => (
            <div
              key={t.id}
              ref={t.id === wanted ? wantedRef : undefined}
              className={cn("flex flex-col rounded-xl border p-4", t.id === wanted ? "border-[#a6ecc8]/50 bg-white/[0.03]" : "border-white/[0.09]")}
            >
              {t.id === wanted && <p className="mb-1 text-[11px] text-[#a6ecc8]">Your choice</p>}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] text-white">{t.name}</span>
                <span className="whitespace-nowrap text-sm tabular-nums text-white/80">{formatTierPrice(t.price)}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-white/50">{t.summary}</p>
              <p className="mt-3 text-xs text-white/60">{t.monthly_credits.toLocaleString("en-US")} credits every month</p>
              <p className="mt-3 text-[11px] leading-relaxed text-white/40">
                Renews automatically every month at {formatTierPrice(t.price)} until you cancel. Cancel any time here; access continues to the end of the paid month.
              </p>
              <div className="mt-4">
                <Button
                  variant={!wanted || t.id === wanted ? "primary" : "secondary"}
                  disabled={checkout.busy}
                  onClick={() => void checkout.go("subscription", t.id, country, false)}
                >
                  {checkout.busyItem === t.id ? "Opening secure checkout…" : `Subscribe to ${t.name}`}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-white/45">Have a discount code? Enter it on the payment page.</p>
        {checkout.msg && <Notice kind={checkout.msg.kind}>{checkout.msg.text}</Notice>}
      </Card>
    );
  }

  const others = catalog.tiers.filter((t) => t.id !== tier?.id);
  return (
    <Card
      title="Subscription"
      action={
        state.provider === "stripe" ? (
          <button type="button" onClick={() => void portal()} className="shrink-0 text-sm text-white/55 underline-offset-4 hover:text-white hover:underline">
            Payment method & invoices
          </button>
        ) : undefined
      }
    >
      <Row label="Plan">{tier?.name ?? sub.tier_id}</Row>
      <Row label="Status">{SUBSCRIPTION_STATUS_LABELS[sub.status] ?? sub.status}</Row>
      <Row label="Price">{tier ? formatTierPrice(tier.price) : "—"}</Row>
      <Row label={sub.cancel_at_period_end ? "Access until" : "Renews on"}>{formatDate(sub.period_end)}</Row>
      {pending && <Row label="Scheduled change">{`${pending.name} from ${formatDate(sub.period_end)}`}</Row>}
      {sub.status === "past_due" && (
        <Notice kind="error">The last renewal payment failed. Update your payment method to keep access after {formatDate(sub.period_end)}.</Notice>
      )}
      {Object.keys(state.entitlements.quotas).length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          {Object.entries(state.entitlements.quotas).map(([k, q]) => (
            <Stat key={k} label={quotaLabel(k)} value={describeQuota(q)} hint={k === "backtests_per_period" ? "Resets at renewal" : undefined} />
          ))}
        </div>
      )}
      {others.length > 0 && !sub.cancel_at_period_end && (
        <div className="mt-5 flex flex-wrap gap-3">
          {others.map((t) => (
            <Button key={t.id} variant={t.id === wanted ? "primary" : undefined} disabled={busy} onClick={() => void change(t)}>
              {t.rank > (tier?.rank ?? 0) ? `Upgrade to ${t.name}` : `Switch to ${t.name} at renewal`} · {formatTierPrice(t.price)}
            </Button>
          ))}
        </div>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </Card>
  );
}

function CreditsCard({ catalog, state, onChanged }: { catalog: BillingCatalog; state: BillingState; onChanged: () => void }) {
  const b = state.balances;
  const [country, setCountry] = useState(state.subscription.country ?? "");
  const [waived, setWaived] = useState(false);
  const checkout = useCheckout(onChanged, b.purchase);
  const euUk = WITHDRAWAL_COUNTRIES.has(country);
  return (
    <section id="credits">
      <Card
        title="Credits"
        description="Monthly credits are used first and expire at the end of each billing period. Purchased credits are used after them and do not expire. Credits cannot be transferred or exchanged for money, except through the refund described below."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Available" value={b.total.toLocaleString()} />
          <Stat label="Monthly credits" value={b.subscription.toLocaleString()} hint={b.subscription_expires_at ? `Expire ${formatDate(b.subscription_expires_at)}` : undefined} />
          <Stat label="Purchased credits" value={b.purchase.toLocaleString()} hint="Do not expire" />
          <Stat label="Held by running jobs" value={b.reserved.toLocaleString()} hint="Returned if a run fails" />
        </div>
        {b.legacy > 0 && <p className="mt-3 text-xs text-white/45">{b.legacy} credits from the beta allowance are included in the total.</p>}
        {state.subscription.active ? (
          <div className="mt-6 border-t border-white/[0.06] pt-5">
            <h3 className="text-sm text-white/85">Buy extra credits</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Extra credits pay for more computation only. They do not unlock features or raise backtest and deployment limits.
            </p>
            <div className="mt-4">
              <CountrySelect value={country} onChange={setCountry} blocked={state.blocked_countries} />
            </div>
            {euUk && (
              <label className="mt-4 flex max-w-xl items-start gap-3 text-xs leading-relaxed text-white/60">
                <input type="checkbox" checked={waived} onChange={(e) => setWaived(e.target.checked)} className="mt-0.5" />
                <span>
                  I want the credits available immediately and understand that I lose my statutory right of withdrawal once I use any of them. Unchecked, you keep a{" "}
                  {catalog.refunds.withdrawal_days}-day right to a full refund of an unused pack.
                </span>
              </label>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {catalog.packs.map((p: Pack) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={checkout.busy}
                  onClick={() => void checkout.go("topup", p.id, country, waived)}
                  className="rounded-xl border border-white/[0.1] px-4 py-3.5 text-left transition hover:border-white/30 disabled:opacity-45"
                >
                  <div className="text-sm text-white">{p.name}</div>
                  <div className="mt-0.5 text-xs text-white/50">{p.credits.toLocaleString()} credits</div>
                  <div className="mt-2 text-sm tabular-nums text-white/85">{formatMinor(p.price.amount_minor, p.price.currency)}</div>
                </button>
              ))}
            </div>
            {checkout.msg && <Notice kind={checkout.msg.kind}>{checkout.msg.text}</Notice>}
          </div>
        ) : (
          <p className="mt-4 text-sm text-white/55">Extra credits can be bought with an active subscription.</p>
        )}
      </Card>
    </section>
  );
}

function CancelCard({ catalog, state, onChanged }: { catalog: BillingCatalog; state: BillingState; onChanged: () => void }) {
  const sub = state.subscription;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [refundOpen, setRefundOpen] = useState(false);

  const toggleRenewal = async (cancel: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await setCancel(cancel);
      setMsg({
        kind: "ok",
        text: cancel ? `Renewal stopped. You keep access until ${formatDate(out.access_until)}.` : "Renewal restarted.",
      });
      onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not update renewal" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Cancel" description={REFUND_HEADLINE(catalog.refunds.voluntary_rate_bps)}>
      <div className="flex flex-wrap gap-3">
        {sub.cancel_at_period_end ? (
          <Button disabled={busy} onClick={() => void toggleRenewal(false)}>
            Resume subscription
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void toggleRenewal(true)}>
            Cancel subscription
          </Button>
        )}
        {state.balances.purchase > 0 && (
          <Button disabled={busy} onClick={() => setRefundOpen(true)}>
            Cancel and refund unused purchased credits…
          </Button>
        )}
      </div>
      {state.balances.purchase === 0 && <p className="mt-3 text-xs text-white/45">You have no unused purchased credits to refund.</p>}
      <p className="mt-3 text-xs leading-relaxed text-white/45">
        {REFUND_CLARIFIER(catalog.refunds.voluntary_rate_bps)} Cancelling stops renewal; you keep access until {formatDate(sub.period_end)}.
        The exact refund is shown before you confirm.{" "}
        <Link to="/refunds" className="underline underline-offset-2 hover:text-white">
          Refund and Cancellation Policy
        </Link>
      </p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {refundOpen && (
        <RefundDialog
          state={state}
          onClose={() => setRefundOpen(false)}
          onDone={(text) => {
            setRefundOpen(false);
            setMsg({ kind: "ok", text });
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function RefundDialog({ state, onClose, onDone }: { state: BillingState; onClose: () => void; onDone: (msg: string) => void }) {
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(newRequestId);

  const load = () => {
    setError(null);
    fetchRefundQuote()
      .then(setQuote)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not calculate the refund"));
  };
  useEffect(load, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const expected = Object.fromEntries(quote.totals.map((t) => [t.currency, t.refund_minor]));
      const out = await cancelAndRefund(requestId, expected);
      const done = out.refunds.filter((r) => r.status === "succeeded").length;
      const pending = out.refunds.filter((r) => r.status === "pending").length;
      const failed = out.refunds.filter((r) => r.status === "failed").length;
      onDone(
        [
          done ? "The refund was sent to your original payment method. Your bank may take several business days to show it." : "",
          pending ? "The refund is being processed and retried automatically; its status appears in your billing history." : "",
          failed ? "The payment provider refused a refund; those credits were restored to your balance." : "",
          "Renewal is stopped; you keep access until the end of the paid period.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The refund could not be started");
      load();
    } finally {
      setBusy(false);
    }
  };

  const nothing = quote && quote.totals.every((t) => t.refund_minor <= 0);
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="refund-title"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/12 bg-[#0c0c0c] p-6"
      >
        <h2 id="refund-title" className="text-lg font-medium text-white">
          Cancel and refund unused purchased credits
        </h2>
        {!quote && !error && (
          <div className="mt-5">
            <SkeletonRows rows={2} trailing />
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        {quote && (
          <>
            {quote.lots.length === 0 ? (
              <p className="mt-4 text-sm text-white/60">There are no unused purchased credits to refund.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {quote.lots.map((l) => (
                  <div key={l.lot_id} className="rounded-xl border border-white/[0.08] p-3.5 text-sm">
                    <div className="flex justify-between gap-3 text-white/85">
                      <span>
                        {itemName(l.item_id)} · {formatDate(l.purchased_at)}
                      </span>
                      <span className="tabular-nums">{formatMinor(l.refund_minor, l.currency)}</span>
                    </div>
                    <dl className="mt-2 space-y-1 text-xs text-white/55">
                      <div className="flex justify-between">
                        <dt>Paid for {l.credits_total.toLocaleString()} credits</dt>
                        <dd className="tabular-nums">{formatMinor(l.amount_paid_minor, l.currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Unused value ({l.credits_unused.toLocaleString()} of {l.credits_total.toLocaleString()})</dt>
                        <dd className="tabular-nums">{formatMinor(l.unused_value_minor, l.currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>
                          {BASIS_LABELS[l.basis]}: {percent(l.rate_bps)}
                        </dt>
                        <dd className="tabular-nums text-white/85">{formatMinor(l.refund_minor, l.currency)}</dd>
                      </div>
                      {l.retained_minor > 0 && (
                        <div className="flex justify-between">
                          <dt>Retained ({percent(10000 - l.rate_bps)})</dt>
                          <dd className="tabular-nums">{formatMinor(l.retained_minor, l.currency)}</dd>
                        </div>
                      )}
                      {l.capped && <p>Limited to the part of this payment not already refunded.</p>}
                    </dl>
                  </div>
                ))}
                <div className="flex justify-between border-t border-white/[0.08] pt-3 text-sm text-white">
                  <span>Refund to your original payment method</span>
                  <span className="tabular-nums">{quote.totals.map((t) => formatMinor(t.refund_minor, t.currency)).join(" + ")}</span>
                </div>
              </div>
            )}
            <ul className="mt-5 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-white/55">
              {cancellationConsequences(quote, state).map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>Refunds are started immediately; how long your bank takes to show them is outside our control.</li>
            </ul>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" disabled={busy || Boolean(nothing)} onClick={() => void confirm()}>
                {busy ? "Refunding…" : "Confirm cancellation and refund"}
              </Button>
              <Button disabled={busy} onClick={onClose}>
                Keep everything
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
