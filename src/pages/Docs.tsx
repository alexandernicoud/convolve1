import { FileText, ExternalLink } from "lucide-react";

const sections = [
  {
    title: "Getting Started",
    items: [
      { name: "Introduction", description: "Overview of the convolve toolkit" },
      { name: "Quick Start", description: "Generate your first dataset in 5 minutes" },
      { name: "Concepts", description: "Understanding visual market models" },
    ],
  },
  {
    title: "Generator",
    items: [
      { name: "Configuration", description: "Dataset generation parameters" },
      { name: "Labeling", description: "How labels are assigned" },
      { name: "Output Format", description: "Dataset structure and files" },
    ],
  },
  {
    title: "Trainer",
    items: [
      { name: "Model Architecture", description: "CNN structure and layers" },
      { name: "Training Parameters", description: "Epochs, batch size, and more" },
      { name: "Analysis Tools", description: "Understanding model behavior" },
    ],
  },
  {
    title: "Backtester",
    items: [
      { name: "Simulation Engine", description: "How backtests are executed" },
      { name: "Metrics", description: "Performance measures explained" },
      { name: "Advanced Analysis", description: "Deep dive into results" },
    ],
  },
];

export default function Docs() {
  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container-wide">
        <div className="mb-12 opacity-0 animate-fade-up">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
            Documentation
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Learn how to use the convolve toolkit effectively.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {sections.map((section, sectionIndex) => (
            <div 
              key={section.title}
              className="surface-card p-6 opacity-0 animate-fade-up"
              style={{ animationDelay: `${sectionIndex * 100}ms` }}
            >
              <h2 className="text-lg font-medium text-foreground mb-6 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                {section.title}
              </h2>
              <div className="space-y-4">
                {section.items.map((item) => (
                  <a
                    key={item.name}
                    href="#"
                    className="block p-4 bg-secondary/50 rounded-md hover:bg-secondary transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-foreground mb-1">
                          {item.name}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
