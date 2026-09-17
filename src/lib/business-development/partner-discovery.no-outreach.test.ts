import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hard constraint enforcement (spec, verbatim): "Do not automatically
 * recruit/send spam." — the AI Partner Discovery engine must NEVER send an
 * email/outreach message to a discovered candidate; it only identifies and
 * records candidates as CANDIDATE ReferralPartner rows for a human to
 * manually review and reach out to.
 *
 * This is verified statically, not behaviorally: every real send call in
 * this codebase's outreach pipeline ultimately bottoms out in one of a small
 * known set of functions/modules (generateEmailDraft, sendOutreachEmail,
 * sendEmail, the LinkedIn/email approval-actions send path). Rather than
 * mocking those and asserting "not called" (which only proves this one test
 * run didn't call them, and would need updating every time the pipeline
 * grows a new send surface), this test reads partner-discovery.ts's and
 * partner-discovery-sync-job.ts's own source text and asserts none of those
 * names appear anywhere in the file — including in a comment referencing
 * them by name, which would itself be a signal this constraint needs a
 * second look. A genuinely new call to any of these would fail this test the
 * moment it's added, with no live AI call or network access required.
 */

const FORBIDDEN_IDENTIFIERS = [
  "sendOutreachEmail",
  "generateEmailDraft",
  "sendEmail(",
  "from \"@/lib/email\"",
  "from \"@/lib/outreach/draft-generator\"",
  "from \"@/lib/outreach/email-provider\"",
  "markLinkedInDraftSent",
  "sendQueuedDraft",
];

function readSource(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf-8");
}

describe("AI Partner Discovery never sends outreach / recruits automatically", () => {
  it("partner-discovery.ts imports/calls nothing from the outreach send pipeline", () => {
    const source = readSource("partner-discovery.ts");
    for (const forbidden of FORBIDDEN_IDENTIFIERS) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it("partner-discovery-sync-job.ts imports/calls nothing from the outreach send pipeline", () => {
    const source = readSource("partner-discovery-sync-job.ts");
    for (const forbidden of FORBIDDEN_IDENTIFIERS) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it("partner-discovery.ts's only imports are AI generation, Prisma, and existing service-catalog/dedup helpers — no outreach module in its import list", () => {
    const source = readSource("partner-discovery.ts");
    const importLines = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import "));

    const allowedModuleSubstrings = [
      "zod",
      "@/lib/prisma",
      "@/lib/ai/client",
      "@/lib/ai/fallback",
      "@/lib/billing/ai-credits",
      "./kvl-service-catalog",
      "./dedup",
      "@/generated/prisma/client",
    ];

    for (const line of importLines) {
      const matchesAllowed = allowedModuleSubstrings.some((allowed) => line.includes(allowed));
      expect(matchesAllowed, `Unexpected import in partner-discovery.ts: ${line}`).toBe(true);
    }
  });

  it("newly-created ReferralPartner rows are always CANDIDATE status in the source — the only status literal written by discoverPotentialPartners", () => {
    const source = readSource("partner-discovery.ts");
    // The only place this file writes a `status:` field to a create() call.
    expect(source.includes('status: "CANDIDATE"')).toBe(true);
    expect(source.includes('status: "ACTIVE"')).toBe(false);
  });
});
