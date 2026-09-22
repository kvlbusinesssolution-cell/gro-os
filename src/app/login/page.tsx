import { Suspense } from "react";
import { headers } from "next/headers";

import { PublicBrandHeader, brandThemeStyle } from "@/components/brand/public-brand-header";
import { resolveBrandByHost } from "@/lib/white-label/resolve-brand";
import { getEnabledOAuthProviders } from "@/lib/auth/oauth-providers";
import { LoginForm } from "./_components/login-form";
import { LoginShowcasePanel } from "./_components/login-showcase-panel";

/**
 * Real host-based white-label resolution for this pre-login page — there's
 * no session yet, so branding is resolved purely from the request's own
 * Host header against a verified CustomDomain row (resolveBrandByHost).
 * Falls back to the exact same unbranded UI as before when no verified
 * custom domain matches this host.
 */
export default async function LoginPage() {
  const host = (await headers()).get("host");
  const branding = await resolveBrandByHost(host);

  return (
    <main className="relative flex min-h-svh overflow-hidden bg-background" style={brandThemeStyle(branding)}>
      {/* Decorative on lg+ only — a real product showcase (unbranded) or a
          neutral branded welcome panel (white-labeled), never GrowthOS's own
          marketing copy leaking into a client's branded experience. */}
      <LoginShowcasePanel branding={branding} />

      <div className="relative flex w-full flex-1 flex-col items-center justify-center gap-6 px-6 py-16 lg:w-1/2">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full bg-radial-fade lg:hidden"
        />
        <PublicBrandHeader branding={branding} showDefaultLogo />
        <Suspense fallback={null}>
          <LoginForm branding={branding} oauthProviders={getEnabledOAuthProviders()} />
        </Suspense>
      </div>
    </main>
  );
}
