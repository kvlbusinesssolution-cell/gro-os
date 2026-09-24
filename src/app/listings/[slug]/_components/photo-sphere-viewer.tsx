"use client";

import { useEffect, useRef } from "react";
import "@photo-sphere-viewer/core/index.css";

/** Real interactive 360° panorama viewer (@photo-sphere-viewer/core, MIT license) — used only for a photo the uploader explicitly marked `is360`, never auto-applied to a regular flat photo. */
export function PhotoSphereViewer({ src, alt }: { src: string; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let viewer: import("@photo-sphere-viewer/core").Viewer | undefined;
    let cancelled = false;

    import("@photo-sphere-viewer/core").then(({ Viewer }) => {
      if (cancelled || !containerRef.current) return;
      viewer = new Viewer({ container: containerRef.current, panorama: src, navbar: ["zoom", "fullscreen"], loadingImg: undefined });
    });

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [src]);

  return <div ref={containerRef} role="img" aria-label={alt} className="h-80 w-full overflow-hidden rounded-xl bg-black sm:h-96" />;
}
