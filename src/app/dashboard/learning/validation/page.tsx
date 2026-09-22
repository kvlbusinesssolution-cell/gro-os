import { ShieldQuestion } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActiveMembership } from "../../_lib/require-membership";
import { computeIntentValidation } from "@/lib/learning/intent-validation";
import { computePriorityValidation } from "@/lib/learning/priority-validation";

export default async function LearningValidationPage() {
  const { membership } = await requireActiveMembership("/dashboard/learning/validation");
  const [intent, priority] = await Promise.all([computeIntentValidation(membership.organizationId), computePriorityValidation(membership.organizationId)]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <ShieldQuestion className="size-6 text-primary" /> Intent &amp; Priority Validation
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Do the current IntentScore and Priority Queue scores actually predict real outcomes? Neither scoring
            formula is changed by this page — every finding here is a review signal, not an automatic correction.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">Intent Score Validation</h2>
          {!intent ? (
            <Card glass>
              <CardContent className="p-4 text-sm text-muted-foreground">INSUFFICIENT DATA — no observations with a known intent band yet.</CardContent>
            </Card>
          ) : (
            <>
              <Card glass className="mb-3">
                <CardContent className="p-4 text-sm text-foreground">{intent.summary}</CardContent>
              </Card>
              <Card glass>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Band</TableHead>
                        <TableHead>Sample</TableHead>
                        <TableHead>Win Rate</TableHead>
                        <TableHead>Reply Rate</TableHead>
                        <TableHead>Meeting Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {intent.bands.map((b) => (
                        <TableRow key={b.band}>
                          <TableCell>
                            <Badge variant="outline">{b.band}</Badge>
                          </TableCell>
                          <TableCell>{b.sampleSize}</TableCell>
                          <TableCell>{b.winRate !== null ? `${Math.round(b.winRate * 100)}% (n=${b.decidedCount})` : "—"}</TableCell>
                          <TableCell>{b.replyRate !== null ? `${Math.round(b.replyRate * 100)}%` : "—"}</TableCell>
                          <TableCell>{b.meetingRate !== null ? `${Math.round(b.meetingRate * 100)}%` : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              {(intent.falsePositives.length > 0 || intent.falseNegatives.length > 0) && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Card glass>
                    <CardContent className="p-4">
                      <span className="text-xs font-medium text-foreground">False positives — HIGH intent, but LOST/NO_RESPONSE ({intent.falsePositives.length})</span>
                    </CardContent>
                  </Card>
                  <Card glass>
                    <CardContent className="p-4">
                      <span className="text-xs font-medium text-foreground">False negatives — LOW/NONE intent, but WON ({intent.falseNegatives.length})</span>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">Priority Queue Validation</h2>
          {!priority ? (
            <Card glass>
              <CardContent className="p-4 text-sm text-muted-foreground">INSUFFICIENT DATA — no opportunity observations yet.</CardContent>
            </Card>
          ) : (
            <>
              <Card glass className="mb-3">
                <CardContent className="flex flex-col gap-1 p-4">
                  <span className="text-sm text-foreground">{priority.summary}</span>
                  <span className="text-[11px] text-muted-foreground">{priority.limitation}</span>
                </CardContent>
              </Card>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Card glass>
                  <CardContent className="flex flex-col gap-1 p-4">
                    <span className="text-[11px] text-muted-foreground">HOT/HIGH win rate</span>
                    <span className="text-xl font-semibold text-foreground">{priority.highPriorityWinRate !== null ? `${Math.round(priority.highPriorityWinRate * 100)}%` : "—"}</span>
                  </CardContent>
                </Card>
                <Card glass>
                  <CardContent className="flex flex-col gap-1 p-4">
                    <span className="text-[11px] text-muted-foreground">LOW/NURTURE win rate</span>
                    <span className="text-xl font-semibold text-foreground">{priority.lowPriorityWinRate !== null ? `${Math.round(priority.lowPriorityWinRate * 100)}%` : "—"}</span>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </Container>
    </main>
  );
}
