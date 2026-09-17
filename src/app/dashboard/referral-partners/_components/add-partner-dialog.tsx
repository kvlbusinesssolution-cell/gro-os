"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { createReferralPartner } from "../_lib/referral-partner-actions";
import { PARTNER_TYPE_OPTIONS, partnerTypeLabel } from "../_lib/referral-partner-display";
import type { PartnerType } from "@/generated/prisma/client";

const DEFAULT_COMMISSION_RATE = "10";

/**
 * Manual "Add Partner" form — closes Gap 2 (KVL GrowthOS 2.0 Phase 8): the
 * only prior way a ReferralPartner row could exist was the AI Partner
 * Discovery job (always CANDIDATE). This is for a partner the user already
 * knows and has a real relationship with — createReferralPartner creates it
 * straight into ACTIVE with discoverySource "Manually added" (see that
 * action's doc comment). Mirrors ManualPaymentDialog's Dialog +
 * useTransition + toast pattern (billing/subscription/_components/
 * manual-payment-dialog.tsx), the simplest existing create-form dialog in
 * this app, rather than CompanyForm's inline-card-toggle pattern — a short
 * few-field form reads more naturally as a modal here.
 */
export function AddPartnerDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<PartnerType | "">("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [commissionRatePercent, setCommissionRatePercent] = useState(DEFAULT_COMMISSION_RATE);

  function reset() {
    setName("");
    setType("");
    setEmail("");
    setWebsite("");
    setCommissionRatePercent(DEFAULT_COMMISSION_RATE);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createReferralPartner({
        name,
        type: type || undefined,
        email,
        website,
        commissionRatePercent: commissionRatePercent ? Number(commissionRatePercent) : undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      toast.success("Partner added.");
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
        <Button type="button">
          <Plus className="size-4" /> Add partner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" /> Add referral partner
          </DialogTitle>
          <DialogDescription>
            For a freelancer, agency, or consultant you already have a real relationship with — this creates the
            partner directly as Active, not as a Candidate needing review (that status is reserved for AI Partner
            Discovery finds).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField label="Partner name" htmlFor="partner-name" required>
            <Input id="partner-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </FormField>
          <FormField label="Type" htmlFor="partner-type">
            <Select id="partner-type" value={type} onChange={(e) => setType(e.target.value as PartnerType | "")}>
              <option value="">Unspecified</option>
              {PARTNER_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {partnerTypeLabel(t)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Email" htmlFor="partner-email">
            <Input id="partner-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Website" htmlFor="partner-website">
            <Input
              id="partner-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://"
            />
          </FormField>
          <FormField label="Commission rate (%)" htmlFor="partner-commission-rate" required>
            <Input
              id="partner-commission-rate"
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={commissionRatePercent}
              onChange={(e) => setCommissionRatePercent(e.target.value)}
              required
            />
          </FormField>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add partner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
