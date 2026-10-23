import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFleet, type FleetPayload, type FleetRange } from "./api";

const POLL_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;

export interface FleetState {
  data: FleetPayload | null;
  /** Client time of the last successful response. */
  okAt: number | null;
  error: string | null;
  errorAt: number | null;
  loading: boolean;
  /** Dev-only fixture name when `?fixture=` is set; never active in production builds. */
  fixture: string | null;
  refresh: () => void;
}

function fixtureName(): string | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("fixture");
}

async function loadFixture(name: string, range: FleetRange): Promise<FleetPayload> {
  const mod = import.meta.env.DEV ? await import("./fixtureLoader") : null;
  if (!mod) throw new Error("Fixtures are only available in development builds.");
  return mod.loadFixture(name, range);
}

/** Polls the fleet endpoint, keeps the last good payload on failure and backs off while failing. */
export function useFleet(range: FleetRange): FleetState {
  const [data, setData] = useState<FleetPayload | null>(null);
  const [okAt, setOkAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const failures = useRef(0);
  const fixture = useRef(fixtureName()).current;
  const failAfterFirst = useRef(import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("simulateError")).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const loadedOnce = useRef(false);

  const run = useCallback(async () => {
    const my = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    try {
      if (failAfterFirst && loadedOnce.current) throw new Error("Simulated API failure (dev fixture)");
      const p = fixture ? await loadFixture(fixture, range) : await fetchFleet(range);
      if (my !== seq.current) return;
      setData(p);
      setOkAt(Date.now());
      setError(null);
      setErrorAt(null);
      failures.current = 0;
      loadedOnce.current = true;
    } catch (e) {
      if (my !== seq.current) return;
      failures.current += 1;
      setError(e instanceof Error ? e.message.slice(0, 200) : "Request failed");
      setErrorAt(Date.now());
    } finally {
      if (my === seq.current) {
        setLoading(false);
        const delay = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.max(0, failures.current - 1));
        if (!fixture || failAfterFirst) timer.current = setTimeout(run, failAfterFirst ? 3000 : delay);
      }
    }
  }, [range, fixture, failAfterFirst]);

  useEffect(() => {
    setLoading(true);
    void run();
    return () => {
      seq.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run]);

  return { data, okAt, error, errorAt, loading, fixture, refresh: () => void run() };
}
