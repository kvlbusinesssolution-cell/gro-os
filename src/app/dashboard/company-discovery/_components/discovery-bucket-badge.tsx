import { Sparkles, Search, ShieldQuestion, CheckCircle2, Copy, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { DISCOVERY_BUCKET_LABEL, type DiscoveryBucket } from "@/lib/business-development/discovery-buckets";

const BUCKET_STYLE: Record<DiscoveryBucket, { icon: typeof Sparkles; className: string }> = {
  NEWLY_DISCOVERED: { icon: Sparkles, className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  RECENTLY_RESEARCHED: { icon: Search, className: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  UNVERIFIED: { icon: ShieldQuestion, className: "border-border bg-muted text-muted-foreground" },
  FULLY_RESEARCHED: { icon: CheckCircle2, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  DUPLICATE_CANDIDATE: { icon: Copy, className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  RESEARCH_FAILURE: { icon: AlertTriangle, className: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" },
};

export function DiscoveryBucketBadge({ bucket, className }: { bucket: DiscoveryBucket; className?: string }) {
  const { icon: Icon, className: bucketClassName } = BUCKET_STYLE[bucket];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        bucketClassName,
        className,
      )}
    >
      <Icon className="size-3" />
      {DISCOVERY_BUCKET_LABEL[bucket]}
    </span>
  );
}
