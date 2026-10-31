import { fetchApi } from "@/lib/api";
import { useApi } from "@/features/account/data";
import { readError } from "@/features/account/ui";
import type { BillingCatalog, BillingHistory, BillingState, RefundQuote, RefundRecord } from "./model";

export const useBillingCatalog = () => useApi<BillingCatalog>("/api/billing/catalog");
export const useBillingState = () => useApi<BillingState>("/api/billing/state");
export const useBillingHistory = () => useApi<BillingHistory>("/api/billing/history");

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export type CheckoutResult = { provider: string; session_id: string; url: string };

export const startCheckout = (
  body: { kind: "subscription" | "topup"; item_id: string; country: string; withdrawal_waived: boolean },
  requestId: string,
) => post<CheckoutResult>("/api/billing/checkout", body, { "Idempotency-Key": requestId });

export const completeSimulatedCheckout = (sessionId: string) =>
  post<{ outcomes: string[] }>("/api/billing/simulator/complete", { session_id: sessionId });

export const changePlan = (tierId: string) =>
  post<{ change: "upgrade" | "downgrade" | "none"; tier_id: string; effective?: string; credits_added?: number }>(
    "/api/billing/change-plan",
    { tier_id: tierId },
  );

export const setCancel = (cancel: boolean) =>
  post<{ cancel_at_period_end: boolean; access_until: string }>("/api/billing/cancel", { cancel });

export async function fetchRefundQuote(): Promise<RefundQuote> {
  const res = await fetchApi("/api/billing/refund-quote");
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as RefundQuote;
}

export const cancelAndRefund = (requestId: string, expected: Record<string, number>) =>
  post<{ request_id: string; refunds: RefundRecord[]; replayed: boolean; renewal_stopped?: boolean }>(
    "/api/billing/cancel-and-refund",
    { request_id: requestId, expected },
  );

export const openPortal = () => post<{ url: string }>("/api/billing/portal", {});
