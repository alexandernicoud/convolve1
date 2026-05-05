import { useEffect, useState } from "react";

type Props = {
  text: string;
  /** Start typing when true */
  active: boolean;
  className?: string;
  /** ms per character */
  charMs?: number;
};

export function VisionTypedText({ text, active, className = "", charMs = 28 }: Props) {
  const [out, setOut] = useState("");
  const [rm, setRm] = useState(false);

  useEffect(() => {
    setRm(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (!active) {
      setOut("");
      return;
    }
    if (rm) {
      setOut(text);
      return;
    }
    let i = 0;
    setOut("");
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, charMs);
    return () => window.clearInterval(id);
  }, [active, text, charMs, rm]);

  return <span className={className}>{out}</span>;
}
