import type { ReactNode } from "react";

export async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (typeof body?.detail?.message === "string") return body.detail.message;
  } catch {
    /* not JSON */
  }
  return res.statusText || `Request failed (${res.status})`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function Card({
  title,
  description,
  children,
  tone,
  action,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  tone?: "danger";
  action?: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 sm:p-7 ${
        tone === "danger" ? "border-red-400/25 bg-red-500/[0.03]" : "border-white/[0.09] bg-white/[0.02]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className={`text-[17px] font-medium ${tone === "danger" ? "text-red-200" : "text-white"}`}>{title}</h2>
          {description && <p className="mt-1.5 text-sm leading-relaxed text-white/50">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-white/[0.06] py-3.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-white/45">{label}</span>
      <div className="text-sm text-white/85 sm:text-right">{children}</div>
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
    />
  );
}

export function Button({
  children,
  variant = "secondary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-white text-[#0a0a0a] hover:bg-white/90",
    secondary: "border border-white/15 text-white/80 hover:bg-white/[0.06]",
    danger: "bg-red-500/90 text-white hover:bg-red-500",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: ReactNode }) {
  const color = { ok: "text-[#a6ecc8]", error: "text-red-300", info: "text-white/55" }[kind];
  return (
    <p role="status" className={`mt-3 text-sm ${color}`}>
      {children}
    </p>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] px-4 py-3.5">
      <div className="truncate text-[22px] font-light tabular-nums tracking-tight text-white">{value}</div>
      <div className="mt-0.5 text-xs text-white/45">{label}</div>
      {hint && <div className="mt-1.5 text-[11px] leading-snug text-white/35">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.1] px-4 py-8 text-center text-sm leading-relaxed text-white/45">
      {children}
    </div>
  );
}

/** Vertical bars; values are real counts. Labels below the first, middle and last bar. */
export function BarChart({
  data,
  label,
  unit,
}: {
  data: { key: string; label: string; value: number }[];
  label: string;
  unit: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return (
    <figure aria-label={label}>
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`${label}, ${data.length} periods`}>
        {data.map((d) => (
          <div key={d.key} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div
              className={`w-full rounded-t-[3px] ${d.value > 0 ? "bg-white/70 group-hover:bg-white" : "bg-white/[0.07]"}`}
              style={{ height: d.value > 0 ? `${Math.max(4, (d.value / max) * 100)}%` : "2px" }}
            />
            <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-black px-2 py-1 text-[11px] text-white group-hover:block">
              {d.label}: {d.value} {unit}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3px] text-[10px] text-white/35">
        {data.map((d, i) => (
          <div key={d.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {ticks.has(i) ? d.label : ""}
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>
                {d.value} {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
