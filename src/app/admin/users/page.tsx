import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Users, ShieldCheck, Lock, MailWarning, ShieldQuestion } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requirePlatformOwner } from "@/lib/billing/platform-admin";
import { UserRowActions } from "./_components/user-row-actions";

const PAGE_SIZE = 50;

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface UsersSearchParams {
  q?: string;
}

/**
 * Platform-owner-only, cross-tenant User Management — the piece
 * admin-sidebar.tsx's own header comment flagged as deliberately out of
 * scope for the rest of /admin ("those pages are per-organization and have
 * no meaningful platform view without picking a specific tenant first").
 * A real user is not scoped to one organization (memberships is a
 * many-relation), so this page — unlike every other admin page — is the one
 * legitimately cross-tenant view of the User table itself: search, real
 * org membership counts, and the handful of actions that only make sense
 * platform-wide (grant/revoke super-admin, clear a lockout, force sign-out
 * everywhere) rather than from any one organization's own settings.
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<UsersSearchParams> }) {
  await requirePlatformOwner("/admin/users");

  const params = await searchParams;
  const q = params.q?.trim() ?? "";

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [users, totalUsers, platformOwnerCount, lockedCount, unverifiedCount, twoFactorCount] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        isPlatformOwner: true,
        emailVerified: true,
        twoFactorEnabled: true,
        lockedUntil: true,
        createdAt: true,
        memberships: {
          where: { status: "ACTIVE" },
          select: { organization: { select: { name: true } } },
          take: 3,
        },
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.user.count(),
    prisma.user.count({ where: { isPlatformOwner: true } }),
    prisma.user.count({ where: { lockedUntil: { gt: new Date() } } }),
    prisma.user.count({ where: { emailVerified: null } }),
    prisma.user.count({ where: { twoFactorEnabled: true } }),
  ]);

  return (
    <Container className="flex flex-col gap-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">User Management</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every real user account on the platform, across every organization — {totalUsers} total. Showing the most
          recent {Math.min(users.length, PAGE_SIZE)}{q ? " matching" : ""}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Users className="size-3.5" /> Total users
            </div>
            <p className="text-2xl font-semibold text-foreground">{totalUsers.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Platform owners
            </div>
            <p className="text-2xl font-semibold text-foreground">{platformOwnerCount}</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Lock className="size-3.5" /> Locked out right now
            </div>
            <p className="text-2xl font-semibold text-foreground">{lockedCount}</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MailWarning className="size-3.5" /> Unverified email
            </div>
            <p className="text-2xl font-semibold text-foreground">{unverifiedCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card glass>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <FormField label="Name or email" htmlFor="user-search" className="flex-1">
              <Input id="user-search" name="q" defaultValue={q} placeholder="jane@example.com" />
            </FormField>
            <Button type="submit" size="sm">
              Search
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {twoFactorCount} of {totalUsers} have 2FA enabled. Sorted by newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users match this search.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Organizations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const isLocked = !!user.lockedUntil && user.lockedUntil > new Date();
                  const label = user.name || user.email || user.id;
                  const orgNames = user.memberships.map((m) => m.organization.name);
                  const extraOrgs = user._count.memberships - orgNames.length;

                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{user.name || "—"}</span>
                          <span className="text-xs text-muted-foreground">{user.email || "no email"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {orgNames.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No memberships</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {orgNames.join(", ")}
                            {extraOrgs > 0 ? ` +${extraOrgs} more` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {user.isPlatformOwner && (
                            <Badge variant="accent">
                              <ShieldCheck className="size-3" /> Owner
                            </Badge>
                          )}
                          {isLocked && (
                            <Badge variant="outline">
                              <Lock className="size-3" /> Locked
                            </Badge>
                          )}
                          {!user.emailVerified && (
                            <Badge variant="secondary">
                              <MailWarning className="size-3" /> Unverified
                            </Badge>
                          )}
                          {!user.isPlatformOwner && !isLocked && user.emailVerified && (
                            <Badge variant="outline">
                              <ShieldQuestion className="size-3" /> Standard
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                      <TableCell>
                        <UserRowActions userId={user.id} userLabel={label} isPlatformOwner={user.isPlatformOwner} isLocked={isLocked} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
