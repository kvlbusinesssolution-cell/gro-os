import { z } from "zod";

import { isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import type { AcquisitionOverview } from "@/lib/analytics/acquisition-funnel";

/**
 * Narrates an already-computed, real `AcquisitionOverview` (see
 * acquisition-funnel.ts) into a handful of plain-English sentences for the
 * "Revenue & Client Acquisition Intelligence" dashboard — e.g. "Most
 * opportunities are coming from...", "Website Scanner is producing...",
 * "Healthcare opportunities are...".
 *
 * Deliberately makes ZERO Prisma queries of its own. The critical
 * anti-hallucination property of this function is that it is never given
 * the chance to query or guess data itself — it only writes English
 * sentences about numbers a caller already computed for real (via
 * `computeAcquisitionOverview`, which is the only place that touches the
 * database). This function's entire input surface is the `overview` object
 * passed in.
 */
export async function getAcquisitionInsights(
  organizationId: string,
  overview: AcquisitionOverview,
): Promise<{ insights: string[] }> {
  // No companies at all — nothing real to say anything about. An honest
  // empty-state message, never a fabricated insight about zero data.
  if ((overview.funnel[0]?.count ?? 0) === 0) {
    return {
      insights: [
        "Not enough data yet to generate acquisition insights — once you have some companies, leads, and deals recorded, real insights will appear here.",
      ],
    };
  }

  // No AI provider configured at all — the UI should just show nothing,
  // never crash or fabricate placeholder insights.
  if (!isAIConnected()) {
    return { insights: [] };
  }

  try {
    const result = await generateStructured({
      system:
        "You are a data analyst writing the 'Revenue & Client Acquisition Intelligence' insights panel for a B2B agency's internal dashboard (organization id " +
        organizationId +
        "). You will be given a JSON object of real, already-computed acquisition-funnel numbers (companies, qualified leads, opportunities, meetings, proposals, won deals, and revenue, broken down by source/industry/country/service). " +
        "Write 3 to 5 short, concrete, plain-English insight sentences (for example: 'Most opportunities are coming from...', 'Website Scanner is producing...', 'Healthcare opportunities are...'). " +
        "Every single number, percentage, ratio, or trend you mention MUST be directly present in, or a straightforward arithmetic derivation (e.g. a percentage, ratio, or difference) of, the numbers given to you — never invent a number, percentage, or trend that is not directly computable from the given data. " +
        "If a breakdown array is empty or a value is 0, say so honestly rather than making something up. " +
        "Never write vague filler like 'consider increasing your marketing efforts' — every sentence must cite specific real figures (e.g. counts, dollar amounts, or names of sources/industries/countries/services) drawn from the data. " +
        "Return between 3 and 5 insight strings.",
      userContent: `Real acquisition data (JSON):\n${JSON.stringify(overview, null, 2)}\n\nWrite the insight sentences now.`,
      maxTokens: 1024,
      effort: "medium",
      schema: z.object({ insights: z.array(z.string()).min(1).max(5) }),
    });

    return { insights: result.parsed.insights };
  } catch {
    return { insights: [] };
  }
}
