"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { adjustGrowthTokensAction } from "../actions";

/**
 * Manual Growth Token grant/deduct — the only way to move an org's balance
 * outside a real spend/purchase/signup-bonus flow (e.g. "compensate a
 * client for a billing error" or "claw back tokens after a disputed
 * refund"). Mirrors AddPartnerDialog's Dialog + useTransition + toast
 * pattern (src/app/dashboard/referral-partners/_components/
 * add-partner-dialog.tsx) — the simplest existing create/edit-form dialog
 * in this app.
 */
export function AdjustTokensDialog({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [direction, setDirection] = useState<"grant" | "deduct">("grant");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  function reset() {
    setDirection("grant");
    setAmount("");
    setReason("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const magnitude = Number(amount);
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      setError("Enter a positive number of tokens.");
      return;
    }

    const deltaTokens = direction === "grant" ? magnitude : -magnitude;

    startTransition(async () => {
      const result = await adjustGrowthTokensAction(organizationId, deltaTokens, reason);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(direction === "grant" ? `Granted ${magnitude.toLocaleString()} tokens to ${organizationName}.` : `Deducted ${magnitude.toLocaleString()} tokens from ${organizationName}.`);
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <Coins className="size-3.5" /> Adjust
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="size-4" /> Adjust Growth Tokens — {organizationName}
          </DialogTitle>
          <DialogDescription>
            Grants or deducts real tokens outside any purchase/spend flow. Always requires a reason — this is
            recorded as a MANUAL_ADJUSTMENT event, visible in this organization&apos;s token history.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField label="Direction" htmlFor="adjust-direction" required>
            <Select id="adjust-direction" value={direction} onChange={(e) => setDirection(e.target.value as "grant" | "deduct")}>
              <option value="grant">Grant tokens (credit)</option>
              <option value="deduct">Deduct tokens (clawback)</option>
            </Select>
          </FormField>
          <FormField label="Amount (tokens)" htmlFor="adjust-amount" required>
            <Input id="adjust-amount" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </FormField>
          <FormField label="Reason" htmlFor="adjust-reason" hint="Shown in the organization's own token history — be specific." required>
            <Textarea id="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </FormField>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : direction === "grant" ? "Grant tokens" : "Deduct tokens"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
