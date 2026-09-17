"use client";

import * as React from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";

import { DURATIONS } from "@/animations";

export interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
  /** Number of decimal places to render, e.g. 1 for "4.5". Defaults to 0. */
  decimals?: number;
}

/**
 * Count-up number that animates from 0 to `value`. Prefers animating once
 * the element scrolls into view (the intended marketing-page effect), but
 * always falls back to animating on mount/value-change regardless of
 * `isInView` — confirmed via a real production screenshot that relying on
 * `useInView` alone can leave a real, already-on-screen dashboard number
 * (e.g. "Sent today", "Campaigns") permanently stuck at its initial 0,
 * which is far worse for a real business dashboard than losing the
 * scroll-triggered flourish for the rare case both paths fire. The two
 * effects below are idempotent together — whichever fires reflects the
 * same real `value`.
 */
function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  duration = DURATIONS.slower,
  className,
  decimals = 0,
}: AnimatedCounterProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const [display, setDisplay] = React.useState(() =>
    formatValue(0, decimals),
  );

  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, {
    duration,
    bounce: 0,
  });

  React.useEffect(() => {
    if (isInView) {
      motionValue.set(value);
    }
  }, [isInView, motionValue, value]);

  // Reliability fallback — see doc comment above. Runs on every mount and
  // whenever `value` changes, independent of `isInView` ever firing.
  React.useEffect(() => {
    motionValue.set(value);
  }, [motionValue, value]);

  React.useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      setDisplay(formatValue(latest, decimals));
    });
    return unsubscribe;
  }, [springValue, decimals]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

function formatValue(value: number, decimals: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export { AnimatedCounter };
