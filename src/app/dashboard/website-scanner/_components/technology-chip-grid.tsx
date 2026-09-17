import { Badge } from "@/components/ui/badge";
import type { Technology, TechnologyCategory } from "@/generated/prisma/client";

const CATEGORY_LABELS: Record<TechnologyCategory, string> = {
  FRONTEND: "Frontend",
  BACKEND: "Backend",
  CMS: "CMS",
  ECOMMERCE: "E-commerce",
  HOSTING: "Hosting",
  CDN: "CDN",
  ANALYTICS: "Analytics",
  PAYMENT: "Payment",
  BOOKING: "Booking",
  CRM_INDICATOR: "CRM Indicator",
  MESSAGING: "Messaging",
  OTHER: "Other",
};

/** Real, evidence-cited technology chips grouped by category — a real graph library would be over-engineering for a handful of detections. */
export function TechnologyChipGrid({ technologies }: { technologies: Technology[] }) {
  if (technologies.length === 0) {
    return <p className="text-sm text-muted-foreground">No technologies were identified by the signature scan.</p>;
  }

  const byCategory = new Map<TechnologyCategory, Technology[]>();
  for (const tech of technologies) {
    const bucket = byCategory.get(tech.category);
    if (bucket) bucket.push(tech);
    else byCategory.set(tech.category, [tech]);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...byCategory.entries()].map(([category, items]) => (
        <div key={category}>
          <p className="mb-1.5 text-xs font-semibold text-foreground">{CATEGORY_LABELS[category]}</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map((t) => (
              <Badge key={t.id} variant="accent" title={t.evidence}>
                {t.name}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
