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
    <div className="min-h-screen pt-24 pb-16">
      <div className="container-wide">
        {/* Header */}
        <div className="mb-12 opacity-0 animate-fade-up">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-3">
            {title}
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            {description}
          </p>
        </div>

        {/* Main Grid */}
        <div className="grid lg:grid-cols-2 gap-8 mb-8">
          {/* Input Panel */}
          <div className="surface-card p-6 opacity-0 animate-fade-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-lg font-medium text-foreground mb-6 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              Configuration
            </h2>
            {inputPanel}
          </div>

          {/* Output Panel */}
          <div className="surface-card p-6 opacity-0 animate-fade-up" style={{ animationDelay: '200ms' }}>
            <h2 className="text-lg font-medium text-foreground mb-6 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-muted-foreground" />
              Output
            </h2>
            {outputPanel}
          </div>
        </div>

        {/* Advanced Panel */}
        {advancedPanel && (
          <div className="surface-card opacity-0 animate-fade-up" style={{ animationDelay: '300ms' }}>
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="w-full p-6 flex items-center justify-between text-left hover:bg-secondary/50 transition-colors"
            >
              <h2 className="text-lg font-medium text-foreground">
                Advanced Insights
              </h2>
              <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {advancedOpen && (
              <div className="p-6 pt-0 border-t border-border animate-fade-in">
                {advancedPanel}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
