import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";

export type Status = 'idle' | 'running' | 'done' | 'error';

interface StatusPanelProps {
  status: Status;
  progress?: number;
  logs: string[];
  errorMessage?: string;
}

export default function StatusPanel({ status, progress = 0, logs, errorMessage }: StatusPanelProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
      case 'done':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-destructive" />;
      default:
        return <Circle className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'running':
        return 'Processing...';
      case 'done':
        return 'Completed';
      case 'error':
        return 'Error';
      default:
        return 'Ready';
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <span className="text-sm font-medium text-foreground">
            {getStatusText()}
          </span>
        </div>
        {status === 'running' && progress > 0 && (
          <span className="text-sm text-muted-foreground">
            {Math.round(progress)}%
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {status === 'running' && (
        <div className="h-1 bg-secondary rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Error Message */}
      {status === 'error' && errorMessage && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-sm text-destructive">{errorMessage}</p>
        </div>
      )}

      {/* Log Feed */}
      {logs.length > 0 && (
        <div className="bg-secondary/50 rounded-md p-4 max-h-48 overflow-y-auto">
          <div className="space-y-1 font-mono text-xs">
            {logs.map((log, i) => (
              <div 
                key={i} 
                className="text-muted-foreground animate-slide-in"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span className="text-muted-foreground/50 mr-2">[{String(i + 1).padStart(2, '0')}]</span>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {status === 'idle' && logs.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Configure parameters and run the tool to see output here.
          </p>
        </div>
      )}
    </div>
  );
}
