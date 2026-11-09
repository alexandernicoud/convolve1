/**
 * Global pale accent system. Default preserves original black / white / grey.
 * Accents personalise primary CTAs, branding, nav highlights and decorative chart series —
 * not structural borders, panels or semantic success/danger colours.
 */

export type AccentId =
  | "default"
  | "rose"
  | "lavender"
  | "blue"
  | "cyan"
  | "mint"
  | "peach"
  | "amber";

export type AccentOption = {
  id: AccentId;
  label: string;
  swatch: string;
  description: string;
};

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: "default", label: "Default", swatch: "#e8e8e8", description: "Original white and grey" },
  { id: "rose", label: "Pale Rose", swatch: "#F4B6C2", description: "Soft rose on black" },
  { id: "lavender", label: "Pale Lavender", swatch: "#CBB8F5", description: "Quiet lavender" },
  { id: "blue", label: "Powder Blue", swatch: "#A9CFF4", description: "Powder blue" },
  { id: "cyan", label: "Soft Cyan", swatch: "#A5E5E7", description: "Soft cyan" },
  { id: "mint", label: "Sage Mint", swatch: "#A9DEC9", description: "Sage mint" },
  { id: "peach", label: "Soft Peach", swatch: "#F5C5A5", description: "Soft peach" },
  { id: "amber", label: "Pale Amber", swatch: "#F4DCAC", description: "Pale amber" },
];

export const ACCENT_STORAGE_KEY = "convolve:accent";

/** Primary fill / logo / brand mark. Default = white. */
export const ACCENT_HEX: Record<AccentId, string> = {
  default: "#ffffff",
  rose: "#F4B6C2",
  lavender: "#CBB8F5",
  blue: "#A9CFF4",
  cyan: "#A5E5E7",
  mint: "#A9DEC9",
  peach: "#F5C5A5",
  amber: "#F4DCAC",
};

/** Dark foreground on pale primary buttons. */
export const ACCENT_FG: Record<AccentId, string> = {
  default: "#0a0a0a",
  rose: "#2a1218",
  lavender: "#1c1430",
  blue: "#101a28",
  cyan: "#102022",
  mint: "#10241c",
  peach: "#2a1810",
  amber: "#241c0c",
};

/** Slightly deeper hover fill (still pale). */
export const ACCENT_HOVER: Record<AccentId, string> = {
  default: "#f2f2f2",
  rose: "#f7c5cf",
  lavender: "#d6c6f7",
  blue: "#b8d7f6",
  cyan: "#b5eaea",
  mint: "#b8e5d2",
  peach: "#f7d0b5",
  amber: "#f6e3bb",
};

/** Chart primary series — Default keeps the original soft fleet blue. */
export const CHART_ACCENT_HEX: Record<AccentId, string> = {
  default: "#8FB3E0",
  rose: "#F4B6C2",
  lavender: "#CBB8F5",
  blue: "#A9CFF4",
  cyan: "#A5E5E7",
  mint: "#A9DEC9",
  peach: "#F5C5A5",
  amber: "#F4DCAC",
};

const IDS = new Set(ACCENT_OPTIONS.map((o) => o.id));

export function isAccentId(v: string | null | undefined): v is AccentId {
  return !!v && IDS.has(v as AccentId);
}

/** Map legacy storage ids from earlier palettes onto the pale set. */
function migrateStoredId(raw: string | null): AccentId {
  if (isAccentId(raw)) return raw;
  const map: Record<string, AccentId> = {
    original: "default",
    ice: "blue",
    mint_old: "mint",
    violet: "lavender",
    emerald: "mint",
    orange: "peach",
  };
  if (raw && map[raw]) return map[raw];
  return "default";
}

export function readStoredAccent(): AccentId {
  try {
    return migrateStoredId(localStorage.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return "default";
  }
}

export function writeStoredAccent(id: AccentId): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function applyAccentToDocument(id: AccentId): void {
  const root = document.documentElement;
  root.dataset.accent = id;
  const hex = ACCENT_HEX[id];
  const hover = ACCENT_HOVER[id];
  const chart = CHART_ACCENT_HEX[id];
  root.style.setProperty("--convolve-accent", hex);
  root.style.setProperty("--convolve-accent-rgb", hexToRgbCsv(hex));
  root.style.setProperty("--convolve-accent-fg", ACCENT_FG[id]);
  root.style.setProperty("--convolve-accent-hover", hover);
  root.style.setProperty("--convolve-accent-hover-rgb", hexToRgbCsv(hover));
  root.style.setProperty("--convolve-accent-subtle", `rgba(${hexToRgbCsv(hex)}, 0.14)`);
  root.style.setProperty("--convolve-accent-active", hover);
  root.style.setProperty("--convolve-primary-button-bg", hex);
  root.style.setProperty("--convolve-primary-button-text", ACCENT_FG[id]);
  root.style.setProperty("--convolve-chart-accent", chart);
  root.style.setProperty("--convolve-chart-accent-rgb", hexToRgbCsv(chart));
  root.style.setProperty("--convolve-logo-accent", hex);
  root.style.setProperty("--convolve-focus-ring", `rgba(${hexToRgbCsv(hex)}, 0.45)`);
  root.style.setProperty("--convolve-interactive-highlight", hex);
  root.style.setProperty("--convolve-active-navigation", id === "default" ? "#ffffff" : hex);
  root.style.setProperty("--convolve-secondary-button-text", id === "default" ? "rgba(255,255,255,0.85)" : hex);
}

function hexToRgbCsv(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
