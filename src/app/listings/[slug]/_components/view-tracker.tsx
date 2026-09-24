"use client";

import { useEffect, useRef } from "react";

import { recordListingView } from "../_lib/public-actions";

/**
 * Fires a best-effort view-count increment on mount, from the client, not
 * from the server-rendered page body itself — the page is served under ISR
 * (export const revalidate) so its render function only re-executes once
 * per revalidation window, which would drastically undercount real
 * visitors if the increment lived there instead.
 */
export function ViewTracker({ listingId }: { listingId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    recordListingView(listingId).catch(() => {});
  }, [listingId]);

  return null;
}
