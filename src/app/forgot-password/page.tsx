import { headers } from "next/headers";

import { PublicBrandHeader, brandThemeStyle } from "@/components/brand/public-brand-header";
import { resolveBrandByHost } from "@/lib/white-label/resolve-brand";
import { ForgotPasswordForm } from "./_components/forgot-password-form";

/**
 * Real host-based white-label resolution for this pre-login page — there's
 * no session yet, so branding is resolved purely from the request's own
 * Host header against a verified CustomDomain row (resolveBrandByHost).
 * Falls back to the exact same unbranded UI as before when no verified
 * custom domain matches this host.
 */
export default async function ForgotPasswordPage() {
  const host = (await headers()).get("host");
  const branding = await resolveBrandByHost(host);

  return (
    <main
      className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6"
      style={brandThemeStyle(branding)}
    >
      <PublicBrandHeader branding={branding} showDefaultLogo />
      <ForgotPasswordForm />
    </main>
  );
}
