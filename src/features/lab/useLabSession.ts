import { useCallback, useEffect, useRef, useState } from "react";
import { labApi, type ExperimentKind, type LabJob } from "./api";
import { isActive, latestByKind } from "./lib";

/**
 * Session state from the backend (the source of truth). Polls only while a job is queued/running;
 * results are fetched once per succeeded job and cached by job id.
 */
export function useLabSession(sessionId: string | null) {
  const [jobs, setJobs] = useState<LabJob[]>([]);
  const [results, setResults] = useState<Record<string, LabJob>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetching = useRef(new Set<string>());
  const sid = useRef(sessionId);
  sid.current = sessionId;

  const refresh = useCallback(async () => {
    const id = sid.current;
    if (!id) return;
    try {
      const res = await labApi.session(id);
      if (sid.current !== id) return;
      setJobs(res.jobs);
      setError(null);
      setLoaded(true);
      const kinds = new Set(res.jobs.map((j) => j.kind));
      for (const kind of kinds) {
        const { succeeded } = latestByKind(res.jobs, kind);
        if (succeeded && !fetching.current.has(succeeded.job_id)) {
          fetching.current.add(succeeded.job_id);
          labApi
            .job(id, succeeded.job_id)
            .then((full) => {
              if (sid.current === id) setResults((r) => ({ ...r, [full.job_id]: full }));
            })
            .catch(() => fetching.current.delete(succeeded.job_id));
        }
      }
    } catch (e) {
      if (sid.current !== id) return;
      setError(e instanceof Error ? e.message : "Could not load the session");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setJobs([]);
    setResults({});
    setError(null);
    setLoaded(!sessionId);
    fetching.current = new Set();
    if (sessionId) void refresh();
  }, [sessionId, refresh]);

  const anyActive = jobs.some(isActive);
  useEffect(() => {
    if (!sessionId || !anyActive) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 1500);
    return () => clearInterval(t);
  }, [sessionId, anyActive, refresh]);

  const forKind = useCallback(
    (kind: ExperimentKind) => {
      const { latest, succeeded } = latestByKind(jobs, kind);
      return { latest, result: succeeded ? results[succeeded.job_id]?.result ?? null : null, resultJob: succeeded };
    },
    [jobs, results],
  );

  return { jobs, forKind, refresh, error, loaded };
}

export type LabSessionState = ReturnType<typeof useLabSession>;
