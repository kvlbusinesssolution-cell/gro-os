import Image from "next/image";

import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
  size?: number;
}

/**
 * The real GROOS brand mark — the "G" lettermark (with its swirl + ascending
 * arrow) cropped out of the full GROOS logo, square-padded with a
 * transparent background so it drops in anywhere a compact icon is needed.
 * Ships as two square PNGs (public/images/groos-mark-{light,dark}.png,
 * genuinely different art per theme, not a CSS-inverted single image),
 * toggled by the same `.theme-logo-light`/`.theme-logo-dark` CSS pair
 * `Logo` uses (see globals.css) — see public/images/groos-logo-{light,dark}.png
 * for the full lockup with the "GROOS" wordmark, used where a larger/
 * standalone logo fits better than this compact icon.
 */
function LogoMark({ className, size = 28 }: LogoMarkProps) {
  const style = { width: size, height: size, objectFit: "contain" as const };

  return (
    <>
      <Image
        src="/images/groos-mark-light.png"
        alt="GROOS"
        width={size}
        height={size}
        className={cn("logo-glow theme-logo-light", className)}
        style={style}
      />
      <Image
        src="/images/groos-mark-dark.png"
        alt="GROOS"
        width={size}
        height={size}
        className={cn("logo-glow theme-logo-dark", className)}
        style={style}
      />
    </>
  );
}

export { LogoMark };
export default LogoMark;
