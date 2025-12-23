import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ChartProps {
  data: Array<Record<string, number | string>>;
  xKey: string;
  yKey: string;
  title?: string;
  color?: string;
  type?: 'line' | 'area' | 'bar';
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-md px-3 py-2 shadow-lg">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-sm font-medium text-foreground">
          {typeof payload[0].value === 'number' 
            ? payload[0].value.toFixed(4) 
            : payload[0].value
          }
        </p>
      </div>
    );
  }
  return null;
};

export default function SvgChart({ 
  data, 
  xKey, 
  yKey, 
  title, 
  color = "hsl(217, 91%, 60%)",
  type = 'line' 
}: ChartProps) {
  const renderChart = () => {
    const commonProps = {
      data,
      margin: { top: 5, right: 5, left: 0, bottom: 5 },
    };

    switch (type) {
      case 'area':
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id={`gradient-${yKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" vertical={false} />
            <XAxis 
              dataKey={xKey} 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(210, 15%, 55%)', fontSize: 11 }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(210, 15%, 55%)', fontSize: 11 }}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey={yKey}
              stroke={color}
              strokeWidth={2}
              fill={`url(#gradient-${yKey})`}
            />
          </AreaChart>
        );
      
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" vertical={false} />
            <XAxis 
              dataKey={xKey} 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(210, 15%, 55%)', fontSize: 11 }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(210, 15%, 55%)', fontSize: 11 }}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        );

      default:
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" vertical={false} />
            <XAxis 
              dataKey={xKey} 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(210, 15%, 55%)', fontSize: 11 }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: 'hsl(210, 15%, 55%)', fontSize: 11 }}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey={yKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
          </LineChart>
        );
    }
  };

  return (
    <div className="w-full">
      {title && (
        <h4 className="text-sm font-medium text-foreground mb-4">{title}</h4>
      )}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
