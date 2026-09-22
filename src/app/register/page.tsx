import { Suspense } from "react";
import { headers } from "next/headers";

import { PublicBrandHeader, brandThemeStyle } from "@/components/brand/public-brand-header";
import { resolveBrandByHost } from "@/lib/white-label/resolve-brand";
import { getEnabledOAuthProviders } from "@/lib/auth/oauth-providers";
import { RegisterForm } from "./_components/register-form";
import { RegisterHighlights } from "./_components/register-highlights";

/**
 * Real host-based white-label resolution for this pre-login page — there's
 * no session yet, so branding is resolved purely from the request's own
 * Host header against a verified CustomDomain row (resolveBrandByHost).
 * Falls back to the exact same unbranded UI as before when no verified
 * custom domain matches this host.
 */
export default async function RegisterPage() {
  const host = (await headers()).get("host");
  const branding = await resolveBrandByHost(host);

  // A reseller's rebranded signup page should never surface KVL's own
  // product positioning (e.g. "AI Career Agent") — only show the
  // highlights panel on the default, unbranded GrowthOS signup.
  const showHighlights = !branding.isWhiteLabeled;

  return (
    <main
      className="flex min-h-svh flex-col items-center justify-center gap-10 bg-background px-6 py-16 lg:flex-row lg:items-center lg:gap-20"
      style={brandThemeStyle(branding)}
    >
      {showHighlights && (
        <div className="hidden w-full max-w-sm lg:block">
          <RegisterHighlights />
        </div>
      )}
      <div className="flex w-full flex-col items-center gap-6">
        <PublicBrandHeader branding={branding} showDefaultLogo />
        <Suspense fallback={null}>
          <RegisterForm branding={branding} oauthProviders={getEnabledOAuthProviders()} />
        </Suspense>
      </div>
    </main>
  );
}
