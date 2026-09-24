"use server";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { logAudit } from "@/lib/audit";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { evaluateAutomationRules } from "@/lib/automation-engine";
import { fireWorkflowTrigger } from "@/lib/workflows/triggers";
import { markParentDocumentSigned } from "@/lib/documents";
import { manualSignatureSubmitSchema, type ManualSignatureSubmitInput } from "@/lib/validations/documents";
import { clientIpFromHeaders } from "@/lib/security/client-ip";
import type { DocumentKind } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h);
}

async function resolveDocumentTitle(docKind: DocumentKind, docId: string): Promise<string | null> {
  switch (docKind) {
    case "PROPOSAL":
      return (await prisma.proposal.findUnique({ where: { id: docId }, select: { title: true } }))?.title ?? null;
    case "QUOTATION":
      return (await prisma.quotation.findUnique({ where: { id: docId }, select: { title: true } }))?.title ?? null;
    case "CONTRACT":
      return (await prisma.contract.findUnique({ where: { id: docId }, select: { title: true } }))?.title ?? null;
    case "INVOICE":
      return (await prisma.invoice.findUnique({ where: { id: docId }, select: { invoiceNumber: true } }))?.invoiceNumber ?? null;
    case "BUSINESS_DOCUMENT":
      return (await prisma.businessDocument.findUnique({ where: { id: docId }, select: { title: true } }))?.title ?? null;
    default:
      return null;
  }
}

export interface SignatureLookupResult extends ActionResult {
  signature?: {
    signerName: string;
    signerEmail: string;
    status: string;
    docKind: DocumentKind;
    documentTitle: string;
    signedAt: Date | null;
  };
}

/** Public lookup — powers the /sign/[token] page. No auth check by design: the unguessable token IS the access control, same as the tracking-pixel routes. */
export async function getSignatureByToken(token: string): Promise<SignatureLookupResult> {
  const signature = await prisma.signature.findUnique({ where: { signatureToken: token } });
  if (!signature) return { ok: false, error: "Signature request not found." };

  const documentTitle = await resolveDocumentTitle(signature.docKind, signature.docId);
  if (!documentTitle) return { ok: false, error: "The document for this signature request could not be found." };

  return {
    ok: true,
    signature: {
      signerName: signature.signerName,
      signerEmail: signature.signerEmail,
      status: signature.status,
      docKind: signature.docKind,
      documentTitle,
      signedAt: signature.signedAt,
    },
  };
}

/**
 * Real manual e-signature capture — the "Digital Signature Ready" MANUAL
 * path working end-to-end: records the signer's name, typed signature,
 * IP address, and timestamp, then flips the parent document's status.
 * DocuSign/Adobe Sign/Dropbox Sign remain schema-only stubs (see
 * Signature.provider) since no vendor credentials exist in this environment.
 */
export async function submitManualSignature(token: string, input: ManualSignatureSubmitInput): Promise<ActionResult> {
  const parsed = manualSignatureSubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please fill in your name and signature." };

  const signature = await prisma.signature.findUnique({ where: { signatureToken: token } });
  if (!signature) return { ok: false, error: "Signature request not found." };
  if (signature.status === "SIGNED") return { ok: false, error: "This document has already been signed." };
  if (signature.status === "DECLINED" || signature.status === "EXPIRED") return { ok: false, error: "This signature request is no longer active." };

  try {
    const ip = await clientIp();

    await prisma.signature.update({
      where: { id: signature.id },
      data: { status: "SIGNED", signedAt: new Date(), signerName: parsed.data.signerName, typedSignature: parsed.data.typedSignature, ipAddress: ip },
    });

    await markParentDocumentSigned(signature.docKind, signature.docId);

    const documentTitle = (await resolveDocumentTitle(signature.docKind, signature.docId)) ?? "a document";

    // Tamper-evident compliance record, distinct from logActivity's
    // UI-facing feed below — a legally significant event (an e-signature,
    // with the signer's real IP) with no logged-in userId (the signer is a
    // public token-holder, not an app user).
    await logAudit({
      userId: null,
      organizationId: signature.organizationId,
      action: "document.signed",
      ipAddress: ip,
      metadata: { docKind: signature.docKind, docId: signature.docId, signerName: parsed.data.signerName, signerEmail: signature.signerEmail },
    });

    await logActivity({
      organizationId: signature.organizationId,
      type: "SYSTEM_EVENT",
      description: `${parsed.data.signerName} signed "${documentTitle}".`,
      metadata: { docKind: signature.docKind, docId: signature.docId },
    });
    await notifyOrganizationOwners({
      organizationId: signature.organizationId,
      type: "CONTRACT_SIGNED",
      title: "Document signed",
      message: `${parsed.data.signerName} signed "${documentTitle}".`,
    });
    if (signature.docKind === "CONTRACT") {
      await evaluateAutomationRules(signature.organizationId, "CONTRACT_SIGNED", { subject: documentTitle, contractId: signature.docId });
      await fireWorkflowTrigger(signature.organizationId, "CONTRACT_SIGNED", { contractId: signature.docId, title: documentTitle, signerName: parsed.data.signerName, signerEmail: signature.signerEmail });
    }

    return { ok: true };
  } catch (error) {
    console.error("[signature] submitManualSignature failed:", error);
    return { ok: false, error: "Something went wrong recording your signature. Please try again." };
  }
}
