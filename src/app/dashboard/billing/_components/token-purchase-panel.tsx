"use client";

import { useTransition } from "react";
import { Coins } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { TOKEN_PACKAGES, computeBonusTokens } from "@/lib/billing/token-packages";
import { buyGrowthTokensAction } from "../_lib/token-purchase-actions";

export interface TokenPurchasePanelProps {
  unlimited: boolean;
  remainingTokens: number;
  monthlyTokensGranted: number;
  monthlyTokensUsed: number;
  purchasedTokensRemaining: number;
}

function TokenPackageButton({ id, label, tokens, amountCents }: (typeof TOKEN_PACKAGES)[number]) {
  const [pending, startTransition] = useTransition();
  const bonus = computeBonusTokens(tokens);

  function handleBuy() {
    startTransition(async () => {
      const result = await buyGrowthTokensAction(id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not start checkout.");
        return;
      }
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    });
  }

  return (
    <Card glass className="flex flex-col justify-between gap-3 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight text-foreground">{tokens.toLocaleString()} tokens</p>
        <Badge variant="accent" className="mt-1">
          +{bonus.toLocaleString()} bonus
        </Badge>
        <p className="mt-1 text-sm text-muted-foreground">
          ₹{(amountCents / 100).toLocaleString()} — {(tokens + bonus).toLocaleString()} total
        </p>
      </div>
      <Button size="sm" disabled={pending} onClick={handleBuy}>
        {pending ? "Redirecting…" : "Buy"}
      </Button>
    </Card>
  );
}

/** Real Growth Token balance + a real "Buy Growth Tokens" checkout panel — reached from both the BUSINESS and CAREER dashboards (same shared /dashboard/billing route), since every account type (client, user, student) spends and can top up the same GrowthTokenLedger. */
export function TokenPurchasePanel({ unlimited, remainingTokens, monthlyTokensGranted, monthlyTokensUsed, purchasedTokensRemaining }: TokenPurchasePanelProps) {
  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-4 text-primary" /> Growth Tokens
        </CardTitle>
        <CardDescription>
          {unlimited
            ? "Your organization has unlimited Growth Tokens."
            : "Tokens gate paid platform actions (listings, ad placements, microsites, and more) — a flat, 4x-marked-up price on every real deliverable."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {unlimited ? (
          <Badge variant="accent">Unlimited</Badge>
        ) : (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <p className="text-2xl font-semibold tracking-tight text-foreground">{remainingTokens.toLocaleString()}</p>
              <p className="text-muted-foreground">tokens remaining</p>
            </div>
            <div className="text-muted-foreground">
              <p>
                Monthly: {Math.max(0, monthlyTokensGranted - monthlyTokensUsed).toLocaleString()} / {monthlyTokensGranted.toLocaleString()} left
              </p>
              <p>Purchased balance: {purchasedTokensRemaining.toLocaleString()}</p>
            </div>
          </div>
        )}

        {!unlimited && (
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Buy Growth Tokens</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {TOKEN_PACKAGES.map((pkg) => (
                <TokenPackageButton key={pkg.id} {...pkg} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
