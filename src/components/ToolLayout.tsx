import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

interface ToolLayoutProps {
  title: string;
  description: string;
  inputPanel: ReactNode;
  outputPanel: ReactNode;
  advancedPanel?: ReactNode;
}

export default function ToolLayout({ 
  title, 
  description, 
  inputPanel, 
  outputPanel,
  advancedPanel 
}: ToolLayoutProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden pb-2">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden">
        {/* Title comes from pipeline top bar; description kept for screen readers only */}
        <p className="sr-only">
          {title}: {description}
        </p>

        {/* Main Grid */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2 lg:gap-6">
          {/* Input Panel */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0a0a0a]/60 p-4 backdrop-blur-sm opacity-0 animate-fade-up md:p-5" style={{ animationDelay: '100ms' }}>
            <h2 className="mb-3 flex shrink-0 items-center gap-2 text-base font-medium text-[#F5F5F5]">
              <div className="h-2 w-2 shrink-0 rounded-full bg-white" />
              Configuration
            </h2>
            <div className="min-h-0 flex-1 overflow-hidden">{inputPanel}</div>
          </div>

          {/* Output Panel */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0a0a0a]/60 p-4 backdrop-blur-sm opacity-0 animate-fade-up md:p-5" style={{ animationDelay: '200ms' }}>
            <h2 className="mb-3 flex shrink-0 items-center gap-2 text-base font-medium text-[#F5F5F5]">
              <div className="h-2 w-2 shrink-0 rounded-full bg-[#F5F5F5]/62" />
              Output
            </h2>
            <div className="min-h-0 flex-1 overflow-hidden">{outputPanel}</div>
          </div>
        </div>

        {/* Advanced Panel */}
        {advancedPanel && (
          <div className="mt-4 shrink-0 overflow-hidden rounded-xl border border-white/8 bg-[#0a0a0a]/60 backdrop-blur-sm opacity-0 animate-fade-up" style={{ animationDelay: '300ms' }}>
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="w-full p-6 flex items-center justify-between text-left hover:bg-white/8 transition-colors rounded-xl"
            >
              <h2 className="text-lg font-medium text-[#F5F5F5]">
                Advanced Insights
              </h2>
              <ChevronDown className={`w-5 h-5 text-[#F5F5F5]/62 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </button>

            {advancedOpen && (
              <div className="p-6 pt-0 border-t border-white/8 animate-fade-in">
                {advancedPanel}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
