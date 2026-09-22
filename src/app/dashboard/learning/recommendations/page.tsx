import { Lightbulb } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../../_lib/require-membership";
import { listRecommendations } from "@/lib/learning/queries";
import { RecommendationActions } from "./_components/recommendation-actions";

const STATUS_BADGE: Record<string, "accent" | "secondary" | "outline"> = {
  PROPOSED: "outline",
  UNDER_REVIEW: "secondary",
  APPROVED: "accent",
  REJECTED: "outline",
  IMPLEMENTED: "accent",
  ROLLED_BACK: "outline",
};

const APPROVER_ROLES = new Set(["OWNER", "ADMIN"]);

export default async function LearningRecommendationsPage() {
  const { membership } = await requireActiveMembership("/dashboard/learning/recommendations");
  const recommendations = await listRecommendations(membership.organizationId);
  const canApprove = APPROVER_ROLES.has(membership.role);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Lightbulb className="size-6 text-primary" /> Learning Recommendations
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            AI RECOMMENDATION — every row here requires explicit human review. The learning engine never changes a
            production scoring, pricing, compliance or approval rule on its own (§32).
          </p>
        </div>

        {recommendations.length === 0 ? (
          <Card glass>
            <CardContent className="p-4 text-sm text-muted-foreground">No recommendations yet — they&apos;re only generated once a pattern reaches a meaningful sample size and confidence.</CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {recommendations.map((r) => (
              <Card glass key={r.id}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{r.category}</Badge>
                      <Badge variant={STATUS_BADGE[r.status] ?? "outline"}>{r.status.replace("_", " ")}</Badge>
                      <Badge variant="outline">Confidence: {r.confidence}</Badge>
                    </div>
                    {(r.status === "PROPOSED" || r.status === "UNDER_REVIEW") && <RecommendationActions recommendationId={r.id} canApprove={canApprove} />}
                  </div>
                  <span className="text-sm font-medium text-foreground">{r.title}</span>
                  <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>
                      <strong className="text-foreground">Current:</strong> {r.currentRule}
                    </span>
                    <span>
                      <strong className="text-foreground">Suggested:</strong> {r.suggestedChange}
                    </span>
                    <span>
                      <strong className="text-foreground">Evidence:</strong> {r.reasoning}
                    </span>
                    <span>
                      <strong className="text-foreground">Expected impact:</strong> {r.expectedImpact}
                    </span>
                    <span>
                      <strong className="text-foreground">Risk:</strong> {r.risk}
                    </span>
                    <span>
                      <strong className="text-foreground">Affected system:</strong> {r.affectedSystem}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                    <span>Sample size: {r.sampleSize}</span>
                    <span>Approval required: {r.approvalRequired ? "yes" : "no"}</span>
                    {r.reviewedAt && <span>Reviewed {r.reviewedAt.toLocaleDateString("en-IN")}</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
