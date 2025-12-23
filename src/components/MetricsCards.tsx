export interface MetricCardItem {
  value: string;
  subtitle: string;
}

export default function MetricsCards({ 
  items,
  title = "By the Numbers"
}: { 
  items: MetricCardItem[];
  title?: string;
}) {
  return (
    <section className="relative min-h-screen flex items-center py-24">
      <div className="container-aligned w-full">
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-foreground mb-12">
          {title}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {items.map((item) => (
            <article
              key={item.value + item.subtitle}
              className="surface-card p-8 md:p-10 bg-card/60 backdrop-blur-sm"
            >
              <div className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight text-primary">
                {item.value}
              </div>
              <div className="mt-4 text-base md:text-lg text-muted-foreground leading-relaxed">
                {item.subtitle}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
