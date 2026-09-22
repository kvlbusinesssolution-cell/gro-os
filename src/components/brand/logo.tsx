import Image from "next/image";

import { cn } from "@/lib/utils";

import { LogoMark } from "./logo-mark";

interface LogoProps {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}

// Real source aspect ratio of public/images/groos-logo-{light,dark}.png
// (the single-line "GROOS" lockup) — used to derive width from `size`
// (treated as the rendered height) without distorting the image.
const FULL_LOGO_ASPECT = 2172 / 724;

function Logo({ className, showWordmark = true, size = 67 }: LogoProps) {
  if (!showWordmark) {
    return <LogoMark size={size} className={className} />;
  }

  const height = size;
  const width = Math.round(height * FULL_LOGO_ASPECT);
  const style = { width, height, objectFit: "contain" as const };

  return (
    <>
      <Image
        src="/images/groos-logo-light.png"
        alt="GROOS"
        width={width}
        height={height}
        className={cn("logo-glow theme-logo-light shrink-0", className)}
        style={style}
      />
      <Image
        src="/images/groos-logo-dark.png"
        alt="GROOS"
        width={width}
        height={height}
        className={cn("logo-glow theme-logo-dark shrink-0", className)}
        style={style}
      />
    </>
  );
}

export { Logo };
export default Logo;
