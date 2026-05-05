import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";

export type Status = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

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
        return <Loader2 className="w-5 h-5 text-white animate-spin" />;
      case 'done':
        return <CheckCircle2 className="w-5 h-5 text-[#e5e5e5]" />;
      case 'cancelled':
        return <XCircle className="w-5 h-5 text-[#F5F5F5]/60" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-[#f87171]" />;
      default:
        return <Circle className="w-5 h-5 text-[#F5F5F5]/62" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'running':
        return 'Processing...';
      case 'done':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
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
          <span className="text-sm font-medium text-[#F5F5F5]">
            {getStatusText()}
          </span>
        </div>
        {status === 'running' && progress > 0 && (
          <span className="text-sm text-[#F5F5F5]/62">
            {Math.round(progress)}%
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {status === 'running' && (
        <div className="h-1 bg-[#0a0a0a]/60 rounded-full overflow-hidden">
          <div 
            className="h-full bg-white transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Error Message */}
      {status === 'error' && errorMessage && (
        <div className="p-3 bg-[#f87171]/10 border border-[#f87171]/20 rounded-md">
          <p className="text-sm text-[#f87171]">{errorMessage}</p>
        </div>
      )}

      {/* Log Feed */}
      {logs.length > 0 && (
        <div className="bg-[#0a0a0a]/40 rounded-md p-4 max-h-48 overflow-y-auto">
          <div className="space-y-1 font-mono text-xs">
            {logs.map((log, i) => (
              <div 
                key={i} 
                className="text-[#F5F5F5]/62 animate-slide-in"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span className="text-[#F5F5F5]/40 mr-2">[{String(i + 1).padStart(2, '0')}]</span>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {status === 'idle' && logs.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-[#F5F5F5]/62">
            Configure parameters and run the tool to see output here.
          </p>
        </div>
      )}
    </div>
  );
}
