interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export default function MetricCard({ label, value, subtext, trend }: MetricCardProps) {
  const getTrendColor = () => {
    switch (trend) {
      case 'up':
        return 'text-[#e5e5e5]';
      case 'down':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="bg-secondary/50 rounded-lg p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-2xl font-semibold text-foreground">
        {value}
      </p>
      {subtext && (
        <p className={`text-xs mt-1 ${getTrendColor()}`}>
          {subtext}
        </p>
      )}
    </div>
  );
}
