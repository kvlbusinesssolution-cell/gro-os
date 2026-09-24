import { Coins } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getGrowthTokenAvailability } from "@/lib/billing/growth-tokens";

export async function GrowthTokenBalanceBadge({ organizationId }: { organizationId: string }) {
  const availability = await getGrowthTokenAvailability(organizationId);

  return (
    <Badge variant="accent" className="text-sm">
      <Coins className="size-3.5" />
      {availability.unlimited ? "Unlimited Growth Tokens" : `${availability.remainingTokens} Growth Tokens remaining`}
    </Badge>
  );
}
