import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUSINESS_EXECUTORS } from "./business";
import type { NodeExecutionContext } from "./types";

const dealStageFindUnique = vi.fn();
const dealStageFindFirst = vi.fn();
const dealCreate = vi.fn();
const dealFindUnique = vi.fn();
const dealUpdate = vi.fn();
const contactCreate = vi.fn();
const contactFindFirst = vi.fn();
const companyFindUnique = vi.fn();
const projectCreate = vi.fn();
const membershipFindFirst = vi.fn();
const taskCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dealStage: { findUnique: (...a: unknown[]) => dealStageFindUnique(...a), findFirst: (...a: unknown[]) => dealStageFindFirst(...a) },
    deal: { create: (...a: unknown[]) => dealCreate(...a), findUnique: (...a: unknown[]) => dealFindUnique(...a), update: (...a: unknown[]) => dealUpdate(...a) },
    contact: { create: (...a: unknown[]) => contactCreate(...a), findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    project: { create: (...a: unknown[]) => projectCreate(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    task: { create: (...a: unknown[]) => taskCreate(...a) },
    aIAgentInstance: { findUnique: vi.fn() },
  },
}));

const generateProposalSections = vi.fn();
vi.mock("@/lib/ai/document-engine", () => ({
  generateProposalSections: (...a: unknown[]) => generateProposalSections(...a),
}));

vi.mock("@/lib/documents", () => ({
  generateTrackingToken: vi.fn(() => "track_token"),
  renderDocumentToPdf: vi.fn(),
  renderDocumentToDocx: vi.fn(),
}));

vi.mock("@/lib/storage/documents", () => ({
  saveDocumentFile: vi.fn(),
}));

const convertWonDealToProject = vi.fn();
vi.mock("@/lib/projects/deal-conversion", () => ({
  convertWonDealToProject: (...a: unknown[]) => convertWonDealToProject(...a),
}));

const checkApprovalGate = vi.fn();
vi.mock("@/lib/approval-engine", () => ({
  checkApprovalGate: (...a: unknown[]) => checkApprovalGate(...a),
}));

vi.mock("@/app/dashboard/proposal/_lib/proposal-blueprint", () => ({
  flattenProposalSections: vi.fn(() => "flattened"),
}));

vi.mock("@/app/dashboard/proposal/_lib/document-resolver", () => ({
  resolveDocumentById: vi.fn(),
}));

function makeContext(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  return {
    organizationId: "org_1",
    workflowRunId: "run_1",
    workflowStepId: "step_1",
    triggerPayload: {},
    stepOutputs: {},
    ...overrides,
  };
}

const CRM = BUSINESS_EXECUTORS.CRM;
const PROPOSAL = BUSINESS_EXECUTORS.PROPOSAL;
const PROJECT = BUSINESS_EXECUTORS.PROJECT;
const DOCUMENT = BUSINESS_EXECUTORS.DOCUMENT;
const APPROVAL = BUSINESS_EXECUTORS.APPROVAL;
if (!CRM || !PROPOSAL || !PROJECT || !DOCUMENT || !APPROVAL) {
  throw new Error("One or more BUSINESS_EXECUTORS entries are not registered.");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CRM node executor", () => {
  it("throws for an unknown action, listing the valid ones", async () => {
    await expect(CRM({ action: "delete_everything" }, makeContext())).rejects.toThrow(/Unknown CRM action "delete_everything"/);
  });

  describe("create_deal", () => {
    it("throws for a missing/blank name", async () => {
      await expect(CRM({ action: "create_deal" }, makeContext())).rejects.toThrow(/non-empty string "name"/);
      expect(dealCreate).not.toHaveBeenCalled();
    });

    it("uses the requested dealStageId only when it genuinely belongs to this organization", async () => {
      dealStageFindUnique.mockResolvedValue({ id: "stage_9", workspace: { organizationId: "org_1" } });
      dealCreate.mockResolvedValue({ id: "deal_1" });

      const result = await CRM({ action: "create_deal", name: "Big Deal", dealStageId: "stage_9" }, makeContext());

      expect(dealStageFindFirst).not.toHaveBeenCalled();
      expect(dealCreate).toHaveBeenCalledWith({
        data: { organizationId: "org_1", dealStageId: "stage_9", companyId: null, contactId: null, name: "Big Deal", value: null },
      });
      expect(result).toEqual({ output: { dealId: "deal_1", dealStageId: "stage_9" } });
    });

    it("falls back to the org's leftmost pipeline stage when the requested stage belongs to a DIFFERENT organization", async () => {
      dealStageFindUnique.mockResolvedValue({ id: "stage_9", workspace: { organizationId: "org_OTHER" } });
      dealStageFindFirst.mockResolvedValue({ id: "stage_fallback" });
      dealCreate.mockResolvedValue({ id: "deal_2" });

      const result = await CRM({ action: "create_deal", name: "Deal", dealStageId: "stage_9" }, makeContext());

      expect(dealStageFindFirst).toHaveBeenCalledWith({ where: { workspace: { organizationId: "org_1" } }, orderBy: { order: "asc" } });
      expect(result.output?.dealStageId).toBe("stage_fallback");
    });

    it("falls back to the leftmost stage when no dealStageId is given at all", async () => {
      dealStageFindFirst.mockResolvedValue({ id: "stage_default" });
      dealCreate.mockResolvedValue({ id: "deal_3" });

      await CRM({ action: "create_deal", name: "Deal" }, makeContext());

      expect(dealStageFindUnique).not.toHaveBeenCalled();
      expect(dealStageFindFirst).toHaveBeenCalled();
    });

    it("throws when the organization has no pipeline stages configured at all", async () => {
      dealStageFindFirst.mockResolvedValue(null);
      await expect(CRM({ action: "create_deal", name: "Deal" }, makeContext())).rejects.toThrow(/no pipeline stages configured/);
    });
  });

  describe("update_deal_stage", () => {
    it("throws for a missing dealId or targetStageId", async () => {
      await expect(CRM({ action: "update_deal_stage", targetStageId: "s" }, makeContext())).rejects.toThrow(/non-empty string "dealId"/);
      await expect(CRM({ action: "update_deal_stage", dealId: "d" }, makeContext())).rejects.toThrow(/non-empty string "targetStageId"/);
    });

    it("throws when the deal does not belong to this organization", async () => {
      dealFindUnique.mockResolvedValue({ id: "deal_1", organizationId: "org_OTHER" });
      await expect(CRM({ action: "update_deal_stage", dealId: "deal_1", targetStageId: "stage_1" }, makeContext())).rejects.toThrow(
        /deal "deal_1" was not found in this organization/,
      );
      expect(dealUpdate).not.toHaveBeenCalled();
    });

    it("throws when the target stage does not belong to this organization", async () => {
      dealFindUnique.mockResolvedValue({ id: "deal_1", organizationId: "org_1" });
      dealStageFindUnique.mockResolvedValue({ id: "stage_1", workspace: { organizationId: "org_OTHER" } });
      await expect(CRM({ action: "update_deal_stage", dealId: "deal_1", targetStageId: "stage_1" }, makeContext())).rejects.toThrow(
        /pipeline stage "stage_1" was not found in this organization/,
      );
    });

    it("updates the deal's stage when both real rows belong to this organization", async () => {
      dealFindUnique.mockResolvedValue({ id: "deal_1", organizationId: "org_1" });
      dealStageFindUnique.mockResolvedValue({ id: "stage_1", workspace: { organizationId: "org_1" } });

      const result = await CRM({ action: "update_deal_stage", dealId: "deal_1", targetStageId: "stage_1" }, makeContext());

      expect(dealUpdate).toHaveBeenCalledWith({ where: { id: "deal_1" }, data: { dealStageId: "stage_1" } });
      expect(result).toEqual({ output: { dealId: "deal_1", dealStageId: "stage_1" } });
    });
  });

  describe("create_contact", () => {
    it("throws for a missing/blank firstName or email", async () => {
      await expect(CRM({ action: "create_contact", email: "a@b.com" }, makeContext())).rejects.toThrow(/non-empty string "firstName"/);
      await expect(CRM({ action: "create_contact", firstName: "Ann" }, makeContext())).rejects.toThrow(/non-empty string "email"/);
    });

    it("throws when the given companyId does not belong to this organization", async () => {
      companyFindUnique.mockResolvedValue({ id: "co_1", organizationId: "org_OTHER" });
      await expect(CRM({ action: "create_contact", firstName: "Ann", email: "a@b.com", companyId: "co_1" }, makeContext())).rejects.toThrow(
        /company "co_1" was not found in this organization/,
      );
      expect(contactCreate).not.toHaveBeenCalled();
    });

    it("creates the contact with real org scoping when validation passes", async () => {
      contactFindFirst.mockResolvedValue(null);
      contactCreate.mockResolvedValue({ id: "contact_1" });
      const result = await CRM({ action: "create_contact", firstName: "Ann", lastName: "Lee", email: "a@b.com", phone: "555", jobTitle: "CTO" }, makeContext());

      // Routed through findOrCreateContact (dedup.ts) — also fills in its
      // own deterministic derivations (buyerRole from jobTitle) and default
      // empty fields, not just the fields this action was given.
      expect(contactCreate).toHaveBeenCalledWith({
        data: {
          organizationId: "org_1",
          firstName: "Ann",
          lastName: "Lee",
          email: "a@b.com",
          companyId: null,
          phone: "555",
          jobTitle: "CTO",
          country: null,
          city: null,
          tags: [],
          status: undefined,
          notes: null,
          linkedin: null,
          department: null,
          relationshipScore: null,
          buyerRole: "TECHNICAL_BUYER",
        },
      });
      expect(result).toEqual({ output: { contactId: "contact_1" } });
    });
  });
});

describe("PROPOSAL node executor", () => {
  it("throws for a missing/blank title", async () => {
    await expect(PROPOSAL({}, makeContext())).rejects.toThrow(/non-empty string "title"/);
  });

  it("throws when no brief is given and no dealId is provided to derive one from", async () => {
    await expect(PROPOSAL({ title: "New Proposal" }, makeContext())).rejects.toThrow(/must include a "brief" string, or a "dealId"/);
    expect(generateProposalSections).not.toHaveBeenCalled();
  });

  it("throws when dealId is given but does not belong to this organization", async () => {
    dealFindUnique.mockResolvedValue({ name: "D", notes: null, organizationId: "org_OTHER" });
    await expect(PROPOSAL({ title: "T", dealId: "deal_1" }, makeContext())).rejects.toThrow(/deal "deal_1" was not found in this organization/);
  });

  it("throws when companyId is given but does not belong to this organization", async () => {
    companyFindUnique.mockResolvedValue({ id: "co_1", organizationId: "org_OTHER", name: "Acme" });
    await expect(PROPOSAL({ title: "T", brief: "b", companyId: "co_1" }, makeContext())).rejects.toThrow(/company "co_1" was not found in this organization/);
  });
});

describe("PROJECT node executor", () => {
  it("throws for a missing/blank name when no dealId is given", async () => {
    await expect(PROJECT({}, makeContext())).rejects.toThrow(/non-empty string "name" when no "dealId" is given/);
  });

  it("creates a minimal standalone project from config when no dealId is given", async () => {
    projectCreate.mockResolvedValue({ id: "proj_1" });
    const result = await PROJECT({ name: "Standalone Project" }, makeContext());
    expect(convertWonDealToProject).not.toHaveBeenCalled();
    expect(projectCreate).toHaveBeenCalledWith({ data: { organizationId: "org_1", name: "Standalone Project" } });
    expect(result).toEqual({ output: { projectId: "proj_1" } });
  });

  it("throws when dealId is given but does not belong to this organization, without calling convertWonDealToProject", async () => {
    dealFindUnique.mockResolvedValue({ organizationId: "org_OTHER" });
    await expect(PROJECT({ dealId: "deal_1" }, makeContext())).rejects.toThrow(/deal "deal_1" was not found in this organization/);
    expect(convertWonDealToProject).not.toHaveBeenCalled();
  });

  it("delegates to the real convertWonDealToProject when dealId belongs to this organization", async () => {
    dealFindUnique.mockResolvedValue({ organizationId: "org_1" });
    convertWonDealToProject.mockResolvedValue({ projectId: "proj_9", clientId: "client_9", clientAmbiguous: false });

    const result = await PROJECT({ dealId: "deal_1" }, makeContext());

    expect(convertWonDealToProject).toHaveBeenCalledWith("deal_1");
    expect(result).toEqual({ output: { projectId: "proj_9", clientId: "client_9", clientAmbiguous: false } });
  });

  it("throws when convertWonDealToProject genuinely can't convert the deal", async () => {
    dealFindUnique.mockResolvedValue({ organizationId: "org_1" });
    convertWonDealToProject.mockResolvedValue(null);
    await expect(PROJECT({ dealId: "deal_1" }, makeContext())).rejects.toThrow(/could not convert deal "deal_1" to a project/);
  });
});

describe("DOCUMENT node executor", () => {
  it("throws for an unsupported/missing 'kind'", async () => {
    await expect(DOCUMENT({ kind: "NOT_A_KIND", docId: "d1", format: "pdf" }, makeContext())).rejects.toThrow(/"kind" must be one of/);
  });

  it("throws for a missing/blank docId", async () => {
    await expect(DOCUMENT({ kind: "PROPOSAL", format: "pdf" }, makeContext())).rejects.toThrow(/non-empty string "docId"/);
  });

  it("throws for an unsupported 'format'", async () => {
    await expect(DOCUMENT({ kind: "PROPOSAL", docId: "d1", format: "txt" }, makeContext())).rejects.toThrow(/"format" must be "pdf" or "docx"/);
  });
});

describe("APPROVAL node executor", () => {
  it("throws for an unsupported/missing 'docKind'", async () => {
    await expect(APPROVAL({ docKind: "NOT_A_KIND", docId: "d1" }, makeContext())).rejects.toThrow(/"docKind" must be one of/);
  });

  it("throws for a missing/blank docId", async () => {
    await expect(APPROVAL({ docKind: "PROPOSAL" }, makeContext())).rejects.toThrow(/non-empty string "docId"/);
  });

  it("reports a real auto-approval and never creates a Task when the policy gate allows it", async () => {
    checkApprovalGate.mockResolvedValue({ allowed: true, policyMode: "ADVISORY" });
    const result = await APPROVAL({ docKind: "PROPOSAL", docId: "doc_1" }, makeContext());
    expect(taskCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ output: { approved: true, autoApproved: true, policyMode: "ADVISORY" } });
  });

  it("creates a real Task assigned to the org's oldest active owner when the policy gate requires a human decision", async () => {
    checkApprovalGate.mockResolvedValue({ allowed: false, policyMode: "STRICT", reason: "Deal value exceeds auto-approval threshold" });
    membershipFindFirst.mockResolvedValue({ userId: "owner_1" });
    taskCreate.mockResolvedValue({ id: "task_1" });

    const result = await APPROVAL({ docKind: "PROPOSAL", docId: "doc_1" }, makeContext());

    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "ACTIVE", role: "OWNER" },
      orderBy: { createdAt: "asc" },
    });
    expect(taskCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org_1",
        type: "APPROVAL",
        title: "Approve proposal: doc_1",
        description: "Deal value exceeds auto-approval threshold",
        assignedToUserId: "owner_1",
        priority: "HIGH",
      },
    });
    expect(result).toEqual({ output: { approved: false, pendingApprovalId: "task_1", policyMode: "STRICT", reason: "Deal value exceeds auto-approval threshold" } });
  });

  it("still creates the Task (unassigned) when the org genuinely has no active owner membership", async () => {
    checkApprovalGate.mockResolvedValue({ allowed: false, policyMode: "STRICT", reason: null });
    membershipFindFirst.mockResolvedValue(null);
    taskCreate.mockResolvedValue({ id: "task_2" });

    await APPROVAL({ docKind: "INVOICE", docId: "doc_2" }, makeContext());

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedToUserId: null, description: "This organization's approval policy requires a human decision before this document can be sent." }),
      }),
    );
  });
});
