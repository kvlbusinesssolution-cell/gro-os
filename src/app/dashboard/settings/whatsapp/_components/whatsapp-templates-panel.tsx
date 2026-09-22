"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addWhatsAppTemplateAction } from "../_lib/whatsapp-settings-actions";
import type { WhatsAppTemplate } from "@/generated/prisma/client";

const STATUS_VARIANT: Record<string, "accent" | "secondary" | "outline"> = {
  APPROVED: "accent",
  PENDING: "secondary",
  REJECTED: "outline",
  DISABLED: "outline",
  UNKNOWN: "outline",
};

/**
 * §16 — templates recorded here must match your real Twilio Content API
 * template exactly (Content SID, approval status) — this app has no live
 * Twilio sync in this environment, so approval status is admin-entered
 * from what Twilio's own console actually shows, never assumed.
 */
export function WhatsAppTemplatesPanel({ templates }: { templates: WhatsAppTemplate[] }) {
  const [isPending, startTransition] = useTransition();
  const [list, setList] = useState(templates);
  const [providerTemplateId, setProviderTemplateId] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState("UTILITY");
  const [approvalStatus, setApprovalStatus] = useState<"PENDING" | "APPROVED" | "REJECTED" | "DISABLED" | "UNKNOWN">("UNKNOWN");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await addWhatsAppTemplateAction({ providerTemplateId, name, language, category, variables: [], approvalStatus });
      if (!result.ok || !result.data) return setError(result.error ?? "Failed to save template.");
      setList((prev) => [result.data!, ...prev.filter((t) => t.id !== result.data!.id)]);
      setProviderTemplateId("");
      setName("");
    });
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="text-base">WhatsApp templates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <Input placeholder="Content SID" value={providerTemplateId} onChange={(e) => setProviderTemplateId(e.target.value)} />
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Language (en)" value={language} onChange={(e) => setLanguage(e.target.value)} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="UTILITY">Utility</option>
            <option value="MARKETING">Marketing</option>
            <option value="AUTHENTICATION">Authentication</option>
          </Select>
          <Select value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value as typeof approvalStatus)}>
            <option value="UNKNOWN">Unknown</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="DISABLED">Disabled</option>
          </Select>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit gap-1.5" onClick={add} disabled={isPending || !providerTemplateId.trim() || !name.trim()}>
          <Plus className="size-3.5" /> Add / update template
        </Button>

        {list.length === 0 ? (
          <p className="text-xs text-muted-foreground">No templates recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Content SID</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.providerTemplateId}</TableCell>
                  <TableCell>{t.language}</TableCell>
                  <TableCell>{t.category}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.approvalStatus]}>{t.approvalStatus}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
