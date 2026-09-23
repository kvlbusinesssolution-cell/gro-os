import { prisma } from "@/lib/prisma";
import { findOrCreateContact } from "@/lib/business-development/dedup";
import { generateProposalSections } from "@/lib/ai/document-engine";
import { generateTrackingToken, renderDocumentToPdf, renderDocumentToDocx } from "@/lib/documents";
import { saveDocumentFile } from "@/lib/storage/documents";
import { convertWonDealToProject } from "@/lib/projects/deal-conversion";
import { checkApprovalGate } from "@/lib/approval-engine";
import { documentIndustrySchema, pricingModelSchema } from "@/lib/validations/proposal";
import { flattenProposalSections } from "@/app/dashboard/proposal/_lib/proposal-blueprint";
import { resolveDocumentById } from "@/app/dashboard/proposal/_lib/document-resolver";
import type { DocumentEngineKind } from "@/lib/documents";
import type { DocumentKind } from "@/generated/prisma/client";
import type { NodeExecutorMap } from "./types";

const DOCUMENT_KINDS = new Set<DocumentEngineKind>(["PROPOSAL", "QUOTATION", "CONTRACT", "INVOICE", "BUSINESS_DOCUMENT"]);

export const BUSINESS_EXECUTORS: NodeExecutorMap = {
  // config: { action: "create_deal", name: string, value?: number, companyId?: string, contactId?: string, dealStageId?: string }
  //       | { action: "update_deal_stage", dealId: string, targetStageId: string }
  //       | { action: "create_contact", firstName: string, lastName?: string, email: string, companyId?: string, phone?: string, jobTitle?: string }
  CRM: async (config, context) => {
    const action = config.action;

    if (action === "create_deal") {
      const name = config.name;
      if (typeof name !== "string" || name.trim() === "") throw new Error('CRM create_deal config must include a non-empty string "name".');
      const value = typeof config.value === "number" ? config.value : null;
      const companyId = typeof config.companyId === "string" && config.companyId.trim() !== "" ? config.companyId : null;
      const contactId = typeof config.contactId === "string" && config.contactId.trim() !== "" ? config.contactId : null;

      // Real dealStageId lookup, scoped to this org's workspace, first. Falls
      // back to the org's leftmost DealStage — the exact same real query as
      // firstDealStage() in src/app/dashboard/crm/_lib/deal-actions.ts — when
      // no stage was given or the given one doesn't belong to this org.
      const requestedStageId = config.dealStageId;
      let stage = null;
      if (typeof requestedStageId === "string" && requestedStageId.trim() !== "") {
        const candidate = await prisma.dealStage.findUnique({ where: { id: requestedStageId }, include: { workspace: true } });
        if (candidate && candidate.workspace.organizationId === context.organizationId) stage = candidate;
      }
      if (!stage) {
        stage = await prisma.dealStage.findFirst({
          where: { workspace: { organizationId: context.organizationId } },
          orderBy: { order: "asc" },
        });
      }
      if (!stage) throw new Error("CRM create_deal: no pipeline stages configured for this organization yet.");

      const deal = await prisma.deal.create({
        data: { organizationId: context.organizationId, dealStageId: stage.id, companyId, contactId, name, value },
      });
      return { output: { dealId: deal.id, dealStageId: stage.id } };
    }

    if (action === "update_deal_stage") {
      const dealId = config.dealId;
      const targetStageId = config.targetStageId;
      if (typeof dealId !== "string" || dealId.trim() === "") throw new Error('CRM update_deal_stage config must include a non-empty string "dealId".');
      if (typeof targetStageId !== "string" || targetStageId.trim() === "") throw new Error('CRM update_deal_stage config must include a non-empty string "targetStageId".');

      const deal = await prisma.deal.findUnique({ where: { id: dealId } });
      if (!deal || deal.organizationId !== context.organizationId) throw new Error(`CRM update_deal_stage: deal "${dealId}" was not found in this organization.`);

      const targetStage = await prisma.dealStage.findUnique({ where: { id: targetStageId }, include: { workspace: true } });
      if (!targetStage || targetStage.workspace.organizationId !== context.organizationId) {
        throw new Error(`CRM update_deal_stage: pipeline stage "${targetStageId}" was not found in this organization.`);
      }

      await prisma.deal.update({ where: { id: dealId }, data: { dealStageId: targetStageId } });
      return { output: { dealId, dealStageId: targetStageId } };
    }

    if (action === "create_contact") {
      const firstName = config.firstName;
      const email = config.email;
      if (typeof firstName !== "string" || firstName.trim() === "") throw new Error('CRM create_contact config must include a non-empty string "firstName".');
      if (typeof email !== "string" || email.trim() === "") throw new Error('CRM create_contact config must include a non-empty string "email".');

      const companyId = typeof config.companyId === "string" && config.companyId.trim() !== "" ? config.companyId : null;
      if (companyId) {
        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company || company.organizationId !== context.organizationId) throw new Error(`CRM create_contact: company "${companyId}" was not found in this organization.`);
      }

      // Routed through the real single choke point (dedup.ts) instead of a
      // direct create() — the real @@unique([organizationId, email])
      // constraint (Phase 25) means a workflow that runs (or retries)
      // concurrently for the same email now needs findOrCreateContact's
      // real P2002-catch-and-reread handling instead of an unhandled crash.
      const { contact } = await findOrCreateContact({
        organizationId: context.organizationId,
        firstName,
        lastName: typeof config.lastName === "string" ? config.lastName : null,
        email,
        companyId,
        phone: typeof config.phone === "string" ? config.phone : null,
        jobTitle: typeof config.jobTitle === "string" ? config.jobTitle : null,
      });
      return { output: { contactId: contact.id } };
    }

    throw new Error(`Unknown CRM action "${String(action)}". Valid: create_deal, update_deal_stage, create_contact.`);
  },

  // config: { dealId?: string, companyId?: string, industry?: string, title: string, brief?: string, pricingModel?: string, value?: number }
  // Makes a real Claude API call via generateProposalSections — genuinely
  // throws AINotConnectedError/AIBillingError (see src/lib/ai/client.ts) when
  // AI isn't connected/billed, exactly as every other AI entry point does;
  // never swallowed into a generic message here.
  PROPOSAL: async (config, context) => {
    const title = config.title;
    if (typeof title !== "string" || title.trim() === "") throw new Error('PROPOSAL node config must include a non-empty string "title".');

    const dealId = typeof config.dealId === "string" && config.dealId.trim() !== "" ? config.dealId : null;
    const companyId = typeof config.companyId === "string" && config.companyId.trim() !== "" ? config.companyId : null;
    const value = typeof config.value === "number" ? config.value : null;

    const industryParsed = documentIndustrySchema.safeParse(config.industry);
    const industry = industryParsed.success ? industryParsed.data : undefined;
    const pricingModelParsed = pricingModelSchema.safeParse(config.pricingModel);
    const pricingModel = pricingModelParsed.success ? pricingModelParsed.data : undefined;

    let deal: { name: string; notes: string | null; organizationId: string } | null = null;
    if (dealId) {
      deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { name: true, notes: true, organizationId: true } });
      if (!deal || deal.organizationId !== context.organizationId) throw new Error(`PROPOSAL node: deal "${dealId}" was not found in this organization.`);
    }

    let companyName: string | null = null;
    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      if (!company || company.organizationId !== context.organizationId) throw new Error(`PROPOSAL node: company "${companyId}" was not found in this organization.`);
      companyName = company.name;
    }

    // A real "brief" in config always wins; otherwise fall back to the
    // linked Deal's own real notes (or name, if it has no notes) — never a
    // fabricated brief.
    const configBrief = typeof config.brief === "string" ? config.brief.trim() : "";
    const brief = configBrief !== "" ? configBrief : (deal?.notes ?? deal?.name ?? "");
    if (!brief) throw new Error('PROPOSAL node config must include a "brief" string, or a "dealId" whose Deal has notes/name to draft from.');

    const agent = await prisma.aIAgentInstance.findUnique({
      where: { organizationId_type: { organizationId: context.organizationId, type: "PROPOSAL" } },
    });
    if (!agent) throw new Error("PROPOSAL node: this organization's Proposal agent isn't set up yet.");

    const sections = await generateProposalSections({
      agentId: agent.id,
      agentName: agent.name,
      title,
      brief,
      industry,
      companyContext: companyName ? `Client: ${companyName}` : undefined,
      pricingModel,
    });
    const content = flattenProposalSections(sections);

    const proposal = await prisma.proposal.create({
      data: {
        organizationId: context.organizationId,
        companyId,
        dealId,
        title,
        content,
        sections,
        estimation: sections.estimation,
        industry,
        pricingModel,
        value,
        generatedByAgentId: agent.id,
        status: "DRAFT",
        trackingToken: generateTrackingToken(),
      },
    });

    return { output: { proposalId: proposal.id } };
  },

  // config: { dealId?: string, name?: string }
  // With dealId: reuses the REAL Deal→Project conversion in
  // src/lib/projects/deal-conversion.ts (convertWonDealToProject) — idempotent,
  // resolves the real client, seeds real milestones, provisions the PM agent
  // — never a hand-rolled duplicate of that logic. Without dealId: creates a
  // minimal real standalone Project from config fields.
  PROJECT: async (config, context) => {
    const dealId = typeof config.dealId === "string" && config.dealId.trim() !== "" ? config.dealId : null;

    if (dealId) {
      const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { organizationId: true } });
      if (!deal || deal.organizationId !== context.organizationId) throw new Error(`PROJECT node: deal "${dealId}" was not found in this organization.`);

      const result = await convertWonDealToProject(dealId);
      if (!result) throw new Error(`PROJECT node: could not convert deal "${dealId}" to a project.`);
      return { output: { projectId: result.projectId, clientId: result.clientId, clientAmbiguous: result.clientAmbiguous } };
    }

    const name = config.name;
    if (typeof name !== "string" || name.trim() === "") throw new Error('PROJECT node config must include a non-empty string "name" when no "dealId" is given.');

    const project = await prisma.project.create({
      data: { organizationId: context.organizationId, name },
    });
    return { output: { projectId: project.id } };
  },

  // config: { kind: "PROPOSAL" | "QUOTATION" | "CONTRACT" | "INVOICE" | "BUSINESS_DOCUMENT", docId: string, format: "pdf" | "docx" }
  // Loads the real document row, builds its real DocumentBlueprint via the
  // same resolveDocumentById() the authenticated export route uses, renders
  // it with the real renderDocumentToPdf/renderDocumentToDocx, and persists
  // the resulting Buffer through the same saveDocumentFile() local-disk store
  // src/app/dashboard/documents/actions.ts already uses — never a raw Buffer
  // in the JSON-serialized step output.
  DOCUMENT: async (config, context) => {
    const kind = config.kind;
    if (typeof kind !== "string" || !DOCUMENT_KINDS.has(kind as DocumentEngineKind)) {
      throw new Error(`DOCUMENT node config's "kind" must be one of ${Array.from(DOCUMENT_KINDS).join(", ")}, got "${String(kind)}".`);
    }
    const docId = config.docId;
    if (typeof docId !== "string" || docId.trim() === "") throw new Error('DOCUMENT node config must include a non-empty string "docId".');
    const format = config.format === "docx" ? "docx" : config.format === "pdf" ? "pdf" : null;
    if (!format) throw new Error(`DOCUMENT node config's "format" must be "pdf" or "docx", got "${String(config.format)}".`);

    const resolved = await resolveDocumentById(kind as DocumentEngineKind, docId);
    if (!resolved || resolved.organizationId !== context.organizationId) {
      throw new Error(`DOCUMENT node: ${kind} "${docId}" was not found in this organization.`);
    }

    const buffer = format === "docx" ? await renderDocumentToDocx(resolved.blueprint) : await renderDocumentToPdf(resolved.blueprint);
    const mimeType = format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
    const filename = `${resolved.filenameBase}.${format}`;

    const storageKey = await saveDocumentFile(context.organizationId, docId, filename, buffer);

    return { output: { storageKey, mimeType, sizeBytes: buffer.length } };
  },

  // config: { docKind: "PROPOSAL" | "QUOTATION" | "CONTRACT" | "INVOICE" | "BUSINESS_DOCUMENT", docId: string }
  //
  // Honesty note: this executor never decides an approval on the human's
  // behalf. It calls the REAL policy gate (checkApprovalGate in
  // src/lib/approval-engine.ts) that already gates every "send to client"
  // action in this app. When the org's policy genuinely auto-allows this doc
  // (ADVISORY mode, or a policy that doesn't apply to this docKind, or an
  // already-approved/overridden BoardReview), it reports approved: true —
  // real policy output, not a rubber stamp. When the policy genuinely
  // requires a human gate and none has cleared it yet, this node does NOT
  // fabricate approval — it creates the same real Task-based approval record
  // this app's other approval-request flows create (see requestDealApproval/
  // requestProposalApproval), assigned to a real org owner, and reports
  // approved: false with that real Task's id. A Workflow with an APPROVAL
  // node therefore does not itself block-and-wait on the human decision — it
  // hands off to the real human-approval system and the run moves on; a true
  // wait-for-approval resume mechanism is a separate, out-of-scope feature.
  APPROVAL: async (config, context) => {
    const docKind = config.docKind;
    if (typeof docKind !== "string" || !DOCUMENT_KINDS.has(docKind as DocumentEngineKind)) {
      throw new Error(`APPROVAL node config's "docKind" must be one of ${Array.from(DOCUMENT_KINDS).join(", ")}, got "${String(docKind)}".`);
    }
    const docId = config.docId;
    if (typeof docId !== "string" || docId.trim() === "") throw new Error('APPROVAL node config must include a non-empty string "docId".');

    const gate = await checkApprovalGate(context.organizationId, docKind as DocumentKind, docId);
    if (gate.allowed) {
      return { output: { approved: true, autoApproved: true, policyMode: gate.policyMode } };
    }

    const ownerMembership = await prisma.membership.findFirst({
      where: { organizationId: context.organizationId, status: "ACTIVE", role: "OWNER" },
      orderBy: { createdAt: "asc" },
    });

    const task = await prisma.task.create({
      data: {
        organizationId: context.organizationId,
        type: "APPROVAL",
        title: `Approve ${docKind.toLowerCase().replace(/_/g, " ")}: ${docId}`,
        description: gate.reason ?? "This organization's approval policy requires a human decision before this document can be sent.",
        assignedToUserId: ownerMembership?.userId ?? null,
        priority: "HIGH",
      },
    });

    return { output: { approved: false, pendingApprovalId: task.id, policyMode: gate.policyMode, reason: gate.reason ?? null } };
  },
};
