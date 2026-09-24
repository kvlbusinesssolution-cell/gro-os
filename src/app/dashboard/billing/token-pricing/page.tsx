import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActiveMembership } from "../../_lib/require-membership";
import { listTokenPricing, TOKEN_MARKUP_MULTIPLIER, TOKEN_VALUE_INR, API_COST_MARKUP_MULTIPLIER, computeApiCostTokens } from "@/lib/billing/token-pricing";
import { TOKEN_PURCHASE_RATE } from "@/lib/billing/token-packages";

const LABEL: Record<string, string> = {
  LISTING_PUBLISH: "Publish a business listing",
  DEAL_POST: "Post a deal",
  LISTING_FEATURE: "Feature a listing (boosted placement)",
  CATALOG_ITEM_PUBLISH: "Publish a catalog item",
  LANDING_PAGE_PUBLISH: "Publish a marketing landing page",
  REPUTATION_CERTIFICATE_DOWNLOAD: "Download a reputation certificate",
  AD_PLACEMENT_PURCHASE: "Buy a sponsored ad placement (7 days)",
  MICROSITE_PUBLISH: "Publish an AI-built business website",
  WHATSAPP_MESSAGE: "WhatsApp message (not yet a gated feature)",
  SMS_MESSAGE: "SMS (not yet a gated feature)",
  AI_VOICE_CALL_MINUTE: "AI voice call, per minute (not yet a gated feature)",
};

/**
 * Read-only display of the token pricing calculator (src/lib/billing/
 * token-pricing.ts) — owner-org only. Shows the real methodology (reference
 * paid-market cost x the markup multiplier = token price), not just the
 * resulting numbers, so the founder can see the reasoning, not just trust a
 * comment in the code.
 */
export default async function TokenPricingPage() {
  const { membership } = await requireActiveMembership("/dashboard/billing/token-pricing");
  if (!membership.organization.isOwnerOrg) notFound();

  const rows = listTokenPricing();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Token Pricing Calculator</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every token price below is a reference paid-market cost multiplied by {TOKEN_MARKUP_MULTIPLIER}x — this
            floor holds even when the underlying service GrowthOS actually uses costs nothing (a free tier). 1
            Growth Token = ₹{TOKEN_VALUE_INR} of reference value.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Reference cost → token price</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Reference cost (₹)</TableHead>
                  <TableHead>Multiplier</TableHead>
                  <TableHead>Token price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.referenceKey}>
                    <TableCell>{LABEL[row.referenceKey] ?? row.referenceKey}</TableCell>
                    <TableCell>₹{row.referenceCostInr}</TableCell>
                    <TableCell>{row.multiplier}x</TableCell>
                    <TableCell className="font-medium text-foreground">{row.tokenPrice} tokens</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metered AI cost → token debit (live)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Every real AI call (Claude/OpenAI/Gemini/Groq/embedding) also debits this same Growth Token balance —
              wired into <code className="text-xs">recordAIUsage</code>, alongside (not instead of) the separate AI
              Credits ledger. Real ₹ cost of the call × {API_COST_MARKUP_MULTIPLIER}x markup × {TOKEN_PURCHASE_RATE}{" "}
              tokens/₹1.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Real API cost</TableHead>
                  <TableHead>× {API_COST_MARKUP_MULTIPLIER} markup</TableHead>
                  <TableHead>Tokens debited</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[100, 500, 1000].map((realCostInr) => (
                  <TableRow key={realCostInr}>
                    <TableCell>₹{realCostInr}</TableCell>
                    <TableCell>₹{Math.round(realCostInr * API_COST_MARKUP_MULTIPLIER)}</TableCell>
                    <TableCell className="font-medium text-foreground">{computeApiCostTokens(realCostInr)} tokens</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
