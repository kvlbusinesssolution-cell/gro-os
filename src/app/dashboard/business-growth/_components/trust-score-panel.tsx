import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeTrustScore, type TrustScoreInput } from "@/lib/listings/trust-score";

/** Owner-facing breakdown of the same real Trust Score shown publicly (see src/lib/listings/trust-score.ts) — shows exactly which factors are earning or losing points, so an owner can see what actually moves it. */
export function TrustScorePanel({ listing }: { listing: TrustScoreInput }) {
  const { score, band, factors } = computeTrustScore(listing);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Trust Score</span>
          <span className="text-foreground">
            {score}/100 · {band}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {factors.map((factor) => (
          <div key={factor.label} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{factor.label}</span>
            <span className="text-foreground">
              {factor.points}/{factor.maxPoints}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
