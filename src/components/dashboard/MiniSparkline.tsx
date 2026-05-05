import { Line, LineChart, ResponsiveContainer } from "recharts";

export function MiniSparkline({ data }: { data: { i: number; v: number }[] }) {
  if (data.length < 2) {
    return <div className="h-8 w-16 rounded bg-white/[0.04]" />;
  }
  return (
    <div className="h-8 w-20 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey="v" stroke="#E5E7EB" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
