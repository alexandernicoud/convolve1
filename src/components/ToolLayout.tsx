import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

interface ToolLayoutProps {
  title: string;
  description: string;
  inputPanel: ReactNode;
  /** When omitted, only the configuration column is shown (full width). */
  outputPanel?: ReactNode | null;
  advancedPanel?: ReactNode;
  /**
   * `beside` — classic two-column layout on large screens.
   * `integrated` — full-width inputs with output column in-flow on the right (large screens).
   */
  outputPlacement?: "beside" | "integrated";
  /** Max width for inner shell (default: full width within TechnicalLayout). */
  contentMaxWidthClass?: string;
  /** For `integrated` placement: give the output column ~half the width instead of a narrow rail. */
  integratedOutputWide?: boolean;
}

export default function ToolLayout({
  title,
  description,
  inputPanel,
  outputPanel,
  advancedPanel,
  outputPlacement = "beside",
  contentMaxWidthClass = "w-full max-w-none",
  integratedOutputWide = false,
}: ToolLayoutProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const hasOutput = outputPanel != null && outputPanel !== false;

  const inputShellClass =
    "flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0a0a0a]/60 p-4 backdrop-blur-sm opacity-0 animate-fade-up md:p-5";

  const outputShellClass =
    "flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]/95 p-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85)] backdrop-blur-md opacity-0 animate-fade-up md:p-4";

  return (
    <div
      className={
        hasOutput
          ? "flex h-full min-h-0 flex-col overflow-hidden pb-2"
          : "min-h-0 pb-2"
      }
    >
      <div
        className={`mx-auto w-full min-h-0 ${hasOutput ? "flex flex-1 flex-col overflow-hidden" : ""} ${contentMaxWidthClass}`}
      >
        {/* Title comes from pipeline top bar; description kept for screen readers only */}
        <p className="sr-only">
          {title}: {description}
        </p>

        {!hasOutput ? (
          <div
            className="flex min-h-0 min-w-0 flex-col rounded-xl border border-white/8 bg-[#0a0a0a]/60 p-4 backdrop-blur-sm opacity-0 animate-fade-up md:p-5"
            style={{ animationDelay: "100ms" }}
          >
            <h2 className="mb-2 flex shrink-0 items-center gap-2 text-base font-medium text-[#F5F5F5]">
              <div className="h-2 w-2 shrink-0 rounded-full bg-white" />
              Configuration
            </h2>
            <div className="min-h-0">{inputPanel}</div>
          </div>
        ) : outputPlacement === "integrated" ? (
          <div
            className={`grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:items-start lg:gap-5 ${
              integratedOutputWide
                ? "lg:grid-cols-2"
                : "lg:grid-cols-[minmax(0,1fr)_min(22rem,34vw)]"
            }`}
          >
            <div className={`${inputShellClass} min-h-0 min-w-0 lg:max-h-[calc(100dvh-10rem)]`} style={{ animationDelay: "100ms" }}>
              <h2 className="mb-2 flex shrink-0 items-center gap-2 text-base font-medium text-[#F5F5F5]">
                <div className="h-2 w-2 shrink-0 rounded-full bg-white" />
                Configuration
              </h2>
              <div className="min-h-0 max-h-[min(92dvh,1200px)] flex-1 overflow-y-auto overscroll-contain lg:max-h-none">
                {inputPanel}
              </div>
            </div>
            <div
              className={`${outputShellClass} flex max-h-[min(52dvh,520px)] min-h-0 min-w-0 flex-col lg:sticky lg:top-0 lg:max-h-[calc(100dvh-10rem)]`}
              style={{ animationDelay: "200ms" }}
            >
              <h2 className="mb-2 flex shrink-0 items-center gap-2 text-base font-medium text-[#F5F5F5]">
                <div className="h-2 w-2 shrink-0 rounded-full bg-[#F5F5F5]/62" />
                Output
              </h2>
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">{outputPanel}</div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2 lg:gap-6">
            {/* Input Panel */}
            <div className={inputShellClass} style={{ animationDelay: "100ms" }}>
              <h2 className="mb-3 flex shrink-0 items-center gap-2 text-base font-medium text-[#F5F5F5]">
                <div className="h-2 w-2 shrink-0 rounded-full bg-white" />
                Configuration
              </h2>
              <div className="min-h-0 flex-1 overflow-hidden">{inputPanel}</div>
            </div>

            {/* Output Panel */}
            <div
              className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0a0a0a]/60 p-4 backdrop-blur-sm opacity-0 animate-fade-up md:p-5"
              style={{ animationDelay: "200ms" }}
            >
              <h2 className="mb-3 flex shrink-0 items-center gap-2 text-base font-medium text-[#F5F5F5]">
                <div className="h-2 w-2 shrink-0 rounded-full bg-[#F5F5F5]/62" />
                Output
              </h2>
              <div className="min-h-0 flex-1 overflow-hidden">{outputPanel}</div>
            </div>
          </div>
        )}

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
