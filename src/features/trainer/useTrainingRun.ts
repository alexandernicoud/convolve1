import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, trainerApi, type TrainerProgressResponse } from "@/lib/api";
import { useRunsStore } from "@/state/runsStore";
import { isTerminal, nextPollDelay, storeStatus } from "./lib";

export type Connection = "restoring" | "live" | "reconnecting" | "not_found" | "forbidden";

/**
 * Server-authoritative view of one training run. Polls GET /trainer/runs/{id} until a terminal
 * status, backs off on network errors (keeping the last good data), and never starts or alters a run.
 */
export function useTrainingRun(runId: string | undefined) {
  const [data, setData] = useState<TrainerProgressResponse | null>(null);
  const [connection, setConnection] = useState<Connection>("restoring");
  const [failures, setFailures] = useState(0);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const stopped = useRef(false);
  const generation = useRef(0);

  const fetchOnce = useCallback(async (): Promise<boolean> => {
    if (!runId) return false;
    const gen = generation.current;
    try {
      const resp = await trainerApi.getProgress(runId);
      if (gen !== generation.current) return false;
      setData(resp);
      setConnection("live");
      failuresRef.current = 0;
      setFailures(0);
      setLastOkAt(Date.now() / 1000);
      const store = useRunsStore.getState();
      if (store.runsById[runId]) {
        store.updateRun(runId, {
          status: storeStatus(resp.status),
          progress: typeof resp.progress?.percent === "number" ? Math.min(1, Math.max(0, resp.progress.percent / 100)) : 0,
          stage: resp.progress?.phase || "running",
          message: resp.progress?.message || resp.progress?.phase || "Running",
        });
      }
      // A cancelled in-process run keeps its worker until the current epoch ends.
      return !isTerminal(resp.status) || resp.session?.worker_active === true;
    } catch (err) {
      if (gen !== generation.current) return false;
      if (err instanceof ApiError && err.status === 404) {
        setConnection("not_found");
        return false;
      }
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setConnection("forbidden");
        return false;
      }
      failuresRef.current += 1;
      setFailures(failuresRef.current);
      setConnection((c) => (c === "restoring" ? "restoring" : "reconnecting"));
      return true;
    }
  }, [runId]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        if (stopped.current) return;
        const keepGoing = await fetchOnce();
        if (keepGoing && !stopped.current) schedule(nextPollDelay(failuresRef.current, document.hidden));
      }, delay);
    },
    [fetchOnce],
  );

  useEffect(() => {
    generation.current += 1;
    stopped.current = false;
    failuresRef.current = 0;
    setData(null);
    setConnection("restoring");
    setFailures(0);
    if (!runId) return;
    schedule(0);
    const onVisible = () => {
      if (!document.hidden && !stopped.current) schedule(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped.current = true;
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runId, schedule]);

  /** Resume polling after a terminal state was optimistic (e.g. cancel) or after a manual retry. */
  const refresh = useCallback(() => {
    stopped.current = false;
    schedule(0);
  }, [schedule]);

  const cancel = useCallback(async () => {
    if (!runId) return;
    await trainerApi.cancelRun(runId);
    refresh();
  }, [runId, refresh]);

  const resume = useCallback(async () => {
    if (!runId) return;
    await trainerApi.resumeRun(runId);
    const store = useRunsStore.getState();
    if (store.runsById[runId]) store.updateRun(runId, { status: "running", stage: "queued", message: "Resuming from checkpoint" });
    refresh();
  }, [runId, refresh]);

  return { data, connection, failures, lastOkAt, refresh, cancel, resume };
}
