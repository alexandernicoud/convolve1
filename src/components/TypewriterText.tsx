import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

interface TypewriterTextProps {
  text: string;
  className?: string;
}

function TypewriterAnimation({
  text,
  key: animationKey
}: {
  text: string;
  key: number;
}) {
  const [displayedText, setDisplayedText] = useState(text); // Start with full text visible
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;

    // Check for prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      // Just ensure text is visible
      gsap.set(element, { opacity: 1, y: 0 });
      setDisplayedText(text);
      return;
    }

    // Reset text and animate
    setDisplayedText("");

    // Animate the entire text element sliding in from above
    gsap.fromTo(element,
      {
        opacity: 0,
        y: -30,
      },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'back.out(1.5)',
        onComplete: () => {
          // After slide-in animation, start the typewriter effect
          let index = 0;
          const typeInterval = setInterval(() => {
            if (index < text.length) {
              setDisplayedText(text.slice(0, index + 1));
              index++;
            } else {
              clearInterval(typeInterval);
            }
          }, 60); // 60ms between characters
        }
      }
    );

    return () => {
      gsap.killTweensOf(element);
    };
  }, [animationKey, text]);

  return (
    <span ref={textRef}>
      {displayedText}
    </span>
  );
}

export default function TypewriterText({
  text,
  className,
}: TypewriterTextProps) {
  const [replayKey, setReplayKey] = useState(0);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let lastY = window.scrollY;
    let lastIntersecting = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nowIntersecting = entry.isIntersecting;
        const currentY = window.scrollY;
        const scrollingDown = currentY > lastY;

        // Trigger animation on every intersection change (entering or leaving)
        // This covers both upward and downward scrolling past the element
        if (nowIntersecting !== lastIntersecting) {
          // Small delay to prevent rapid retriggering
          setTimeout(() => {
            setReplayKey(prev => prev + 1);
          }, 100);
        }

        setIsIntersecting(nowIntersecting);
        lastIntersecting = nowIntersecting;
        lastY = currentY;
      },
      {
        threshold: 0.65,
        // Add root margin to trigger slightly before/after element is fully in view
        rootMargin: '0px 0px -10% 0px'
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <h2
      ref={ref}
      className={
        className ??
          "text-5xl font-light tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl"
      }
    >
      <TypewriterAnimation
        text={text}
        animationKey={replayKey}
      />
    </h2>
  );
}
