import Link from "next/link";
import { cookies, headers } from "next/headers";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAIConnectionStatus } from "@/lib/ai/status";
import { getGrowthTokenAvailability } from "@/lib/billing/growth-tokens";
import { EXECUTIVE_AGENT_TYPES } from "@/lib/ai/personas";
import { Container } from "@/components/ui/container";
import { CommandPalette } from "@/components/command-center/command-palette";
import { GlobalSearch } from "@/components/command-center/global-search";
import { QuickActions } from "@/components/command-center/quick-actions";
import { RealtimeRefresher } from "@/components/command-center/realtime-refresher";
import { TranslationProvider } from "@/components/providers/translation-provider";
import { getDictionary, isRtlLocale, localeForOrganizationLanguage, localeFromAcceptLanguageHeader } from "@/lib/i18n";
import { getEffectiveBranding } from "@/lib/white-label/resolve-brand";

import { NotificationBell, type BoardNotification } from "@/app/board/_components/notification-bell";
import { EmailVerificationBanner } from "./_components/email-verification-banner";
import { DashboardSidebar } from "./_components/sidebar";
import { ThemeToggle } from "./_components/theme-toggle";
import { LocaleSelector } from "./_components/locale-selector";
import { WorkspaceSwitcher, type SwitchableOrg } from "./_components/workspace-switcher";
import { AiStatusBadge } from "./_components/ai-status-badge";
import { GrowthTokenBadge } from "./_components/growth-token-badge";
import { LiveMeetingBadge } from "./_components/live-meeting-badge";
import { ProfileMenu } from "./_components/profile-menu";
import { ActivityBar, type ActivityBarItem } from "./_components/activity-bar";
import { ACTIVE_ORG_COOKIE } from "./_lib/require-membership";
import { Logo } from "@/components/brand/logo";
import { DeviceFingerprintReporter } from "./_components/device-fingerprint-reporter";

/**
 * Command Center shell: top nav + left sidebar + bottom activity bar,
 * wrapping every /dashboard/* page.
 *
 * Merge note: a parallel task had already created this file solely to mount
 * <CommandPalette /> (the Cmd+K palette) before this shell existed — that
 * mount is preserved below. The top nav's search trigger reuses that same
 * task's <GlobalSearch /> (src/components/command-center/global-search.tsx)
 * rather than a second, duplicate search implementation.
 *
 * Deliberately does NOT redirect unauthenticated visitors itself — same
 * pattern as src/app/board/layout.tsx — every page underneath performs its
 * own auth()+membership check and redirect via requireActiveMembership()
 * (see ./_lib/require-membership.ts).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <>
        <CommandPalette />
        {children}
      </>
    );
  }

  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: { organization: true },
  });

  if (memberships.length === 0) {
    return (
      <>
        <CommandPalette />
        {children}
      </>
    );
  }

  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const activeMembership = memberships.find((m) => m.organizationId === preferredOrgId) ?? memberships[0];
  const organizationId = activeMembership.organizationId;
  const isCareerOrg = activeMembership.organization.type === "CAREER";

  const [
    notifications,
    unreadCount,
    preference,
    aiStatus,
    tokenAvailability,
    liveMeeting,
    recentActivities,
    quickActionAgents,
    quickActionMemberships,
    quickActionCompanies,
    quickActionClients,
    currentUser,
    branding,
  ] =
    await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.notification.count({ where: { userId, read: false } }),
      prisma.userPreference.findUnique({ where: { userId } }),
      getAIConnectionStatus(),
      getGrowthTokenAvailability(organizationId),
      prisma.meeting.findFirst({ where: { organizationId, status: "LIVE" }, select: { id: true, title: true } }),
      prisma.activity.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { actorAgent: { select: { name: true } }, actorUser: { select: { name: true } } },
      }),
      prisma.aIAgentInstance.findMany({
        where: { organizationId, active: true, type: { in: EXECUTIVE_AGENT_TYPES } },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.membership.findMany({
        where: { organizationId, status: "ACTIVE" },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      isCareerOrg ? Promise.resolve([]) : prisma.company.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      isCareerOrg ? Promise.resolve([]) : prisma.client.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } }),
      getEffectiveBranding(organizationId),
    ]);

  const boardNotifications: BoardNotification[] = notifications.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    read: n.read,
    createdAt: n.createdAt,
  }));

  const organizations: SwitchableOrg[] = memberships.map((m) => ({ id: m.organizationId, name: m.organization.name }));

  const activityItems: ActivityBarItem[] = recentActivities.map((a) => ({
    id: a.id,
    type: a.type,
    description: a.description,
    actorName: a.actorAgent?.name ?? a.actorUser?.name ?? null,
    createdAt: a.createdAt,
  }));

  // Preference order: the user's own explicit choice, then their org's
  // onboarding-time primary language (real fallback, not a guess — see
  // localeForOrganizationLanguage), then the browser's real Accept-Language
  // header (also a real signal, never a guess — see
  // localeFromAcceptLanguageHeader), then English.
  const acceptLanguage = (await headers()).get("accept-language");
  const locale =
    preference?.locale ??
    localeForOrganizationLanguage(activeMembership.organization.primaryLanguage) ??
    localeFromAcceptLanguageHeader(acceptLanguage) ??
    "en";
  const dictionary = getDictionary(locale);

  return (
    <TranslationProvider dictionary={dictionary}>
    <div className="relative flex min-h-svh flex-col bg-background" dir={isRtlLocale(locale) ? "rtl" : "ltr"}>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[40rem] bg-mesh-gradient" />
      <CommandPalette />
      <DeviceFingerprintReporter />
      <RealtimeRefresher organizationId={organizationId} />

      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <Container className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <Link href="/dashboard" className="flex items-center">
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- org-uploaded asset, not a static/optimizable local image
                <img src={branding.logoUrl} alt={branding.brandName} className="h-[22px] w-auto" />
              ) : (
                <Logo size={40} />
              )}
            </Link>
            <span className="hidden h-5 w-px bg-border sm:block" />
            <WorkspaceSwitcher organizations={organizations} activeOrgId={organizationId} />
          </div>

          <div className="hidden min-w-0 flex-1 justify-center px-4 md:flex">
            <GlobalSearch className="w-full max-w-sm" />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <LiveMeetingBadge meeting={liveMeeting} />
            <GrowthTokenBadge unlimited={tokenAvailability.unlimited} remainingTokens={tokenAvailability.unlimited ? 0 : tokenAvailability.remainingTokens} />
            <AiStatusBadge status={aiStatus} />
            <LocaleSelector initialLocale={locale} />
            <ThemeToggle />
            <NotificationBell initialNotifications={boardNotifications} initialUnreadCount={unreadCount} />
            <ProfileMenu name={session.user?.name ?? null} email={session.user?.email ?? null} />
          </div>
        </Container>
        <div className="border-t border-border px-4 py-2 md:hidden">
          <GlobalSearch className="w-full" />
        </div>
      </header>

      {!currentUser?.emailVerified && <EmailVerificationBanner />}

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border lg:block">
          <DashboardSidebar organizationType={activeMembership.organization.type} />
        </aside>
        <main id="main-content" className="min-w-0 flex-1 pb-16">{children}</main>
      </div>

      <ActivityBar items={activityItems} />
      {!isCareerOrg && (
        <QuickActions
          agents={quickActionAgents}
          users={quickActionMemberships.map((m) => m.user)}
          companies={quickActionCompanies}
          clients={quickActionClients}
        />
      )}
    </div>
    </TranslationProvider>
  );
}
