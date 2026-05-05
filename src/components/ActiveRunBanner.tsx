import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ChevronDown, Play, CheckCircle, XCircle, Clock, X, ExternalLink } from 'lucide-react';
import { useRunsStore } from '@/state/runsStore';
import { useHeaderReveal } from '@/context/HeaderRevealContext';

const DISMISSED_RUNS_KEY = 'convolve_dismissed_runs';

// Helper functions for sessionStorage
const getDismissedRuns = (): string[] => {
  try {
    const stored = sessionStorage.getItem(DISMISSED_RUNS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const setDismissedRuns = (runIds: string[]) => {
  try {
    sessionStorage.setItem(DISMISSED_RUNS_KEY, JSON.stringify(runIds));
  } catch (error) {
    console.warn('Failed to save dismissed runs to sessionStorage:', error);
  }
};

const addDismissedRun = (runId: string) => {
  const dismissed = getDismissedRuns();
  if (!dismissed.includes(runId)) {
    setDismissedRuns([...dismissed, runId]);
  }
};

const removeDismissedRun = (runId: string) => {
  const dismissed = getDismissedRuns();
  setDismissedRuns(dismissed.filter(id => id !== runId));
};

export default function ActiveRunBanner() {
  const { runsById, activeRunIds } = useRunsStore();
  const { compactShellTopPx } = useHeaderReveal();
  const [isExpanded, setIsExpanded] = useState(false);
  const [dismissedRunIds, setDismissedRunIds] = useState<string[]>(getDismissedRuns());
  const progressStuckTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Get visible (non-dismissed) active runs
  const visibleRuns = activeRunIds
    .map(runId => runsById[runId])
    .filter(run => run && run.status === 'running' && !dismissedRunIds.includes(run.id))
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

  // Track progress changes to detect stuck progress
  useEffect(() => {
    const now = Date.now();

    visibleRuns.forEach(run => {
      const timerKey = `progress_${run.id}`;
      const existingTimer = progressStuckTimers.current.get(timerKey);

      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set timer to mark progress as stuck after 3 seconds of no change
      const timer = setTimeout(() => {
        // Force re-render to show indeterminate animation
        setDismissedRunIds(prev => [...prev]); // Trigger re-render
      }, 3000);

      progressStuckTimers.current.set(timerKey, timer);
    });

    // Cleanup timers for runs that are no longer visible
    progressStuckTimers.current.forEach((timer, key) => {
      const runId = key.replace('progress_', '');
      if (!visibleRuns.find(run => run.id === runId)) {
        clearTimeout(timer);
        progressStuckTimers.current.delete(key);
      }
    });

    return () => {
      progressStuckTimers.current.forEach(timer => clearTimeout(timer));
      progressStuckTimers.current.clear();
    };
  }, [visibleRuns.map(run => `${run.id}_${run.progress}_${run.updated_at}`).join('|')]);

  // Cleanup dismissed runs when they complete
  useEffect(() => {
    activeRunIds.forEach(runId => {
      const run = runsById[runId];
      if (run && run.status !== 'running' && dismissedRunIds.includes(runId)) {
        removeDismissedRun(runId);
        setDismissedRunIds(prev => prev.filter(id => id !== runId));
      }
    });
  }, [activeRunIds, runsById, dismissedRunIds]);

  const handleDismiss = () => {
    // Add all currently visible runs to dismissed list
    visibleRuns.forEach(run => addDismissedRun(run.id));
    setDismissedRunIds(prev => [...prev, ...visibleRuns.map(run => run.id)]);
  };

  const handleRunClick = (runId: string) => {
    // Navigate to run log page with the running sessions section
    window.location.href = `/tools/run-log?highlight=${runId}`;
  };

  // Add shimmer animation styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      .shimmer-animation {
        animation: shimmer 1.5s ease-in-out infinite;
        background-size: 200% 100%;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Don't render if no visible runs
  if (visibleRuns.length === 0) {
    return null;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Play className="w-4 h-4 text-white animate-pulse" />;
      case 'succeeded':
        return <CheckCircle className="w-4 h-4 text-[#e5e5e5]" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'queued':
        return <Clock className="w-4 h-4 text-yellow-400" />;
      default:
        return <Play className="w-4 h-4 text-gray-400" />;
    }
  };

  const getToolLabel = (tool: string) => {
    switch (tool) {
      case 'labeling-optimizer':
        return 'Labeling Optimizer';
      case 'training-chart-generator':
        return 'Chart Generator';
      case 'trainer':
        return 'CNN Trainer';
      case 'analysis':
        return 'CNN Analysis';
      case 'backtester':
        return 'Backtester';
      default:
        return tool;
    }
  };

  const getStatusText = (run: any) => {
    if (run.status === 'succeeded') {
      return 'Completed — click to view results';
    }
    if (run.status === 'failed') {
      return 'Failed — click to view details';
    }
    if (run.status === 'running') {
      return run.stage || run.message || 'Running...';
    }
    if (run.status === 'queued') {
      return 'Queued';
    }
    return run.stage || run.message || 'Processing...';
  };

  const isProgressStuck = (run: any) => {
    const timerKey = `progress_${run.id}`;
    return progressStuckTimers.current.has(timerKey);
  };

  const ProgressBar = ({ run }: { run: any }) => {
    const progressPercent = Math.max(5, Math.min(100, run.progress * 100));
    const stuck = isProgressStuck(run);

    return (
      <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
        {stuck ? (
          // Indeterminate animation when stuck
          <div className="h-full rounded-full bg-gradient-to-r from-white/40 via-white to-white/40 shimmer-animation" />
        ) : (
          // Determinate progress
          <div
            className="h-full bg-white rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        )}
      </div>
    );
  };

  const CollapsedView = () => (
    <div className="flex items-center justify-between text-white">
      {/* Left: Status and count */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Play className="w-4 h-4 text-white animate-pulse" />
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full animate-ping" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {visibleRuns.length === 1
              ? getToolLabel(visibleRuns[0].tool)
              : `${visibleRuns.length} processes running`
            }
          </span>
          {visibleRuns.length === 1 && (
            <span className="text-white/70 text-sm">
              {visibleRuns[0].id.slice(-8)}
            </span>
          )}
        </div>
      </div>

      {/* Center: Status text */}
      <div className="flex-1 text-center text-sm text-white/90">
        {visibleRuns.length === 1
          ? getStatusText(visibleRuns[0])
          : `${visibleRuns.length} active processes`
        }
      </div>

      {/* Right: Progress and actions */}
      <div className="flex items-center gap-3">
        {visibleRuns.length === 1 && visibleRuns[0].status === 'running' && (
          <>
            <ProgressBar run={visibleRuns[0]} />
            <span className="text-sm font-medium min-w-[3ch]">
              {Math.round(visibleRuns[0].progress * 100)}%
            </span>
          </>
        )}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 hover:bg-white/10 rounded transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-white/70" />
          ) : (
            <ChevronRight className="w-4 h-4 text-white/70" />
          )}
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-white/10 rounded transition-colors"
          title="Hide banner"
        >
          <X className="w-4 h-4 text-white/70 hover:text-white" />
        </button>
      </div>
    </div>
  );

  const ExpandedView = () => (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Play className="w-4 h-4 text-white animate-pulse" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full animate-ping" />
          </div>
          <span className="font-medium">{visibleRuns.length} processes running</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <ChevronDown className="w-4 h-4 text-white/70" />
          </button>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Hide banner"
          >
            <X className="w-4 h-4 text-white/70 hover:text-white" />
          </button>
        </div>
      </div>

      {/* Run list */}
      <div className="space-y-2">
        {visibleRuns.map(run => (
          <div
            key={run.id}
            onClick={() => handleRunClick(run.id)}
            className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer border border-white/5 hover:border-white/10"
          >
            {/* Left: Status and tool */}
            <div className="flex items-center gap-3">
              {getStatusIcon(run.status)}
              <div>
                <div className="font-medium text-white text-sm">
                  {getToolLabel(run.tool)}
                </div>
                <div className="text-white/60 text-xs">
                  {run.id.slice(-8)}
                </div>
              </div>
            </div>

            {/* Center: Status text */}
            <div className="flex-1 text-center text-sm text-white/80">
              {getStatusText(run)}
            </div>

            {/* Right: Progress and action */}
            <div className="flex items-center gap-3">
              {run.status === 'running' && (
                <>
                  <ProgressBar run={run} />
                  <span className="text-sm font-medium min-w-[3ch] text-white/90">
                    {Math.round(run.progress * 100)}%
                  </span>
                </>
              )}
              <ExternalLink className="w-4 h-4 text-white/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className="fixed left-0 right-0 z-40 border-b border-white/10 bg-black/90 shadow-lg backdrop-blur-md transition-[top] duration-200 ease-out hover:shadow-xl"
      style={{ top: compactShellTopPx }}
    >
      <div className="container-aligned">
        <div className="py-4">
          {isExpanded ? <ExpandedView /> : <CollapsedView />}
        </div>
      </div>

    </div>
  );
}


