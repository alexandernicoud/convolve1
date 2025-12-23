import { useEffect, useRef, useState } from "react";

interface TypewriterTextProps {
  text: string;
  className?: string;
  charDelayMs?: number;
}

export default function TypewriterText({
  text,
  className,
  charDelayMs = 50,
}: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.65 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setDisplayedText(text.slice(0, index));
      if (index >= text.length) window.clearInterval(interval);
    }, charDelayMs);

    return () => window.clearInterval(interval);
  }, [isVisible, text, charDelayMs]);

  return (
    <h2
      ref={ref}
      className={
        className ??
        "text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-light tracking-tight text-foreground"
      }
    >
      {displayedText}
    </h2>
  );
}
