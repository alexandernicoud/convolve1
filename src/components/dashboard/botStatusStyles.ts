import { cn } from "@/lib/utils";

/** Backend `derive_bot_status` — shared across dashboard cards and detail */
export const BOT_STATUS_BADGE_CLASS: Record<string, string> = {
  active: "border border-white/25 bg-white/[0.08] text-white",
  waiting: "border border-white/20 bg-white/[0.05] text-white/90",
  running: "border border-white/25 bg-white/[0.08] text-white",
  error: "border border-white/30 bg-white/[0.06] text-white",
  paused: "border border-white/18 bg-white/[0.04] text-white/85",
  expired: "border border-white/15 bg-white/[0.03] text-white/70",
  closed: "border border-white/12 bg-white/[0.03] text-white/75",
  archived: "border border-white/10 bg-white/[0.02] text-white/60 opacity-90",
};

export function botStatusBadgeClass(status: string | null | undefined): string {
  const st = (status ?? "active").toLowerCase();
  return cn(
    "shrink-0 rounded px-1.5 py-0.5 font-digits text-[9px] font-bold uppercase",
    BOT_STATUS_BADGE_CLASS[st] ?? "border border-white/15 bg-white/[0.06] text-white/80"
  );
}

/** Larger badge for bot detail header */
export function botStatusBadgeDetailClass(status: string | null | undefined): string {
  const st = (status ?? "active").toLowerCase();
  return cn(
    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-digits text-[10px] font-bold uppercase",
    BOT_STATUS_BADGE_CLASS[st] ?? "border border-white/15 bg-white/[0.06] text-white/80"
  );
}

/** Dashboard “system” strip: LIVE / WAITING / ERROR / PAUSED */
export function systemOperationalBadgeClass(status: string): string {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    LIVE: "border border-white/25 bg-white/[0.08] text-white shadow-[0_0_12px_rgba(255,255,255,0.06)]",
    WAITING: "border border-white/20 bg-white/[0.05] text-white/90",
    ERROR: "border border-white/30 bg-white/[0.06] text-white",
    PAUSED: "border border-white/18 bg-white/[0.04] text-white/85",
  };
  return cn(
    "rounded px-2 py-0.5 font-digits text-[10px] font-bold uppercase tracking-wide",
    map[s] ?? map.LIVE
  );
}
