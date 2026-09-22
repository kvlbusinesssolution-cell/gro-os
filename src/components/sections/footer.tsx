import { Globe } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Logo } from "@/components/brand/logo";
import { getSiteUrl } from "@/lib/site-config";

// "Integrations" (public page doesn't exist yet — only the authenticated
// /dashboard/settings/integrations does) and the "Company" group's
// About/Careers/Blog (no real company history/bios/job listings exist to
// source from) are deliberately omitted rather than linked to "#" or a fake
// "coming soon" page — a shorter, fully-working footer is more honest than
// one with dead ends.
const LINK_GROUPS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/product" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Trust Center", href: "/trust" },
      { label: "AI Runtime", href: "/ai-runtime" },
      { label: "Admin Platform", href: "/admin-platform" },
      { label: "Developers", href: "/developers" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Contact", href: "/contact" },
      // Real, public, unauthenticated status page — see src/app/status/page.tsx.
      { label: "System Status", href: "/status" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Cookie Policy", href: "/cookies" },
    ],
  },
] as const;

// Chat social icon is omitted rather than linked to "#" — no live-chat
// tool exists yet; an absent icon reads as honest, a dead-linked one
// doesn't. Email now has a real inbox (PLATFORM_SUPPORT_EMAIL), so it's
// linked below.
const SUPPORT_EMAIL = process.env.PLATFORM_SUPPORT_EMAIL || "support@kvlbusinesssolutions.com";

const SOCIAL_LINKS = [{ label: "Website", icon: Globe, href: getSiteUrl() }] as const;

function Footer() {
  return (
    <footer className="relative border-t border-border py-16">
      <Container>
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-4">
            <a href="#top" className="text-lg font-semibold">
              <Logo />
            </a>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              The AI-powered business growth operating system that unifies
              acquisition, growth intelligence, and execution into one
              command center.
            </p>
            <div className="mt-2 flex items-center gap-3">
              {SOCIAL_LINKS.map(({ label, icon: Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon className="size-4" strokeWidth={2} />
                </a>
              ))}
            </div>
          </div>

          {LINK_GROUPS.map((group) => (
            <div key={group.heading} className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {group.heading}
              </h3>
              <ul className="flex flex-col gap-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center gap-4 border-t border-border pt-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-xs text-muted-foreground">
            © 2026 KVL Business Solutions. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <p className="text-xs text-muted-foreground">
              Built for growth teams that move fast.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </Container>
    </footer>
  );
}

export default Footer;
export { Footer };
