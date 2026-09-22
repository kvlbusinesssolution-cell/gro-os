"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Menu, Moon, Sun, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { DURATIONS, EASES } from "@/animations";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { AnnouncementBar } from "@/components/ui/announcement-bar";
import { Logo } from "@/components/brand/logo";
import { ProfileMenu } from "@/app/dashboard/_components/profile-menu";

/* Absolute hrefs ("/#id" / "/product#id" not bare "#id"): this Navbar renders
   on both "/" and "/product" (see src/app/product/page.tsx), and a bare
   "#id" only resolves against whichever page is currently loaded — the
   absolute form always navigates to the right page's section regardless of
   where the user is. Security and FAQ live on /product now, not on the
   homepage (see src/app/product/page.tsx). */
const PRODUCT_LINKS = [
  {
    label: "AI Agents",
    href: "/#ai-agents",
    description: "Meet the five agents running your pipeline.",
  },
  {
    label: "How it works",
    href: "/#how-it-works",
    description: "From first touch to closed-won, step by step.",
  },
  {
    label: "Product tour",
    href: "/product",
    description: "The full walkthrough — dashboard, the shift to autonomous, every capability.",
  },
  {
    label: "Security",
    href: "/product#security",
    description: "How we protect your workspace and data.",
  },
  {
    label: "Trust Center",
    href: "/trust",
    description: "Compliance readiness, access control, and infrastructure — in detail.",
  },
  {
    label: "AI Runtime",
    href: "/ai-runtime",
    description: "How the AI infrastructure actually works — providers, failover, queues.",
  },
  {
    label: "Admin Platform",
    href: "/admin-platform",
    description: "Security, compliance, billing, and platform operations tooling.",
  },
  {
    label: "Developers",
    href: "/developers",
    description: "REST API, GraphQL, SDKs, CLI, webhooks, and a live playground.",
  },
] as const;

const NAV_LINKS = [
  { label: "Developers", href: "/developers" },
  { label: "Trust Center", href: "/trust" },
  { label: "FAQ", href: "/product#faq" },
] as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // Deliberate one-time mount flag (not derived state): next-themes cannot
    // know the resolved theme during SSR, so this defers icon rendering by
    // one tick to keep server and client markup identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <span className="size-4" />
      )}
    </button>
  );
}

function ProductMenu() {
  const [open, setOpen] = React.useState(false);
  const closeTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const scheduleClose = React.useCallback(() => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    closeTimeout.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const cancelClose = React.useCallback(() => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
  }, []);

  React.useEffect(() => {
    return () => {
      if (closeTimeout.current) clearTimeout(closeTimeout.current);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Product
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-200",
            open && "rotate-180",
          )}
          style={{ transitionTimingFunction: "var(--ease-out-quad)" }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: DURATIONS.fast, ease: EASES.outExpo }}
            className="absolute left-1/2 top-full z-50 mt-3 w-72 -translate-x-1/2 rounded-2xl border border-border bg-card p-2 shadow-elevated"
          >
            {PRODUCT_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex flex-col gap-0.5 rounded-xl px-3.5 py-2.5 transition-colors hover:bg-accent"
              >
                <span className="text-sm font-medium text-foreground">
                  {link.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {link.description}
                </span>
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Navbar({ user }: { user?: { name: string | null; email: string | null } | null }) {
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="sticky top-0 z-50 w-full">
      <AnnouncementBar
        message="KVL GrowthOS is now live — automate your first pipeline in 15 minutes."
        ctaLabel="Get started"
        ctaHref="/#cta"
      />

      <header
        className={cn(
          "w-full transition-colors duration-300",
          scrolled ? "glass-panel border-b" : "border-b border-transparent",
        )}
      >
        <Container>
          <nav className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center text-lg font-semibold">
              <Logo />
            </Link>

            <div className="hidden items-center gap-8 md:flex">
              <ProductMenu />
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="hidden items-center gap-3 md:flex">
              <ThemeToggle />
              {user ? (
                <>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/dashboard">Dashboard</Link>
                  </Button>
                  <ProfileMenu name={user.name} email={user.email} />
                </>
              ) : (
                <Button size="sm" asChild>
                  <Link href="/register">Start free trial</Link>
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 md:hidden">
              <ThemeToggle />
              <button
                type="button"
                aria-label="Toggle menu"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen((open) => !open)}
                className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-foreground"
              >
                {mobileOpen ? (
                  <X className="size-4" />
                ) : (
                  <Menu className="size-4" />
                )}
              </button>
            </div>
          </nav>

          {mobileOpen ? (
            <div className="flex flex-col gap-1 border-t border-border py-4 md:hidden">
              {PRODUCT_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
              {user ? (
                <div className="mt-2 flex items-center gap-3">
                  <Button size="sm" variant="outline" className="flex-1" asChild>
                    <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                      Dashboard
                    </Link>
                  </Button>
                  <ProfileMenu name={user.name} email={user.email} />
                </div>
              ) : (
                <Button size="sm" className="mt-2" asChild>
                  <Link href="/register" onClick={() => setMobileOpen(false)}>
                    Start free trial
                  </Link>
                </Button>
              )}
            </div>
          ) : null}
        </Container>
      </header>
    </div>
  );
}

export default Navbar;
export { Navbar };
