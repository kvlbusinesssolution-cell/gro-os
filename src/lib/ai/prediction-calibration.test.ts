import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { computePredictionCalibration, formatCalibrationContext } from "./prediction-calibration";

/**
 * Phase 29 — real local-Postgres integration tests for a file that shipped
 * (BoardReview.winProbability vs real terminal Proposal outcomes) with
 * ZERO test coverage until now. Every row created here is real, cleaned up
 * in afterAll.
 */
describe("prediction-calibration — real DB integration", () => {
  const suffix = Date.now();
  let orgId: string;
  let userId: string;
  const meetingIds: string[] = [];
  const proposalIds: string[] = [];

  afterAll(async () => {
    await prisma.boardReview.deleteMany({ where: { organizationId: orgId } });
    await prisma.proposal.deleteMany({ where: { id: { in: proposalIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Prediction Calibration Test Org", slug: `prediction-calibration-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Prediction Calibration Test User", email: `prediction-calibration-user-${suffix}@example.com` } });
    userId = user.id;
  });

  it("returns null (never a fabricated calibration) below the real minimum sample size", async () => {
    const meeting = await prisma.meeting.create({ data: { organizationId: orgId, title: "Test Review", agenda: "test", createdById: userId } });
    meetingIds.push(meeting.id);
    const proposal = await prisma.proposal.create({ data: { organizationId: orgId, title: "Test Proposal", content: "test", status: "ACCEPTED" } });
    proposalIds.push(proposal.id);
    await prisma.boardReview.create({ data: { organizationId: orgId, meetingId: meeting.id, docKind: "PROPOSAL", docId: proposal.id, winProbability: 70 } });

    const result = await computePredictionCalibration(orgId);
    expect(result).toBeNull();
  });

  it("computes a real calibration from >= MIN_SAMPLE_SIZE real terminal proposals with a known winProbability", async () => {
    // 10 more reviews at ~70% estimated win probability, 7 ACCEPTED / 3 REJECTED = 70% actual — well-calibrated.
    for (let i = 0; i < 10; i++) {
      const meeting = await prisma.meeting.create({ data: { organizationId: orgId, title: `Review ${i}`, agenda: "test", createdById: userId } });
      meetingIds.push(meeting.id);
      const proposal = await prisma.proposal.create({ data: { organizationId: orgId, title: `Proposal ${i}`, content: "test", status: i < 7 ? "ACCEPTED" : "REJECTED" } });
      proposalIds.push(proposal.id);
      await prisma.boardReview.create({ data: { organizationId: orgId, meetingId: meeting.id, docKind: "PROPOSAL", docId: proposal.id, winProbability: 70 } });
    }

    const result = await computePredictionCalibration(orgId);
    expect(result).not.toBeNull();
    // 11 total terminal reviews now exist (1 ACCEPTED from the previous test + 10 here, 7 of which are ACCEPTED) — 8 real WON / 11, all real, none fabricated.
    expect(result!.sampleSize).toBe(11);
    const band = result!.bands.find((b) => b.label === "60-80%")!;
    expect(band.sampleSize).toBe(11);
    expect(band.actualWinRate).toBeCloseTo((8 / 11) * 100, 1);
    expect(result!.summary).toContain("11 real terminal proposal");
  });

  it("formatCalibrationContext returns undefined (never a padded string) for a null/empty calibration", () => {
    expect(formatCalibrationContext(null)).toBeUndefined();
    expect(formatCalibrationContext({ sampleSize: 5, bandsJson: [{ label: "0-20%", min: 0, max: 20, sampleSize: 0, wonCount: 0, actualWinRate: null, avgPredictedWinProbability: null }] })).toBeUndefined();
  });

  it("formatCalibrationContext produces real, grounded text from a populated band", () => {
    const text = formatCalibrationContext({
      sampleSize: 11,
      bandsJson: [{ label: "60-80%", min: 60, max: 80, sampleSize: 11, wonCount: 7, actualWinRate: (7 / 11) * 100, avgPredictedWinProbability: 70 }],
    });
    expect(text).toContain("60-80%");
    expect(text).toContain("n=11");
  });
});
