import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { computeTrustScore, type TrustScoreInput } from "@/lib/listings/trust-score";

const BAND_STYLE: Record<string, string> = {
  EXCELLENT: "border-emerald-400/60 text-emerald-600 dark:text-emerald-400",
  GOOD: "border-sky-400/60 text-sky-600 dark:text-sky-400",
  FAIR: "border-amber-400/60 text-amber-600 dark:text-amber-400",
  NEW: "border-muted-foreground/30 text-muted-foreground",
};

const BAND_LABEL: Record<string, string> = {
  EXCELLENT: "Excellent Trust Score",
  GOOD: "Good Trust Score",
  FAIR: "Fair Trust Score",
  NEW: "New Listing",
};

/** Real, computed trust indicator — see src/lib/listings/trust-score.ts for the exact, honest formula. Never a marketing badge disconnected from real stored data. */
export function TrustScoreBadge({ listing }: { listing: TrustScoreInput }) {
  const { score, band } = computeTrustScore(listing);

  return (
    <Badge variant="outline" className={`gap-1 ${BAND_STYLE[band]}`} title={`Trust Score: ${score}/100`}>
      <ShieldCheck className="size-3" /> {BAND_LABEL[band]} ({score}/100)
    </Badge>
  );
}
