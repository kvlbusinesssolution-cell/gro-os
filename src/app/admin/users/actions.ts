"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requirePlatformOwner } from "@/lib/billing/platform-admin";
import { logAudit } from "@/lib/audit";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Grants or revokes platform-owner (super admin) access — a cross-tenant,
 * security-critical decision, same gate as every other /admin/* action.
 * Always requires a reason, recorded on the real AuditLog hash chain
 * (src/lib/audit.ts). Refuses to revoke the last remaining platform owner
 * so the deployment can never lock itself out of /admin entirely.
 */
export async function setPlatformOwnerAction(userId: string, grant: boolean, reason: string): Promise<ActionResult> {
  const admin = await requirePlatformOwner("/admin/users");
  if (!reason.trim()) return { ok: false, error: "A reason is required." };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isPlatformOwner: true } });
  if (!user) return { ok: false, error: "User not found." };

  if (!grant && user.isPlatformOwner) {
    const remaining = await prisma.user.count({ where: { isPlatformOwner: true } });
    if (remaining <= 1) {
      return { ok: false, error: "Cannot revoke the last remaining platform owner — the platform would have no admin left." };
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { isPlatformOwner: grant } });
  await logAudit({
    userId: admin.userId,
    action: grant ? "admin_user.platform_owner_granted" : "admin_user.platform_owner_revoked",
    metadata: { targetUserId: userId, reason },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

/** Clears a persistent lockout (User.lockedUntil/failedLoginAttempts) — a real support action for an account locked out after too many failed sign-in attempts (see src/auth.ts's MAX_FAILED_ATTEMPTS/LOCKOUT_MINUTES). */
export async function unlockUserAccountAction(userId: string): Promise<ActionResult> {
  const admin = await requirePlatformOwner("/admin/users");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: "User not found." };

  await prisma.user.update({ where: { id: userId }, data: { lockedUntil: null, failedLoginAttempts: 0 } });
  await logAudit({ userId: admin.userId, action: "admin_user.unlocked", metadata: { targetUserId: userId } });

  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Platform-admin-triggered "sign out everywhere" for a compromised or
 * offboarded account — sets User.sessionInvalidatedAt, the same field the
 * user's own profile settings sets for self-service logout-all-devices
 * (src/app/profile/actions.ts, signOutAllDevices). This app uses stateless
 * JWT sessions, so there is no server-side session row to delete — every
 * request's jwt() callback in src/auth.ts instead rejects any token minted
 * before this timestamp, forcing re-authentication everywhere.
 */
export async function forceSignOutAction(userId: string): Promise<ActionResult> {
  const admin = await requirePlatformOwner("/admin/users");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: "User not found." };

  await prisma.user.update({ where: { id: userId }, data: { sessionInvalidatedAt: new Date() } });
  await logAudit({ userId: admin.userId, action: "admin_user.force_signed_out", metadata: { targetUserId: userId } });

  revalidatePath("/admin/users");
  return { ok: true };
}
