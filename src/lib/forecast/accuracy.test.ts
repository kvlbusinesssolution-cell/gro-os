import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { computeForecastAccuracy } from "./accuracy";
import { computeDealProbabilityCalibration, computeForecastCalibrationDrift } from "./calibration";
import { FORECAST_CONFIG } from "./config";

/**
 * Real local-Postgres integration test (same convention as
 * src/lib/outreach/personalization-quality.test.ts) — synthetic
 * PredictionSnapshot rows only, under one throwaway Organization, never
 * touching real production/fixture data.
 */
describe("forecast accuracy and calibration math", () => {
  let orgId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Forecast Accuracy Test Org", slug: `forecast-accuracy-test-${suffix}` } });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.predictionSnapshot.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("computeForecastAccuracy returns a zero-sample result (not an error) when no evaluated predictions exist", async () => {
    const result = await computeForecastAccuracy(orgId, "EXPECTED_DEAL_VALUE");
    expect(result.sampleSize).toBe(0);
    expect(result.mae).toBeNull();
    expect(result.wape).toBeNull();
  });

  it("computes real MAE/WAPE/bias from EVALUATED snapshots — WAPE stays defined even with a zero actual in the set", async () => {
    await prisma.predictionSnapshot.createMany({
      data: [
        { organizationId: orgId, predictionType: "EXPECTED_DEAL_VALUE", entityType: "DEAL", entityId: "d1", predictionValue: 100, actualValue: 90, status: "EVALUATED", confidence: "MEDIUM", dataCutoffTimestamp: new Date(), modelMethod: "test" },
        { organizationId: orgId, predictionType: "EXPECTED_DEAL_VALUE", entityType: "DEAL", entityId: "d2", predictionValue: 50, actualValue: 0, status: "EVALUATED", confidence: "MEDIUM", dataCutoffTimestamp: new Date(), modelMethod: "test" },
        { organizationId: orgId, predictionType: "EXPECTED_DEAL_VALUE", entityType: "DEAL", entityId: "d3", predictionValue: 200, actualValue: 220, status: "EVALUATED", confidence: "MEDIUM", dataCutoffTimestamp: new Date(), modelMethod: "test" },
      ],
    });

    const result = await computeForecastAccuracy(orgId, "EXPECTED_DEAL_VALUE");
    expect(result.sampleSize).toBe(3);
    // errors: |100-90|=10, |50-0|=50, |200-220|=20 -> MAE = 80/3
    expect(result.mae).toBeCloseTo(80 / 3, 5);
    // WAPE = sum(errors) / sum(|actual|) = 80 / (90+0+220) = 80/310
    expect(result.wape).toBeCloseTo(80 / 310, 5);
    expect(result.wape).not.toBeNull(); // stays defined despite one actual being exactly 0 — MAPE would be undefined/infinite there
  });

  it("calibration reports INSUFFICIENT_DATA below the configured minimum sample — never fabricates a verdict from a tiny sample", async () => {
    const orgId2 = (await prisma.organization.create({ data: { name: "Calibration Test Org", slug: `calibration-test-${Date.now()}` } })).id;
    try {
      await prisma.predictionSnapshot.create({
        data: { organizationId: orgId2, predictionType: "DEAL_PROBABILITY", entityType: "DEAL", entityId: "d1", predictionProbability: 0.7, actualOutcome: "WON", status: "EVALUATED", confidence: "MEDIUM", dataCutoffTimestamp: new Date(), modelMethod: "test" },
      });
      const result = await computeDealProbabilityCalibration(orgId2);
      expect(result?.verdict).toBe("INSUFFICIENT_DATA");
      expect(result?.sampleSize).toBeLessThan(FORECAST_CONFIG.MIN_CALIBRATION_SAMPLE);
    } finally {
      await prisma.predictionSnapshot.deleteMany({ where: { organizationId: orgId2 } });
      await prisma.organization.delete({ where: { id: orgId2 } });
    }
  });

  it("calibration classifies a well-calibrated set correctly once the minimum sample is met", async () => {
    const orgId3 = (await prisma.organization.create({ data: { name: "Calibration WellCal Test Org", slug: `calibration-wellcal-test-${Date.now()}` } })).id;
    try {
      // 12 predictions at ~70% probability, 8 won / 4 lost = 66.7% actual — within the 10-point WELL_CALIBRATED tolerance.
      const rows = Array.from({ length: 12 }, (_, i) => ({
        organizationId: orgId3,
        predictionType: "DEAL_PROBABILITY" as const,
        entityType: "DEAL" as const,
        entityId: `d${i}`,
        predictionProbability: 0.7,
        actualOutcome: i < 8 ? "WON" : "LOST",
        status: "EVALUATED" as const,
        confidence: "MEDIUM" as const,
        dataCutoffTimestamp: new Date(),
        modelMethod: "test",
      }));
      await prisma.predictionSnapshot.createMany({ data: rows });

      const result = await computeDealProbabilityCalibration(orgId3);
      expect(result?.sampleSize).toBe(12);
      expect(result?.verdict).toBe("WELL_CALIBRATED");
    } finally {
      await prisma.predictionSnapshot.deleteMany({ where: { organizationId: orgId3 } });
      await prisma.organization.delete({ where: { id: orgId3 } });
    }
  });

  it("drift check reports INSUFFICIENT_DATA (not a fabricated verdict) with fewer than 2 real calibration runs", async () => {
    const orgId4 = (await prisma.organization.create({ data: { name: "Drift Test Org Zero", slug: `drift-test-zero-${Date.now()}` } })).id;
    try {
      const result = await computeForecastCalibrationDrift(orgId4);
      expect(result.hasEnoughHistory).toBe(false);
      expect(result.driftDetected).toBe(false);
      expect(result.gapDelta).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: orgId4 } });
    }
  });

  it("drift check detects a real shift between 2 consecutive real calibration runs, never inferred from a single run", async () => {
    const orgId5 = (await prisma.organization.create({ data: { name: "Drift Test Org", slug: `drift-test-${Date.now()}` } })).id;
    try {
      const wellCalibratedBands = [{ label: "60-80%", min: 0.6, max: 0.8, sampleSize: 10, wonCount: 7, actualWinRate: 0.7, avgPredictedProbability: 0.7 }];
      const overconfidentBands = [{ label: "60-80%", min: 0.6, max: 0.8, sampleSize: 10, wonCount: 2, actualWinRate: 0.2, avgPredictedProbability: 0.7 }];
      await prisma.forecastCalibration.create({ data: { organizationId: orgId5, subject: "DEAL_PROBABILITY", sampleSize: 10, bandsJson: wellCalibratedBands, verdict: "WELL_CALIBRATED", summary: "test run 1", computedAt: new Date(Date.now() - 86_400_000) } });
      await prisma.forecastCalibration.create({ data: { organizationId: orgId5, subject: "DEAL_PROBABILITY", sampleSize: 10, bandsJson: overconfidentBands, verdict: "OVERCONFIDENT", summary: "test run 2" } });

      const result = await computeForecastCalibrationDrift(orgId5);
      expect(result.hasEnoughHistory).toBe(true);
      expect(result.previousVerdict).toBe("WELL_CALIBRATED");
      expect(result.currentVerdict).toBe("OVERCONFIDENT");
      expect(result.gapDelta).toBeCloseTo(0.5, 5); // (0.7-0.2) - (0.7-0.7) = 0.5
      expect(result.driftDetected).toBe(true);
    } finally {
      await prisma.forecastCalibration.deleteMany({ where: { organizationId: orgId5 } });
      await prisma.organization.delete({ where: { id: orgId5 } });
    }
  });
});
