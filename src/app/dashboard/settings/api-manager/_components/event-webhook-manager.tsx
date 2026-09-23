"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Copy, KeyRound, Webhook as WebhookIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import type { Webhook, WebhookEventType } from "@/generated/prisma/client";
import {
  createWebhookAction,
  listWebhooksAction,
  rotateWebhookSecretAction,
  toggleWebhookActiveAction,
  deleteWebhookAction,
  updateWebhookEventTypesAction,
} from "@/app/dashboard/automation/actions";

const EVENT_TYPES: { value: WebhookEventType; label: string }[] = [
  { value: "CONTACT_CREATED", label: "Contact created" },
  { value: "COMPANY_CREATED", label: "Company created" },
  { value: "DEAL_WON", label: "Deal won" },
  { value: "DEAL_LOST", label: "Deal lost" },
  { value: "APPLICATION_STATUS_CHANGED", label: "Application status changed" },
];

interface RevealedSecret {
  secret: string;
}

async function copyToClipboard(value: string) {
  await navigator.clipboard.writeText(value);
  toast.success("Copied to clipboard.");
}

/**
 * Platform event-bus subscription management (Phase 33) — real create/list/
 * rotate/toggle/delete/subscribe wired to the same Server Actions
 * src/app/dashboard/automation/actions.ts already exposes for
 * Workflow-scoped webhooks (workflowId simply omitted here), plus the new
 * updateWebhookEventTypesAction for picking which typed events a row
 * receives. Lists ONLY rows with a non-empty eventTypes — a Workflow's own
 * webhooks (managed from its own detail page) never leak in here, and a row
 * created here never appears on a Workflow detail page, since neither view
 * sets the other's distinguishing field.
 */
export function EventWebhookManager() {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);

  const [targetUrl, setTargetUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<WebhookEventType[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotatingPending, startRotate] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [togglingPending, startToggle] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingPending, startDelete] = useTransition();
  const [savingEventsId, setSavingEventsId] = useState<string | null>(null);
  const [savingEventsPending, startSaveEvents] = useTransition();

  const refetch = useCallback(() => {
    setLoadError(null);
    listWebhooksAction().then((result) => {
      if (!result.ok || !result.webhooks) {
        setLoadError(result.error ?? "Could not load event webhooks.");
        return;
      }
      setWebhooks(result.webhooks.filter((webhook) => webhook.eventTypes.length > 0));
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch]);

  function toggleEventSelection(eventType: WebhookEventType) {
    setSelectedEvents((prev) => (prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]));
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (selectedEvents.length === 0) {
      setCreateError("Select at least one event type.");
      return;
    }
    startCreate(async () => {
      const result = await createWebhookAction({ direction: "OUTGOING", targetUrl, eventTypes: selectedEvents });
      if (!result.ok || !result.webhook || !result.plaintextSecret) {
        setCreateError(result.error ?? "Could not create this event webhook.");
        toast.error(result.error ?? "Could not create this event webhook.");
        return;
      }
      setRevealed({ secret: result.plaintextSecret });
      toast.success("Event webhook created.");
      setTargetUrl("");
      setSelectedEvents([]);
      refetch();
    });
  }

  function handleRotate(webhook: Webhook) {
    if (!confirm("Rotate this webhook's signing secret? The old secret stops working immediately.")) return;
    setRotatingId(webhook.id);
    startRotate(async () => {
      const result = await rotateWebhookSecretAction(webhook.id);
      setRotatingId(null);
      if (!result.ok || !result.plaintextSecret) {
        toast.error(result.error ?? "Could not rotate this secret.");
        return;
      }
      setRevealed({ secret: result.plaintextSecret });
      toast.success("Secret rotated.");
      refetch();
    });
  }

  function handleToggle(webhook: Webhook) {
    setTogglingId(webhook.id);
    startToggle(async () => {
      const result = await toggleWebhookActiveAction(webhook.id, !webhook.active);
      setTogglingId(null);
      if (!result.ok) {
        toast.error(result.error ?? "Could not update this webhook.");
        return;
      }
      toast.success(webhook.active ? "Webhook deactivated." : "Webhook activated.");
      refetch();
    });
  }

  function handleDelete(webhook: Webhook) {
    if (!confirm("Delete this event webhook? This can't be undone.")) return;
    setDeletingId(webhook.id);
    startDelete(async () => {
      const result = await deleteWebhookAction(webhook.id);
      setDeletingId(null);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete this webhook.");
        return;
      }
      toast.success("Event webhook deleted.");
      refetch();
    });
  }

  function handleEventToggle(webhook: Webhook, eventType: WebhookEventType) {
    const next = webhook.eventTypes.includes(eventType)
      ? webhook.eventTypes.filter((e) => e !== eventType)
      : [...webhook.eventTypes, eventType];
    if (next.length === 0) {
      toast.error("A webhook needs at least one event — delete it instead if you want to remove it entirely.");
      return;
    }
    setSavingEventsId(webhook.id);
    startSaveEvents(async () => {
      const result = await updateWebhookEventTypesAction(webhook.id, next);
      setSavingEventsId(null);
      if (!result.ok) {
        toast.error(result.error ?? "Could not update event subscriptions.");
        return;
      }
      refetch();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {revealed && (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>Copy this now — you won&apos;t be able to see it again</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>Store the signing secret somewhere safe — for security, we only show it once.</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide opacity-70">Signing secret</span>
              <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
                {revealed.secret}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={() => copyToClipboard(revealed.secret)}>
                <Copy className="size-4" />
                Copy
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setRevealed(null)}>
              I&apos;ve saved this
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card glass>
        <CardHeader>
          <CardTitle>Subscribe to an event</CardTitle>
          <CardDescription>
            Real, HMAC-signed HTTP POSTs (same signature scheme as the Automation Builder&apos;s outgoing webhooks) whenever
            a subscribed event happens for your organization — never a simulated/test payload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <FormField label="Target URL" htmlFor="eventWebhookTargetUrl" required>
              <Input
                id="eventWebhookTargetUrl"
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://example.com/webhooks/growthos-events"
                required
              />
            </FormField>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Events</span>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleEventSelection(value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selectedEvents.includes(value)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <Button type="submit" disabled={creating || !targetUrl.trim()} className="self-start">
              <WebhookIcon className="size-4" />
              {creating ? "Creating..." : "Create event webhook"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle>Event webhooks</CardTitle>
          <CardDescription>Every real subscription for this organization. Deliveries and retries are logged the same way as Automation Builder webhooks.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}
          {webhooks === null && !loadError ? (
            <p className="text-sm text-muted-foreground">Loading event webhooks...</p>
          ) : webhooks && webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No event webhooks yet.</p>
          ) : webhooks ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook) => (
                  <TableRow key={webhook.id}>
                    <TableCell className="max-w-xs">
                      <code className="truncate text-xs text-muted-foreground">{webhook.targetUrl}</code>
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <div className="flex flex-wrap gap-1">
                        {EVENT_TYPES.map(({ value, label }) => {
                          const active = webhook.eventTypes.includes(value);
                          const busy = savingEventsPending && savingEventsId === webhook.id;
                          return (
                            <button
                              key={value}
                              type="button"
                              disabled={busy}
                              onClick={() => handleEventToggle(webhook, value)}
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={webhook.active ? "accent" : "outline"}>{webhook.active ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggle(webhook)}
                          disabled={togglingPending && togglingId === webhook.id}
                        >
                          {togglingPending && togglingId === webhook.id ? "Updating..." : webhook.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRotate(webhook)}
                          disabled={rotatingPending && rotatingId === webhook.id}
                        >
                          {rotatingPending && rotatingId === webhook.id ? "Rotating..." : "Rotate secret"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(webhook)}
                          disabled={deletingPending && deletingId === webhook.id}
                          className="text-red-500 hover:bg-red-500/10"
                        >
                          {deletingPending && deletingId === webhook.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
