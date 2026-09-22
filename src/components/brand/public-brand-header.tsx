import type { CSSProperties } from "react";

import { Logo } from "./logo";
import type { EffectiveBranding } from "@/lib/white-label/resolve-brand";

/**
 * Pre-login brand header for public/unauthenticated pages — mirrors the
 * exact same `branding.logoUrl && <img/>` conditional the authenticated
 * dashboard/portal chrome already uses (src/app/dashboard/layout.tsx,
 * src/app/portal/layout.tsx), rendered once per page instead of from a
 * shared layout since none of these routes have a route-segment layout.tsx
 * of their own.
 *
 * When the request IS white-labeled, always shows that org's own real
 * logo — never GROOS's own branding — regardless of `showDefaultLogo`.
 *
 * `showDefaultLogo` controls what an UNBRANDED request sees: `true` (login,
 * register, forgot/reset password — real GrowthOS-tenant-user auth pages)
 * shows the real GROOS logo. `false`/omitted (the client-portal login,
 * src/app/portal/login/page.tsx) renders nothing, on purpose — the Client
 * Portal is the one surface a TENANT's own end customer sees, who has no
 * relationship with GROOS at all, so it must never show a platform logo it
 * has no white-label alternative for (see src/app/portal/layout.tsx's own
 * "never KVL GrowthOS" doc comment — the same rule, applied consistently).
 */
export function PublicBrandHeader({ branding, showDefaultLogo = false }: { branding: EffectiveBranding; showDefaultLogo?: boolean }) {
  if (branding.logoUrl) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- org-uploaded asset, not a static/optimizable local image */}
        <img src={branding.logoUrl} alt={branding.brandName} className="h-8 w-auto" />
        <span className="text-sm font-medium text-muted-foreground">{branding.brandName}</span>
      </div>
    );
  }

  if (!showDefaultLogo) return null;

  return <Logo size={48} />;
}

/**
 * Real theme-color override for these pages — overrides the `--primary` CSS
 * custom property (the same variable `.btn-animated-gradient` and the
 * card/glow accents in globals.css already read from) for the subtree it's
 * applied to, only when the resolved org actually set a primaryColor.
 * Undefined (no style prop at all) otherwise, so an unbranded request's
 * markup is byte-for-byte what it was before this existed.
 */
export function brandThemeStyle(branding: EffectiveBranding): CSSProperties | undefined {
  if (!branding.primaryColor) return undefined;
  return { "--primary": branding.primaryColor } as CSSProperties;
}
