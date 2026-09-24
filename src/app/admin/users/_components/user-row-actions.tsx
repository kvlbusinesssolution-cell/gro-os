"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff, Unlock, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { setPlatformOwnerAction, unlockUserAccountAction, forceSignOutAction } from "../actions";

/**
 * Per-row platform-admin actions for the User Management table
 * (src/app/admin/users/page.tsx). Mirrors AdjustTokensDialog's Dialog +
 * useTransition + toast pattern for the sensitive owner-toggle (requires a
 * reason, same as a Growth Token adjustment), and MarkPaidButton's plain
 * confirm() pattern for the two lower-stakes support actions.
 */
export function UserRowActions({
  userId,
  userLabel,
  isPlatformOwner,
  isLocked,
}: {
  userId: string;
  userLabel: string;
  isPlatformOwner: boolean;
  isLocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleOwnerSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await setPlatformOwnerAction(userId, !isPlatformOwner, reason);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(!isPlatformOwner ? `Granted platform-owner access to ${userLabel}.` : `Revoked platform-owner access from ${userLabel}.`);
      setReason("");
      setOwnerDialogOpen(false);
      router.refresh();
    });
  }

  function handleUnlock() {
    if (!confirm(`Clear the lockout on ${userLabel}? They'll be able to sign in immediately.`)) return;
    startTransition(async () => {
      const result = await unlockUserAccountAction(userId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not unlock this account.");
        return;
      }
      toast.success("Account unlocked.");
      router.refresh();
    });
  }

  function handleForceSignOut() {
    if (!confirm(`Sign ${userLabel} out of every device? They'll need to log in again everywhere.`)) return;
    startTransition(async () => {
      const result = await forceSignOutAction(userId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not sign this account out.");
        return;
      }
      toast.success("Signed out everywhere.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog
        open={ownerDialogOpen}
        onOpenChange={(next) => {
          setOwnerDialogOpen(next);
          if (!next) {
            setReason("");
            setError(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant={isPlatformOwner ? "outline" : "secondary"}>
            {isPlatformOwner ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
            {isPlatformOwner ? "Revoke owner" : "Make owner"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isPlatformOwner ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
              {isPlatformOwner ? "Revoke" : "Grant"} platform-owner access — {userLabel}
            </DialogTitle>
            <DialogDescription>
              {isPlatformOwner
                ? "Removes cross-tenant /admin access from this account. Recorded on the tamper-evident audit log."
                : "Grants full cross-tenant /admin access — every organization's data, billing, and this same User Management page. Recorded on the tamper-evident audit log."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleOwnerSubmit} className="flex flex-col gap-4">
            <FormField label="Reason" htmlFor="owner-reason" hint="Shown on this account's audit trail — be specific." required>
              <Textarea id="owner-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </FormField>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="submit"
                disabled={pending}
                variant={isPlatformOwner ? "outline" : "default"}
                className={isPlatformOwner ? "border-destructive/40 text-destructive hover:bg-destructive/10" : undefined}
              >
                {pending ? "Saving…" : isPlatformOwner ? "Revoke access" : "Grant access"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isLocked && (
        <Button type="button" size="sm" variant="outline" onClick={handleUnlock} disabled={pending}>
          <Unlock className="size-3.5" /> Unlock
        </Button>
      )}

      <Button type="button" size="sm" variant="outline" onClick={handleForceSignOut} disabled={pending}>
        <LogOut className="size-3.5" /> Sign out everywhere
      </Button>
    </div>
  );
}
