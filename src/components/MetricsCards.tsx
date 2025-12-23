export interface MetricCardItem {
  value: string;
  subtitle: string;
}

export default function MetricsCards({ items }: { items: MetricCardItem[] }) {
  return (
    <section className="relative min-h-screen flex items-center py-24">
      <div className="container-aligned w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {items.map((item) => (
            <article
              key={item.value + item.subtitle}
              className="surface-card p-8 md:p-10 bg-card/60 backdrop-blur-sm"
            >
              <div className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight text-foreground">
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
