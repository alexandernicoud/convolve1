import { create } from 'zustand';
import {
  runsApi,
  GlobalRun,
  trainingChartGeneratorApi,
  trainerApi,
  labelingOptimizerApi,
  realtimeBacktesterApi,
  backtesterApi,
  testDataGeneratorApi
} from '@/lib/api';

interface RunsState {
  runsById: Record<string, GlobalRun>;
  activeRunIds: string[];
  isPolling: boolean;
}

interface RunsActions {
  refreshActiveRuns: () => Promise<void>;
  mergeRunsFromBackendList: (limit?: number) => Promise<void>;
  refreshRun: (runId: string) => Promise<void>;
  registerRun: (run: Omit<GlobalRun, 'created_at' | 'updated_at'>) => void;
  updateRun: (runId: string, updates: Partial<GlobalRun>) => void;
  removeRun: (runId: string) => void;
  getRunRoute: (run: GlobalRun) => string;
  clearRunHistory: () => void;
  clearStaleRuns: () => Promise<void>;
  clearAllRuns: () => void;
  reconcileRunsWithBackend: (options?: { concurrency?: number }) => Promise<void>;
}

type RunsStore = RunsState & RunsActions;

/** Rewrite historical labeling-optimizer plural `/runs/` paths that 404 in the SPA. */
function sanitizeRunRoute(run: GlobalRun): GlobalRun {
  if (run.tool !== "labeling-optimizer") return run;
  const route = run.route || "";
  if (!route.includes("/labeling-optimizer/runs/")) return run;
  const fixed =
    run.status === "succeeded" || run.status === "failed"
      ? `/products/labeling-optimizer/results/${run.id}`
      : `/products/labeling-optimizer/run/${run.id}`;
  return { ...run, route: fixed };
}

// Load persisted runs from localStorage
const loadPersistedRuns = () => {
  try {
    const persisted = localStorage.getItem('convolve_runs');
    const parsed = persisted ? JSON.parse(persisted) : { runsById: {}, activeRunIds: [] };
    const raw = parsed?.runsById || {};
    const runsById: Record<string, GlobalRun> = {};
    for (const [id, run] of Object.entries(raw)) {
      runsById[id] = sanitizeRunRoute(run as GlobalRun);
    }
    const activeRunIds = Array.isArray(parsed?.activeRunIds) ? parsed.activeRunIds : [];
    const cleanedActiveRunIds = activeRunIds.filter((id: string) => {
      const run = runsById[id];
      return run && (run.status === 'running' || run.status === 'queued');
    });
    return { runsById, activeRunIds: cleanedActiveRunIds };
  } catch {
    return { runsById: {}, activeRunIds: [] };
  }
};

// Save runs to localStorage
const savePersistedRuns = (runsById: Record<string, GlobalRun>, activeRunIds: string[]) => {
  try {
    localStorage.setItem('convolve_runs', JSON.stringify({ runsById, activeRunIds }));
  } catch (error) {
    console.warn('Failed to save runs to localStorage:', error);
  }
};

const FINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

const normalizeProgress = (value: number | undefined) => {
  if (value === undefined || value === null || Number.isNaN(value)) return 0;
  return value > 1 ? Math.min(1, value / 100) : Math.max(0, Math.min(1, value));
};

const mapPhaseToStatus = (phase: string | undefined) => {
  const normalized = (phase || '').toLowerCase();
  if (['done', 'completed', 'succeeded', 'success'].includes(normalized)) return 'succeeded';
  if (['error', 'failed'].includes(normalized)) return 'failed';
  if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
  return 'running';
};

export const useRunsStore = create<RunsStore>((set, get) => ({
  ...loadPersistedRuns(),
  isPolling: false,

  getRunRoute: (run: GlobalRun): string => {
    switch (run.tool) {
      case 'labeling-optimizer':
        // Never use run.route here — older backends stored plural `/runs/` which 404s.
        if (run.status === 'succeeded' || run.status === 'failed') {
          return `/products/labeling-optimizer/results/${run.id}`;
        }
        if (run.status === 'running' || run.status === 'queued') {
          return `/products/labeling-optimizer/run/${run.id}`;
        }
        return `/products/labeling-optimizer/results/${run.id}`;
      case 'training-chart-generator':
        return run.id ? `/tools/generator/runs/${encodeURIComponent(run.id)}` : '/tools/generator';
      case 'trainer':
        return run.id ? `/tools/trainer/runs/${encodeURIComponent(run.id)}` : '/tools/trainer';
      case 'analysis': {
        const tr = run.trainer_run_id ?? run.parent_run_id ?? undefined;
        const aid = run.analysis_id ?? undefined;
        if (run.route) return run.route;
        if (tr && aid && !run.parent_run_id) {
          return `/products/trainer/analysis/${tr}/${aid}`;
        }
        if (tr) return `/tools/trainer/runs/${tr}/analysis`;
        return '/tools/analysis';
      }
      case 'backtester':
        // Has dedicated run/results page
        return `/tools/backtester/runs/${run.id}`;
      case 'testdata':
        // No dedicated results page — the backtester page resumes/show results via runId
        return `/tools/backtester${run.id ? `?runId=${encodeURIComponent(run.id)}` : ''}`;
      default:
        return '/';
    }
  },

  mergeRunsFromBackendList: async (limit?: number) => {
    try {
      const { runs } = await runsApi.listRuns(limit ?? 200);
      set((state) => {
        const mergedRunsById = { ...state.runsById };
        for (const r of runs) {
          mergedRunsById[r.id] = sanitizeRunRoute(r);
        }
        const active = new Set<string>();
        for (const r of Object.values(mergedRunsById)) {
          if (r.status === 'running' || r.status === 'queued') active.add(r.id);
        }
        const activeRunIds = [...active];
        savePersistedRuns(mergedRunsById, activeRunIds);
        return { runsById: mergedRunsById, activeRunIds };
      });
    } catch (error) {
      console.error('Failed to merge runs from backend:', error);
    }
  },

  refreshActiveRuns: async () => {
    try {
      set({ isPolling: true });
      const response = await runsApi.getActiveRuns();
      const newRunsById: Record<string, GlobalRun> = {};
      const newActiveRunIds: string[] = [];

      response.runs.forEach(run => {
        newRunsById[run.id] = run;
        newActiveRunIds.push(run.id);
      });

      // Merge with existing persisted runs
      set(state => {
        const mergedRunsById = { ...state.runsById, ...newRunsById };
        const mergedActiveRunIds = [...state.activeRunIds.filter(id => !newActiveRunIds.includes(id)), ...newActiveRunIds];

        // Save to localStorage
        savePersistedRuns(mergedRunsById, mergedActiveRunIds);

        return {
          runsById: mergedRunsById,
          activeRunIds: mergedActiveRunIds,
          isPolling: false
        };
      });
    } catch (error) {
      console.error('Failed to fetch active runs:', error);
      set({ isPolling: false });
    }
  },

  refreshRun: async (runId: string) => {
    try {
      const run = await runsApi.getRun(runId);
      set(state => {
        const newRunsById = {
          ...state.runsById,
          [runId]: run,
        };
        const newActiveRunIds = run.status === 'running' || run.status === 'queued'
          ? [...state.activeRunIds.filter(id => id !== runId), runId]
          : state.activeRunIds.filter(id => id !== runId);

        // Save to localStorage
        savePersistedRuns(newRunsById, newActiveRunIds);

        return {
          runsById: newRunsById,
          activeRunIds: newActiveRunIds
        };
      });
    } catch (error) {
      console.error(`Failed to fetch run ${runId}:`, error);
    }
  },

  registerRun: (runData: Omit<GlobalRun, 'created_at' | 'updated_at'>) => {
    const now = Date.now() / 1000; // Unix timestamp
    const run: GlobalRun = {
      ...runData,
      created_at: now,
      updated_at: now,
    };

    set(state => {
      const newRunsById = {
        ...state.runsById,
        [run.id]: run,
      };
      const newActiveRunIds = run.status === 'running' || run.status === 'queued'
        ? [...state.activeRunIds.filter(id => id !== run.id), run.id]
        : state.activeRunIds.filter(id => id !== run.id);

      // Save to localStorage
      savePersistedRuns(newRunsById, newActiveRunIds);

      return {
        runsById: newRunsById,
        activeRunIds: newActiveRunIds
      };
    });
  },

  updateRun: (runId: string, updates: Partial<GlobalRun>) => {
    set(state => {
      const existing = state.runsById[runId];
      if (!existing) return state;

      const incomingStatus = updates.status || existing.status;
      if (FINAL_STATUSES.has(existing.status) && !FINAL_STATUSES.has(incomingStatus)) {
        return state;
      }

      const nextProgress = updates.progress !== undefined
        ? Math.max(existing.progress || 0, updates.progress)
        : existing.progress;

      const updatedRun: GlobalRun = {
        ...existing,
        ...updates,
        status: incomingStatus,
        progress: nextProgress,
        updated_at: Date.now() / 1000
      };

      const newRunsById = {
        ...state.runsById,
        [runId]: updatedRun
      };

      const shouldBeActive = incomingStatus === 'running' || incomingStatus === 'queued';
      const newActiveRunIds = shouldBeActive
        ? [...state.activeRunIds.filter(id => id !== runId), runId]
        : state.activeRunIds.filter(id => id !== runId);

      savePersistedRuns(newRunsById, newActiveRunIds);
      return { runsById: newRunsById, activeRunIds: newActiveRunIds };
    });
  },

  removeRun: (runId: string) => {
    set(state => {
      if (!state.runsById[runId]) return state;
      const newRunsById = { ...state.runsById };
      delete newRunsById[runId];
      const newActiveRunIds = state.activeRunIds.filter(id => id !== runId);
      savePersistedRuns(newRunsById, newActiveRunIds);
      return { runsById: newRunsById, activeRunIds: newActiveRunIds };
    });
  },

  clearRunHistory: () => {
    set({ runsById: {}, activeRunIds: [] });
    savePersistedRuns({}, []);
  },

  clearStaleRuns: async () => {
    await get().reconcileRunsWithBackend();
    set(state => {
      const newActiveRunIds = state.activeRunIds.filter(id => {
        const run = state.runsById[id];
        return run && (run.status === 'running' || run.status === 'queued');
      });
      savePersistedRuns(state.runsById, newActiveRunIds);
      return { activeRunIds: newActiveRunIds };
    });
  },

  clearAllRuns: () => {
    set({ runsById: {}, activeRunIds: [] });
    savePersistedRuns({}, []);
  },

  reconcileRunsWithBackend: async (options) => {
    const concurrency = options?.concurrency ?? 4;
    const { runsById, activeRunIds } = get();
    const candidateIds = new Set<string>(
      activeRunIds.filter(id => {
        const run = runsById[id];
        return run && (run.status === 'running' || run.status === 'queued');
      })
    );
    Object.values(runsById).forEach(run => {
      if (run.status === 'running' || run.status === 'queued') {
        candidateIds.add(run.id);
      }
    });

    const runsToCheck = Array.from(candidateIds)
      .map(id => runsById[id])
      .filter(Boolean);

    const resolveRun = async (run: GlobalRun) => {
      const failAsStale = (message: string) => {
        get().updateRun(run.id, {
          status: 'failed',
          message,
          stage: 'stale',
          progress: Math.max(run.progress || 0, 0.01)
        });
      };

      try {
        switch (run.tool) {
          case 'training-chart-generator': {
            const data = await trainingChartGeneratorApi.getProgress(run.id);
            const status = mapPhaseToStatus(data.phase);
            get().updateRun(run.id, {
              status,
              progress: normalizeProgress(data.percent),
              stage: data.phase || 'running',
              message: data.error_message || data.phase || 'Running'
            });
            return;
          }
          case 'labeling-optimizer': {
            const data = await labelingOptimizerApi.getProgress(run.id);
            const status = mapPhaseToStatus(data.phase);
            get().updateRun(run.id, {
              status,
              progress: normalizeProgress(data.percent),
              stage: data.phase || 'running',
              message: data.error_message || data.phase || 'Running'
            });
            return;
          }
          case 'trainer': {
            const data = await trainerApi.getProgress(run.id);
            const status = data.status === 'done' ? 'succeeded' : (data.status === 'failed' ? 'failed' : data.status);
            get().updateRun(run.id, {
              status,
              progress: normalizeProgress(data.progress?.percent),
              stage: data.progress?.phase || 'running',
              message: data.progress?.message || data.progress?.phase || 'Running'
            });
            return;
          }
          case 'analysis': {
            const tr = run.trainer_run_id ?? run.parent_run_id;
            const analysisId = run.analysis_id;
            if (!tr || !analysisId) {
              failAsStale('Analysis run missing trainer or analysis id');
              return;
            }
            const data = await trainerApi.getAnalysisStatus(tr, analysisId);
            const status = data.status === 'done' ? 'succeeded' : (data.status === 'failed' ? 'failed' : data.status);
            get().updateRun(run.id, {
              status,
              progress: normalizeProgress(data.progress?.percent),
              stage: data.progress?.phase || 'running',
              message: data.progress?.message || data.progress?.phase || 'Running'
            });
            return;
          }
          case 'testdata': {
            const data = await testDataGeneratorApi.getStatus(run.id);
            get().updateRun(run.id, {
              status: data.status,
              progress: normalizeProgress(data.progress),
              stage: data.stage || 'running',
              message: data.message || 'Running'
            });
            return;
          }
          case 'backtester': {
            const isRealtime = run.id.includes('-');
            if (isRealtime) {
              const data = await realtimeBacktesterApi.getStatus(run.id);
              get().updateRun(run.id, {
                status: data.status,
                progress: normalizeProgress(data.progress),
                stage: data.message || 'running',
                message: data.message || 'Running'
              });
            } else {
              const data = await backtesterApi.getStatus(run.id);
              get().updateRun(run.id, {
                status: data.status === 'done' ? 'succeeded' : data.status,
                progress: normalizeProgress(data.progress),
                stage: data.stage || 'running',
                message: data.message || 'Running'
              });
            }
            return;
          }
          default:
            failAsStale('No progress resolver for this tool');
        }
      } catch (error: any) {
        const statusCode = error?.status || error?.response?.status;
        if (statusCode === 404) {
          failAsStale('Run not found (stale)');
        } else {
          failAsStale('Failed to verify run status');
        }
      }
    };

    const runQueue = runsToCheck.slice();
    const workers = Array.from({ length: Math.min(concurrency, runQueue.length) }, async () => {
      while (runQueue.length) {
        const next = runQueue.shift();
        if (next) {
          await resolveRun(next);
        }
      }
    });

    await Promise.all(workers);
  }
}));
