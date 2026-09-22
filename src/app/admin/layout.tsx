import Link from "next/link";
import { LogOut } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { signOutAction } from "@/app/dashboard/actions";
import { AdminSidebar } from "./_components/admin-sidebar";

/**
 * Shared shell for every /admin/* page — header + left sidebar + main
 * content. Deliberately does NOT gate access itself (same pattern as
 * src/app/dashboard/layout.tsx and src/app/board/layout.tsx) — every page
 * underneath already calls requirePlatformOwner(<its own exact path>) as
 * the sole, authoritative gate, with a precise callbackUrl back to wherever
 * the visitor was actually trying to go. A second check here would either
 * duplicate that or redirect with a less precise callbackUrl, so this file
 * stays purely presentational. Not organization-scoped — no org switcher,
 * no membership-derived data — the platform panel is deliberately
 * independent of any one tenant.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[40rem] bg-mesh-gradient" />

      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <Container className="flex h-16 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex items-center">
              <Logo size={40} />
            </Link>
            <span className="hidden h-5 w-px bg-border sm:block" />
            <span className="hidden text-sm font-medium text-muted-foreground sm:inline">Platform Admin</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="size-3.5" /> Sign out
              </Button>
            </form>
          </div>
        </Container>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border lg:block">
          <AdminSidebar />
        </aside>
        <main id="main-content" className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
