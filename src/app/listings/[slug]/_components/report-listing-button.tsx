"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { reportListing } from "../_lib/public-actions";
import type { ReportListingInput } from "@/lib/validations/listings";

const REASON_LABEL: Record<ReportListingInput["reason"], string> = {
  INCORRECT_INFO: "Incorrect information",
  PERMANENTLY_CLOSED: "Permanently closed",
  SPAM_OR_SCAM: "Spam or scam",
  INAPPROPRIATE_CONTENT: "Inappropriate content",
  DUPLICATE: "Duplicate listing",
  OTHER: "Other",
};

export function ReportListingButton({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState<ReportListingInput["reason"]>("INCORRECT_INFO");
  const [details, setDetails] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState(""); // honeypot

  function submit() {
    startTransition(async () => {
      const result = await reportListing(listingId, { reason, details, reporterEmail, companyWebsite });
      if (!result.ok) {
        toast.error(result.error ?? "Could not send this report.");
        return;
      }
      toast.success("Thanks — our team will review this listing.");
      setOpen(false);
      setDetails("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Flag className="size-3.5" /> Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this listing</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={reason} onChange={(e) => setReason(e.target.value as ReportListingInput["reason"])}>
            {Object.entries(REASON_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Textarea placeholder="Tell us what's wrong (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
          <Input placeholder="Your email (optional, if you'd like a response)" type="email" value={reporterEmail} onChange={(e) => setReporterEmail(e.target.value)} />
          <input
            type="text"
            value={companyWebsite}
            onChange={(e) => setCompanyWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute h-0 w-0 opacity-0"
          />
        </div>
        <DialogFooter>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? "Sending…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
