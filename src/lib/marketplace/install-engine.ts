import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { Prisma, IntegrationProviderKey } from "@/generated/prisma/client";
import { validateManifest, type Manifest } from "./manifest-schema";
import { installAgentPack, uninstallAgentPack } from "./installers/agent-pack";
import { installWorkflowPack, uninstallWorkflowPack } from "./installers/workflow-pack";
import { installDocumentTemplatePack, uninstallDocumentTemplatePack } from "./installers/document-template-pack";
import { installDashboardPack, uninstallDashboardPack } from "./installers/dashboard-pack";
import { installKnowledgePack, uninstallKnowledgePack } from "./installers/knowledge-pack";
import { installPromptPack, uninstallPromptPack } from "./installers/prompt-pack";
import { installIntegrationConnector } from "./installers/integration-connector";
import { installWhiteLabelPack, uninstallWhiteLabelPack } from "./installers/white-label-pack";
import { installIndustryPack } from "./installers/industry-pack";

/**
 * Central install/uninstall/rollback dispatcher — structural sibling of
 * applyDraftConfiguration() (src/lib/company-discovery/auto-configure.ts).
 * Per-category installer functions in ./installers/*.ts are the ONLY place
 * that writes to another model; this file never does so directly (other
 * than the MarketplaceInstall/MarketplaceInstallEvent/MarketplaceListing
 * bookkeeping rows themselves) — a required-dependency check can never be
 * bypassed by calling an installer directly, since this is the only module
 * that resolves+validates a manifest before dispatching.
 */

export interface CreatedRowsLog {
  manifestKind: Manifest["kind"];
  agentInstanceIds: string[];
  workflowIds: string[];
  documentTemplateIds: string[];
  dashboardTemplateIds: string[];
  knowledgeArticleIds: string[];
  promptTemplateIds: string[];
  integrationConnectionId: string | null;
  connectUrl: string | null;
  whiteLabelSettingsId: string | null;
  dealStagesRenamed: Array<{ from: string; to: string }>;
}

function emptyLog(kind: Manifest["kind"]): CreatedRowsLog {
  return {
    manifestKind: kind,
    agentInstanceIds: [],
    workflowIds: [],
    documentTemplateIds: [],
    dashboardTemplateIds: [],
    knowledgeArticleIds: [],
    promptTemplateIds: [],
    integrationConnectionId: null,
    connectUrl: null,
    whiteLabelSettingsId: null,
    dealStagesRenamed: [],
  };
}

export class MarketplaceInstallError extends Error {}
export class MissingDependencyError extends MarketplaceInstallError {}

async function dispatchInstall(organizationId: string, listingId: string, manifest: Manifest, installedByUserId: string): Promise<CreatedRowsLog> {
  const log = emptyLog(manifest.kind);

  switch (manifest.kind) {
    case "AGENT_PACK": {
      const { agentInstanceId } = await installAgentPack(organizationId, manifest);
      log.agentInstanceIds.push(agentInstanceId);
      return log;
    }
    case "WORKFLOW": {
      const { workflowId } = await installWorkflowPack(organizationId, manifest, installedByUserId);
      log.workflowIds.push(workflowId);
      return log;
    }
    case "DOCUMENT_TEMPLATE": {
      const { documentTemplateId } = await installDocumentTemplatePack(organizationId, manifest, installedByUserId);
      log.documentTemplateIds.push(documentTemplateId);
      return log;
    }
    case "DASHBOARD_PACK": {
      const { dashboardTemplateId } = await installDashboardPack(organizationId, manifest, installedByUserId);
      log.dashboardTemplateIds.push(dashboardTemplateId);
      return log;
    }
    case "KNOWLEDGE_PACK": {
      const { knowledgeArticleIds } = await installKnowledgePack(organizationId, manifest, installedByUserId);
      log.knowledgeArticleIds = knowledgeArticleIds;
      return log;
    }
    case "PROMPT_PACK": {
      const { promptTemplateIds } = await installPromptPack(organizationId, listingId, manifest, installedByUserId);
      log.promptTemplateIds = promptTemplateIds;
      return log;
    }
    case "INTEGRATION_CONNECTOR": {
      const { integrationConnectionId, connectUrl } = await installIntegrationConnector(organizationId, manifest);
      log.integrationConnectionId = integrationConnectionId;
      log.connectUrl = connectUrl;
      return log;
    }
    case "WHITE_LABEL_PACK": {
      const { whiteLabelSettingsId } = await installWhiteLabelPack(organizationId, manifest);
      log.whiteLabelSettingsId = whiteLabelSettingsId;
      return log;
    }
    case "INDUSTRY_PACK": {
      const result = await installIndustryPack(organizationId, manifest, installedByUserId);
      log.documentTemplateIds = result.documentTemplateIds;
      log.dashboardTemplateIds = result.dashboardTemplateIds;
      log.workflowIds = result.workflowIds;
      log.knowledgeArticleIds = result.knowledgeArticleIds;
      log.dealStagesRenamed = result.dealStagesRenamed;
      return log;
    }
  }
}

async function dispatchUninstall(log: CreatedRowsLog): Promise<void> {
  await Promise.all([
    ...log.agentInstanceIds.map((id) => uninstallAgentPack(id)),
    ...log.workflowIds.map((id) => uninstallWorkflowPack(id)),
    ...log.documentTemplateIds.map((id) => uninstallDocumentTemplatePack(id)),
    ...log.dashboardTemplateIds.map((id) => uninstallDashboardPack(id)),
    log.knowledgeArticleIds.length > 0 ? uninstallKnowledgePack(log.knowledgeArticleIds) : Promise.resolve(),
    log.promptTemplateIds.length > 0 ? uninstallPromptPack(log.promptTemplateIds) : Promise.resolve(),
  ]);
  // White label overrides are intentionally NOT reverted here — a manifest
  // isn't retained on the log, so a safe partial-key removal (see
  // uninstallWhiteLabelPack) needs it; callers that uninstall a
  // WHITE_LABEL_PACK install pass the manifest through uninstallListing's
  // optional `whiteLabelManifest` param instead.
}

/** Exported so checkout.ts can validate dependencies BEFORE charging for a paid listing — fail fast, never charge for an install that would immediately fail. */
export async function checkDependencies(organizationId: string, versionId: string): Promise<void> {
  const dependencies = await prisma.marketplaceDependency.findMany({
    where: { versionId },
    include: { dependsOnListing: { select: { id: true, name: true } } },
  });

  for (const dep of dependencies) {
    if (dep.optional) continue;
    const install = await prisma.marketplaceInstall.findUnique({
      where: { organizationId_listingId: { organizationId, listingId: dep.dependsOnListingId } },
    });
    if (!install || install.status !== "ACTIVE") {
      throw new MissingDependencyError(`"${dep.dependsOnListing.name}" must be installed first.`);
    }
  }
}

export interface InstallListingParams {
  organizationId: string;
  listingId: string;
  versionId?: string;
  installedByUserId: string;
}

export async function installListing(params: InstallListingParams): Promise<{ installId: string }> {
  const listing = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: params.listingId } });
  const versionId = params.versionId ?? listing.currentVersionId;
  if (!versionId) throw new MarketplaceInstallError("This listing has no published version yet.");

  const version = await prisma.marketplaceVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (version.status !== "PUBLISHED") throw new MarketplaceInstallError("This version is not published.");

  await checkDependencies(params.organizationId, versionId);

  const manifest = validateManifest(listing.category, version.manifest);

  const existing = await prisma.marketplaceInstall.findUnique({
    where: { organizationId_listingId: { organizationId: params.organizationId, listingId: params.listingId } },
  });

  let log: CreatedRowsLog;
  try {
    log = await dispatchInstall(params.organizationId, params.listingId, manifest, params.installedByUserId);
  } catch (error) {
    if (existing) {
      await prisma.marketplaceInstall.update({
        where: { id: existing.id },
        data: { status: "FAILED", lastError: error instanceof Error ? error.message : String(error) },
      });
    }
    throw error;
  }

  const install = await prisma.marketplaceInstall.upsert({
    where: { organizationId_listingId: { organizationId: params.organizationId, listingId: params.listingId } },
    create: {
      organizationId: params.organizationId,
      listingId: params.listingId,
      versionId,
      installedByUserId: params.installedByUserId,
      status: "ACTIVE",
      createdRowsLog: log as unknown as Prisma.InputJsonValue,
    },
    update: {
      versionId,
      status: "ACTIVE",
      createdRowsLog: log as unknown as Prisma.InputJsonValue,
      uninstalledAt: null,
      uninstalledByUserId: null,
      lastError: null,
    },
  });

  await prisma.marketplaceInstallEvent.create({
    data: { installId: install.id, eventType: existing ? "UPGRADED" : "INSTALLED", toVersion: version.version },
  });
  if (!existing) {
    await prisma.marketplaceListing.update({ where: { id: params.listingId }, data: { installCount: { increment: 1 } } });
  }

  await logAudit({
    userId: params.installedByUserId,
    organizationId: params.organizationId,
    action: existing ? "marketplace.listing.upgraded" : "marketplace.listing.installed",
    metadata: { listingId: params.listingId, versionId, installId: install.id },
  });

  return { installId: install.id };
}

export interface UninstallListingParams {
  organizationId: string;
  listingId: string;
  uninstalledByUserId: string;
  /** Required only when the install's manifestKind is WHITE_LABEL_PACK, to safely remove just this pack's keys. */
  whiteLabelManifest?: { templateOverrides: Record<string, unknown> };
}

export async function uninstallListing(params: UninstallListingParams): Promise<void> {
  const install = await prisma.marketplaceInstall.findUniqueOrThrow({
    where: { organizationId_listingId: { organizationId: params.organizationId, listingId: params.listingId } },
  });
  const log = install.createdRowsLog as unknown as CreatedRowsLog;

  await dispatchUninstall(log);
  if (log.manifestKind === "WHITE_LABEL_PACK" && params.whiteLabelManifest) {
    await uninstallWhiteLabelPack(params.organizationId, { kind: "WHITE_LABEL_PACK", templateOverrides: params.whiteLabelManifest.templateOverrides });
  }

  await prisma.marketplaceInstall.update({
    where: { id: install.id },
    data: { status: "UNINSTALLED", uninstalledAt: new Date(), uninstalledByUserId: params.uninstalledByUserId },
  });
  await prisma.marketplaceInstallEvent.create({ data: { installId: install.id, eventType: "UNINSTALLED" } });

  await logAudit({
    userId: params.uninstalledByUserId,
    organizationId: params.organizationId,
    action: "marketplace.listing.uninstalled",
    metadata: { listingId: params.listingId, installId: install.id },
  });
}

export interface RollbackInstallParams {
  organizationId: string;
  listingId: string;
  targetVersionId: string;
  userId: string;
}

/** Uninstalls the current version's created rows, then installs the target version fresh — never a diff/undo. */
export async function rollbackInstall(params: RollbackInstallParams): Promise<{ installId: string }> {
  const install = await prisma.marketplaceInstall.findUniqueOrThrow({
    where: { organizationId_listingId: { organizationId: params.organizationId, listingId: params.listingId } },
  });
  const log = install.createdRowsLog as unknown as CreatedRowsLog;
  await dispatchUninstall(log);

  const result = await installListing({
    organizationId: params.organizationId,
    listingId: params.listingId,
    versionId: params.targetVersionId,
    installedByUserId: params.userId,
  });

  await prisma.marketplaceInstallEvent.create({
    data: { installId: result.installId, eventType: "ROLLED_BACK", toVersion: params.targetVersionId },
  });

  return result;
}

export async function reconcileIntegrationConnectorInstall(organizationId: string, listingId: string): Promise<void> {
  const install = await prisma.marketplaceInstall.findUnique({
    where: { organizationId_listingId: { organizationId, listingId } },
  });
  if (!install || install.status !== "ACTIVE") return;
  const log = install.createdRowsLog as unknown as CreatedRowsLog;
  if (log.manifestKind !== "INTEGRATION_CONNECTOR" || log.integrationConnectionId) return;

  const version = await prisma.marketplaceVersion.findUnique({ where: { id: install.versionId } });
  const manifest = version ? validateManifest("INTEGRATION_CONNECTOR", version.manifest) : null;
  if (!manifest || manifest.kind !== "INTEGRATION_CONNECTOR") return;

  const connection = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider: manifest.provider as IntegrationProviderKey, status: "CONNECTED" },
    select: { id: true },
  });
  if (!connection) return;

  log.integrationConnectionId = connection.id;
  await prisma.marketplaceInstall.update({ where: { id: install.id }, data: { createdRowsLog: log as unknown as Prisma.InputJsonValue } });
}
