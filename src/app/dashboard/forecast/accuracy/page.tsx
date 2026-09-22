import { BarChart3 } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getForecastAccuracyOverview } from "@/lib/forecast/queries";
import { getLatestForecastCalibration } from "@/lib/forecast/calibration";

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export default async function ForecastAccuracyPage() {
  const { membership } = await requireActiveMembership("/dashboard/forecast/accuracy");
  const orgId = membership.organizationId;

  const [accuracy, calibration] = await Promise.all([getForecastAccuracyOverview(orgId), getLatestForecastCalibration(orgId)]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <BarChart3 className="size-6 text-primary" /> Forecast Accuracy &amp; Calibration
          </h1>
          <p className="text-sm text-muted-foreground">Predicted vs actual, measured only once real outcomes exist — never estimated in advance.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              ["Deal Probability", accuracy.dealProbabilityAccuracy],
              ["Expected Deal Value", accuracy.dealValueAccuracy],
              ["Monthly Revenue Forecast", accuracy.monthlyForecastAccuracy],
            ] as const
          ).map(([label, a]) => (
            <Card glass key={label}>
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-xs font-medium text-foreground">{label}</span>
                {a.sampleSize === 0 ? (
                  <span className="text-xs text-muted-foreground">No evaluated predictions yet.</span>
                ) : (
                  <>
                    <span className="text-[11px] text-muted-foreground">Sample: {a.sampleSize}</span>
                    <span className="text-[11px] text-muted-foreground">MAE: {a.mae !== null ? a.mae.toFixed(2) : "—"}</span>
                    <span className="text-[11px] text-muted-foreground">WAPE: {pct(a.wape)}</span>
                    <span className="text-[11px] text-muted-foreground">Bias: {a.bias !== null ? a.bias.toFixed(2) : "—"}</span>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">Deal Probability Calibration</h2>
          {!calibration ? (
            <Card glass>
              <CardContent className="p-4 text-sm text-muted-foreground">No calibration computed yet — needs evaluated (closed) deal-probability predictions.</CardContent>
            </Card>
          ) : (
            <>
              <Card glass className="mb-3">
                <CardContent className="flex flex-col gap-1 p-4">
                  <Badge variant="outline" className="w-fit">{calibration.verdict}</Badge>
                  <p className="text-sm text-foreground">{calibration.summary}</p>
                </CardContent>
              </Card>
              <Card glass>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Predicted Band</TableHead>
                        <TableHead>Sample</TableHead>
                        <TableHead>Actual Win Rate</TableHead>
                        <TableHead>Avg Predicted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(calibration.bandsJson as Array<{ label: string; sampleSize: number; actualWinRate: number | null; avgPredictedProbability: number | null }>).map((b) => (
                        <TableRow key={b.label}>
                          <TableCell>{b.label}</TableCell>
                          <TableCell>{b.sampleSize}</TableCell>
                          <TableCell>{b.actualWinRate !== null ? `${Math.round(b.actualWinRate * 100)}%` : "—"}</TableCell>
                          <TableCell>{b.avgPredictedProbability !== null ? `${Math.round(b.avgPredictedProbability * 100)}%` : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </Container>
    </main>
  );
}
