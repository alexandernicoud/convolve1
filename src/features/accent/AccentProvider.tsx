import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ACCENT_HEX,
  CHART_ACCENT_HEX,
  applyAccentToDocument,
  readStoredAccent,
  writeStoredAccent,
  type AccentId,
} from "./model";

type AccentCtx = {
  accent: AccentId;
  setAccent: (id: AccentId) => void;
  accentHex: string;
  chartAccentHex: string;
  isDefault: boolean;
};

const Ctx = createContext<AccentCtx | null>(null);

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<AccentId>(() => (typeof document !== "undefined" ? readStoredAccent() : "default"));

  useEffect(() => {
    applyAccentToDocument(accent);
    writeStoredAccent(accent);
  }, [accent]);

  const setAccent = useCallback((id: AccentId) => setAccentState(id), []);

  const value = useMemo(
    () => ({
      accent,
      setAccent,
      accentHex: ACCENT_HEX[accent],
      chartAccentHex: CHART_ACCENT_HEX[accent],
      isDefault: accent === "default",
    }),
    [accent, setAccent],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccent(): AccentCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccent requires AccentProvider");
  return v;
}

export function useAccentHex(): string {
  const v = useContext(Ctx);
  return v?.chartAccentHex ?? CHART_ACCENT_HEX.default;
}

export function useBrandAccentHex(): string {
  const v = useContext(Ctx);
  return v?.accentHex ?? ACCENT_HEX.default;
}
