"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

/**
 * Golden-coin Growth Token balance badge for the topbar (dashboard/layout.tsx)
 * — real data (getGrowthTokenAvailability), rendered by a "use client"
 * wrapper purely so the number and the fill bar can animate smoothly
 * whenever the balance PROP changes between renders (a real spend/purchase
 * elsewhere in the app, or any RealtimeRefresher-triggered refresh, causes
 * the parent Server Component to re-fetch a fresh value and pass it down —
 * this component only owns the animation, never a second data source).
 *
 * The fill bar's "full" reference is a rolling max of every balance this
 * mounted instance has actually observed (starts at the first real value,
 * only ever grows when a real purchase pushes the balance higher) — so it
 * genuinely drains toward 0 as tokens are spent and genuinely refills
 * toward its own top when more are bought, rather than against an
 * arbitrary invented ceiling.
 */

const ANIMATION_MS = 900;

function useAnimatedNumber(target: number, durationMs = ANIMATION_MS): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) ** 3; // ease-out-cubic
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return value;
}

export interface GrowthTokenBadgeProps {
  unlimited: boolean;
  remainingTokens: number;
}

export function GrowthTokenBadge({ unlimited, remainingTokens }: GrowthTokenBadgeProps) {
  // Rolling max, via React's own documented "adjusting state when a prop
  // changes" pattern (a conditional setState call during render, bailing
  // out and re-rendering immediately before commit — never a ref mutation,
  // never an effect) — so the fill bar's "full" reference only ever grows
  // when a real purchase pushes the balance higher than anything seen yet.
  const [prevRemainingTokens, setPrevRemainingTokens] = useState(remainingTokens);
  const [visualMax, setVisualMax] = useState(() => Math.max(remainingTokens, 1));
  if (remainingTokens !== prevRemainingTokens) {
    setPrevRemainingTokens(remainingTokens);
    setVisualMax(Math.max(visualMax, remainingTokens));
  }

  const animated = useAnimatedNumber(unlimited ? 0 : remainingTokens);
  const pct = unlimited ? 100 : Math.min(100, Math.max(0, (remainingTokens / visualMax) * 100));

  return (
    <Link
      href="/dashboard/billing"
      className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20 sm:inline-flex dark:text-amber-400"
      title="Growth Tokens — click to buy more"
    >
      <Image src="/images/growth-token-coin.png" alt="" width={18} height={18} className="shrink-0 drop-shadow-[0_0_3px_rgba(245,158,11,0.6)]" />
      {unlimited ? (
        <span>Unlimited</span>
      ) : (
        <span className="flex flex-col gap-0.5">
          <span className="tabular-nums leading-none">{animated.toLocaleString()}</span>
          <span className="h-1 w-14 overflow-hidden rounded-full bg-amber-500/15">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      )}
    </Link>
  );
}
