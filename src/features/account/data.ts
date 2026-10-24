import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import type { CreditSummary, PlanCatalogue, PlanState } from "@/features/credits/model";
import { readError } from "./ui";

export type AccountProfile = {
  email: string | null;
  display_name: string | null;
  created_at: string | null;
  terms: {
    terms_version: string | null;
    privacy_version: string | null;
    accepted_at: string | null;
    current_terms_version: string;
    current_privacy_version: string;
  };
  plan: PlanState;
  counts: { runs: number; datasets: number; models: number; bots: number };
};

export type RunSummary = {
  id: string;
  tool: string;
  label: string;
  status: string;
  route: string | null;
  created_at: string | null;
  finished_at: string | null;
  error_summary: string | null;
};

export type Usage = {
  totals: { runs: number; succeeded: number; failed: number; cancelled: number; active: number };
  by_tool: {
    tool: string;
    label: string;
    runs: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    active: number;
    duration_seconds: number;
  }[];
  weekly: { week: string; runs: number }[];
  recent: RunSummary[];
  resources: { datasets: number; models: number; bots: number; active_bots: number; run_seconds: number };
};

export type Loadable<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

export function useApi<T>(path: string): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchApi(path)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return (await res.json()) as T;
      })
      .then((body) => {
        if (!live) return;
        setData(body);
        setError(null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, tick]);

  return { data, error, loading, reload };
}

export const useProfile = () => useApi<AccountProfile>("/api/account");
export const useUsage = () => useApi<Usage>("/api/account/usage");
export const useCreditSummary = () => useApi<CreditSummary>("/api/credits");
export const usePlans = () => useApi<PlanCatalogue>("/api/plans");

export function runHref(run: RunSummary): string | null {
  return run.route && run.route.startsWith("/") ? run.route : null;
}
