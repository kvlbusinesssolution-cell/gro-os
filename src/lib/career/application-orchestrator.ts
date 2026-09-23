/**
 * Phase 20 — the real orchestration core (headless "*Core" pattern, same
 * convention as every other action file in this codebase — callable from
 * both server actions and scheduler jobs, no session dependency).
 *
 * Pipeline (§2): MATCH -> ELIGIBILITY -> DUPLICATE CHECK -> RESUME
 * SELECTION -> RESUME CUSTOMIZATION -> COVER LETTER -> APPLICATION
 * ANSWERS -> VALIDATION -> POLICY CHECK -> SUBMISSION -> CONFIRMATION.
 * Every stage's real result is persisted before moving to the next —
 * never silently skipped, never guessed.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notifications";
import { assertValidTransition } from "./application-state-machine";
import { checkDuplicateApplication } from "./application-duplicate";
import { computeApplicationEligibility } from "./application-eligibility";
import { detectSuspiciousJob } from "./suspicious-job-detection";
import { selectResumeForApplication } from "./resume-selection";
import { customizeResumeForJob, validateCustomizedResume, type SourceProfileForCustomization } from "./resume-customization";
import { generateCoverLetter, validateCoverLetter } from "./cover-letter";
import { prepareApplicationAnswer, type AnswerProfileInput } from "./application-answers";
import { runValidationEngine } from "./application-validation";
import { evaluateAutonomySafetyGate } from "./application-policy-engine";
import { determineSubmissionMethod, submitApplicationViaEmail, checkEmailDeliveryConfirmation } from "./application-submission";
import { predictMatchResponseLikelihood } from "./career-predictions";
import type { JobMatchResult } from "./job-matching";

const COMMON_QUESTIONS = [
  "How many years of relevant experience do you have?",
  "What is your notice period?",
  "Are you willing to relocate?",
  "What is your salary expectation?",
  "What is your current location?",
  "What is your current role?",
];

export interface PrepareApplicationResult {
  ok: boolean;
  applicationId?: string;
  status?: string;
  error?: string;
}

/**
 * §2-14 — the full prepare pipeline. Idempotent by construction: the real
 * DB @@unique([careerProfileId, jobId]) constraint means calling this
 * twice for the same job either returns the existing application's
 * current state or fails the duplicate check honestly — never creates a
 * second row.
 */
export async function prepareApplicationCore(careerProfileId: string, jobMatchId: string, organizationId: string, userId: string): Promise<PrepareApplicationResult> {
  const jobMatch = await prisma.jobMatch.findUnique({ where: { id: jobMatchId }, include: { job: true } });
  if (!jobMatch || jobMatch.careerProfileId !== careerProfileId || jobMatch.organizationId !== organizationId) {
    return { ok: false, error: "Job match not found." };
  }

  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.userId !== userId || profile.organizationId !== organizationId) return { ok: false, error: "Career profile not found." };

  const duplicate = await checkDuplicateApplication(careerProfileId, jobMatch.jobId);
  if (duplicate.status === "DUPLICATE_CONFIRMED" && duplicate.existingApplicationId) {
    return { ok: true, applicationId: duplicate.existingApplicationId, status: "DUPLICATE" };
  }

  const job = jobMatch.job;
  const matchResult = { dimensions: jobMatch.dimensions, eligibility: jobMatch.eligibility } as unknown as JobMatchResult;

  const suspicion = detectSuspiciousJob({ description: job.description, company: job.company, companyDomain: job.companyDomain, canonicalUrl: job.canonicalUrl });

  // Phase 31 — computed BEFORE this application's own row exists, so the
  // real historical pool it queries can never self-pollute with the
  // very application currently being prepared.
  const matchPrediction = await predictMatchResponseLikelihood(organizationId, jobMatch.id);

  let application;
  try {
    application = await prisma.jobApplication.create({
      data: {
        organizationId,
        userId,
        careerProfileId,
        jobId: job.id,
        jobMatchId: jobMatch.id,
        status: "DISCOVERED",
        automationModeAtCreation: profile.applicationAutomationMode,
        duplicateStatus: duplicate.status,
        suspicionStatus: suspicion.status,
        suspicionEvidence: suspicion.evidence,
        matchPrediction: matchPrediction as unknown as object,
      },
    });
  } catch (error) {
    // Real P2002-catch-and-reread pattern (same as dedup.ts's
    // findOrCreateCompany/findOrCreateContact) — the checkDuplicateApplication
    // read above and this create() aren't atomic, so a genuine concurrent
    // call can lose the check-then-create race despite finding no
    // duplicate at read time. The real @@unique([careerProfileId, jobId])
    // constraint is the actual safety net; re-read and return the
    // winner's row instead of surfacing a raw constraint-violation error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.jobApplication.findUnique({ where: { careerProfileId_jobId: { careerProfileId, jobId: job.id } } });
      if (winner) return { ok: true, applicationId: winner.id, status: "DUPLICATE" };
    }
    throw error;
  }
  await logAudit({ userId, organizationId, action: "career:application:discovered", metadata: { applicationId: application.id, jobId: job.id, duplicateStatus: duplicate.status } });

  if (duplicate.status === "DUPLICATE_CONFIRMED") {
    // Defensive — the @@unique above should have already caught this via
    // a create failure; reachable only in a genuine race, handled here
    // rather than surfacing a raw constraint-violation error.
    return { ok: true, applicationId: application.id, status: "DISCOVERED" };
  }

  assertValidTransition("DISCOVERED", "MATCHED");
  await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "MATCHED" } });
  assertValidTransition("MATCHED", "SHORTLISTED");
  await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "SHORTLISTED" } });
  assertValidTransition("SHORTLISTED", "PREPARING");
  await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "PREPARING" } });
  await logAudit({ userId, organizationId, action: "career:application:preparing", metadata: { applicationId: application.id, suspicionStatus: suspicion.status } });

  // ===== Eligibility (§6/§7) =====
  const jobRequirements = job.requirements as { required?: string[]; preferred?: string[] } | null;
  const eligibility = computeApplicationEligibility({
    matchResult: matchResult,
    jobRequirements: jobRequirements ? { required: jobRequirements.required ?? [], preferred: jobRequirements.preferred ?? [] } : null,
    verifiedSkills: extractSkillNames(profile.skills),
    hasResume: (await prisma.careerResume.count({ where: { careerProfileId, status: { in: ["VERIFIED", "PROCESSED"] } } })) > 0,
    hasVerifiedWorkAuthorization: null, // §13 — never assumed; no work-authorization field exists on CareerProfile today
  });
  await prisma.jobApplication.update({ where: { id: application.id }, data: { eligibilityStatus: eligibility.status, eligibilityDetail: eligibility.checks as unknown as object } });
  await logAudit({ userId, organizationId, action: "career:application:eligibility_checked", metadata: { applicationId: application.id, status: eligibility.status, matchPredictionInsufficientData: matchPrediction.insufficientData } });

  // ===== Resume selection (§8) =====
  const jobTech = job.technologies;
  const resumeSelection = await selectResumeForApplication(careerProfileId, jobTech);
  await prisma.jobApplication.update({ where: { id: application.id }, data: { selectedResumeId: resumeSelection.resumeId, selectedResumeReason: resumeSelection.reason } });
  await logAudit({ userId, organizationId, action: "career:application:resume_selected", metadata: { applicationId: application.id, resumeId: resumeSelection.resumeId } });

  // ===== Resume customization (§9/§10) + cover letter (§11) — only if a resume + AI are available =====
  let customizedBlocked = false;
  if (resumeSelection.resumeId) {
    const resume = await prisma.careerResume.findUnique({ where: { id: resumeSelection.resumeId } });
    const extracted = (resume?.aiExtractedProfile ?? {}) as { skills?: Array<{ name?: string }>; projects?: Array<{ name?: string }>; experience?: Array<{ company?: string }> };
    const source: SourceProfileForCustomization = {
      skills: extractSkillNames(profile.skills).length > 0 ? extractSkillNames(profile.skills) : (extracted.skills ?? []).map((s) => s.name ?? "").filter(Boolean),
      projects: extractNames(profile.projects),
      achievements: extractStrings(profile.achievements),
      companies: (extracted.experience ?? []).map((e) => e.company ?? "").filter(Boolean),
      currentRole: profile.currentRole,
      yearsOfExperience: profile.yearsOfExperience,
      targetRole: job.title,
    };

    const customization = await customizeResumeForJob(source, job.title, job.description, organizationId, userId);
    if (customization.content) {
      const check = validateCustomizedResume(customization.content, source);
      customizedBlocked = check.blocked;
      await prisma.applicationDocument.create({
        data: {
          applicationId: application.id,
          type: "CUSTOMIZED_RESUME",
          content: JSON.stringify(customization.content),
          sourceResumeVersion: resume?.version ?? null,
          validationResult: { unsupportedClaims: check.unsupportedClaims, blocked: check.blocked, needsManualReview: check.needsManualReview } as object,
        },
      });
      await logAudit({ userId, organizationId, action: "career:application:resume_customized", metadata: { applicationId: application.id, blocked: check.blocked, unsupportedClaims: check.unsupportedClaims } });
    }

    const coverLetter = await generateCoverLetter(
      { candidateName: profile.name, currentRole: profile.currentRole, yearsOfExperience: profile.yearsOfExperience, skills: source.skills, achievements: source.achievements },
      job.title,
      job.company,
      job.description,
      organizationId,
    );
    if (coverLetter.body) {
      // Phase 31 — real fabrication-check parity with the customized
      // resume above: heuristic-flag only, never a hard block (free text
      // can't be exact-matched like structured resume fields).
      const coverLetterCheck = validateCoverLetter(coverLetter.body, { candidateName: profile.name, currentRole: profile.currentRole, yearsOfExperience: profile.yearsOfExperience, skills: source.skills, achievements: source.achievements }, job.title, job.company);
      await prisma.applicationDocument.create({
        data: { applicationId: application.id, type: "COVER_LETTER", content: coverLetter.body, validationResult: { needsManualReview: coverLetterCheck.needsManualReview, suspiciousPhrases: coverLetterCheck.suspiciousPhrases } as object },
      });
      await logAudit({ userId, organizationId, action: "career:application:cover_letter_generated", metadata: { applicationId: application.id, needsManualReview: coverLetterCheck.needsManualReview } });
    }
  }

  // ===== Application answers (§12/§13/§38) =====
  const answerProfile: AnswerProfileInput = {
    yearsOfExperience: profile.yearsOfExperience,
    currentRole: profile.currentRole,
    location: profile.location,
    relocationPreference: profile.relocationPreference,
    noticePeriodDays: profile.noticePeriodDays,
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    salaryCurrency: profile.salaryCurrency,
    education: (profile.education as Array<{ degree?: string; institution?: string }>) ?? [],
    certifications: (profile.certifications as Array<{ name?: string }>) ?? [],
    skills: extractSkillNames(profile.skills),
  };
  let reviewRequiredAnswers = 0;
  let unresolvedSensitive = 0;
  for (const question of COMMON_QUESTIONS) {
    const prepared = prepareApplicationAnswer(question, answerProfile);
    if (prepared.status === "REVIEW_REQUIRED") reviewRequiredAnswers += 1;
    if (prepared.isSensitive && prepared.status !== "VERIFIED") unresolvedSensitive += 1;
    await prisma.applicationAnswer.create({
      data: { applicationId: application.id, question: prepared.question, answer: prepared.answer, source: prepared.source, status: prepared.status, isSensitive: prepared.isSensitive },
    });
  }
  await logAudit({ userId, organizationId, action: "career:application:answers_prepared", metadata: { applicationId: application.id, reviewRequired: reviewRequiredAnswers } });

  // ===== Submission method determination (§29) =====
  const submissionMethod = determineSubmissionMethod(job.description, job.canonicalUrl);

  // ===== Validation (§14) =====
  const documents = await prisma.applicationDocument.findMany({ where: { applicationId: application.id } });
  const validation = runValidationEngine({
    duplicateStatus: duplicate.status,
    eligibilityStatus: eligibility.status,
    suspicionStatus: suspicion.status,
    selectedResumeId: resumeSelection.resumeId,
    hasCustomizedResume: documents.some((d) => d.type === "CUSTOMIZED_RESUME"),
    customizedResumeBlocked: customizedBlocked,
    hasCoverLetter: documents.some((d) => d.type === "COVER_LETTER"),
    unresolvedSensitiveAnswers: unresolvedSensitive,
    reviewRequiredAnswers,
  });
  await prisma.jobApplication.update({
    where: { id: application.id },
    data: { validationResult: validation.result, validationDetail: validation.checks as unknown as object, submissionMethod: submissionMethod.method },
  });
  await logAudit({ userId, organizationId, action: "career:application:validated", metadata: { applicationId: application.id, result: validation.result } });

  if (validation.result === "BLOCKED") {
    assertValidTransition("PREPARING", "FAILED");
    await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "FAILED", blockedReason: validation.checks.filter((c) => !c.passed).map((c) => c.detail).join("; ") } });
    await notifyUser({ userId, organizationId, type: "SYSTEM_NOTICE", title: "Application blocked", message: `Your application for ${job.title} at ${job.company} was blocked — review required.` });
    return { ok: true, applicationId: application.id, status: "FAILED" };
  }

  assertValidTransition("PREPARING", "READY_FOR_REVIEW");
  await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "READY_FOR_REVIEW" } });
  await notifyUser({ userId, organizationId, type: "APPROVAL_REQUESTED", title: "Application ready for review", message: `Your application for ${job.title} at ${job.company} is ready.` });

  return { ok: true, applicationId: application.id, status: "READY_FOR_REVIEW" };
}

function extractSkillNames(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return (skills as Array<{ name?: string } | string>).map((s) => (typeof s === "string" ? s : s.name ?? "")).filter(Boolean);
}
function extractNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as Array<{ name?: string } | string>).map((v) => (typeof v === "string" ? v : v.name ?? "")).filter(Boolean);
}
function extractStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as Array<{ achievement?: string; description?: string } | string>).map((v) => (typeof v === "string" ? v : v.achievement ?? v.description ?? "")).filter(Boolean);
}

export interface SubmitApplicationResult {
  ok: boolean;
  status?: string;
  error?: string;
}

/** §15/§21/§22/§23/§48 — the real autonomy safety gate + submission dispatch. Called both by the explicit user "submit" action and by the autonomous scheduler job — identical logic either way, no special-cased autonomous path. */
export async function submitApplicationCore(applicationId: string, actingUserId: string | null): Promise<SubmitApplicationResult> {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true, careerProfile: true } });
  if (!application) return { ok: false, error: "Application not found." };
  if (application.status !== "READY_FOR_REVIEW" && application.status !== "USER_APPROVAL_REQUIRED") {
    return { ok: false, error: `Cannot submit from status ${application.status}.` };
  }

  const profile = application.careerProfile;
  const job = application.job;
  const submissionMethod = determineSubmissionMethod(job.description, job.canonicalUrl);

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
  const [dailyUsed, weeklyUsed] = await Promise.all([
    prisma.jobApplication.count({ where: { careerProfileId: profile.id, submittedAt: { gte: startOfDay } } }),
    prisma.jobApplication.count({ where: { careerProfileId: profile.id, submittedAt: { gte: startOfWeek } } }),
  ]);

  const documents = await prisma.applicationDocument.findMany({ where: { applicationId } });
  const gate = evaluateAutonomySafetyGate({
    automationMode: profile.applicationAutomationMode,
    duplicateStatus: application.duplicateStatus,
    eligibilityStatus: application.eligibilityStatus,
    minEligibilityForAutoApply: profile.minEligibilityForAutoApply,
    suspicionStatus: application.suspicionStatus,
    companyExcluded: profile.excludedCompanies.some((c) => c.toLowerCase() === job.company.toLowerCase()),
    hasSelectedResume: application.selectedResumeId !== null,
    hasRequiredDocuments: documents.length > 0,
    validationResult: application.validationResult,
    submissionChannelAvailable: submissionMethod.method !== "USER_ACTION_REQUIRED",
    dailyApplicationsUsed: dailyUsed,
    maxApplicationsPerDay: profile.maxApplicationsPerDay,
    weeklyApplicationsUsed: weeklyUsed,
    maxApplicationsPerWeek: profile.maxApplicationsPerWeek,
  });

  await prisma.jobApplication.update({ where: { id: applicationId }, data: { policyDecision: gate as unknown as object } });
  await logAudit({ userId: actingUserId, organizationId: application.organizationId, action: "career:application:policy_checked", metadata: { applicationId, decision: gate.decision } });

  if (gate.decision === "PLATFORM_RESTRICTED") {
    assertValidTransition(application.status, "PLATFORM_RESTRICTED");
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "PLATFORM_RESTRICTED", blockedReason: submissionMethod.detail } });
    await notifyUser({ userId: application.userId, organizationId: application.organizationId, type: "SYSTEM_NOTICE", title: "Manual application required", message: `${job.title} at ${job.company} requires you to apply manually — automation is not authorized for this platform.` });
    return { ok: true, status: "PLATFORM_RESTRICTED" };
  }
  if (gate.decision === "APPLICATION_LIMIT_REACHED") {
    await notifyUser({ userId: application.userId, organizationId: application.organizationId, type: "SYSTEM_NOTICE", title: "Application limit reached", message: `Daily/weekly application limit reached — ${job.title} at ${job.company} will be retried later.` });
    return { ok: false, error: "Application limit reached." };
  }
  if (gate.decision === "USER_APPROVAL_REQUIRED" || gate.decision === "REVIEW_REQUIRED") {
    if (application.status !== "USER_APPROVAL_REQUIRED") {
      assertValidTransition(application.status, "USER_APPROVAL_REQUIRED");
      await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "USER_APPROVAL_REQUIRED" } });
      await notifyUser({ userId: application.userId, organizationId: application.organizationId, type: "APPROVAL_REQUESTED", title: "Approval required", message: `Review and approve your application for ${job.title} at ${job.company}.` });
    }
    return { ok: true, status: "USER_APPROVAL_REQUIRED" };
  }

  // SUBMIT_ALLOWED — actually dispatch. Idempotency: generate the attempt
  // id and move to SUBMITTING BEFORE the real network call, so a crash
  // mid-send leaves a real, inspectable trail (§30/§51).
  const attemptId = `app_${applicationId}_${Date.now()}`;
  assertValidTransition(application.status, "SUBMITTING");
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { status: "SUBMITTING", submittingAt: new Date(), submissionAttemptId: attemptId, retryCount: { increment: application.retryCount > 0 ? 1 : 0 } },
  });
  await logAudit({ userId: actingUserId, organizationId: application.organizationId, action: "career:application:submitting", metadata: { applicationId, attemptId, method: submissionMethod.method } });

  return dispatchSubmission(applicationId);
}

async function dispatchSubmission(applicationId: string): Promise<SubmitApplicationResult> {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true, careerProfile: true } });
  if (!application) return { ok: false, error: "Application not found." };
  const job = application.job;
  const submissionMethod = determineSubmissionMethod(job.description, job.canonicalUrl);

  if (submissionMethod.method !== "EMAIL" || !submissionMethod.recipientEmail) {
    // Should not be reachable — the policy gate already required a real
    // channel — but never silently claim success if it somehow is.
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "FAILED_REQUIRES_REVIEW", lastError: "No real submission channel at dispatch time." } });
    return { ok: false, error: "No real submission channel available." };
  }

  const coverLetterDoc = await prisma.applicationDocument.findFirst({ where: { applicationId, type: "COVER_LETTER" } });
  const outcome = await submitApplicationViaEmail({
    organizationId: application.organizationId,
    applicationId,
    recipientEmail: submissionMethod.recipientEmail,
    subject: `Application: ${job.title}`,
    body: coverLetterDoc?.content ?? `I am applying for the ${job.title} position at ${job.company}.`,
    candidateUserId: application.userId,
  });

  if (outcome.outcome === "SENT") {
    if (outcome.providerMessageId) {
      await prisma.applicationDocument.create({ data: { applicationId, type: "RECRUITER_EMAIL", providerMessageId: outcome.providerMessageId, content: coverLetterDoc?.content ?? null } });
    }
    assertValidTransition("SUBMITTING", "SUBMITTED");
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "SUBMITTED", submittedAt: new Date(), providerConfirmationId: outcome.providerMessageId } });
    await logAudit({ userId: application.userId, organizationId: application.organizationId, action: "career:application:submitted", metadata: { applicationId, providerMessageId: outcome.providerMessageId } });
    await notifyUser({ userId: application.userId, organizationId: application.organizationId, type: "SYSTEM_NOTICE", title: "Application submitted", message: `Your application for ${job.title} at ${job.company} was sent — awaiting delivery confirmation.` });
    return { ok: true, status: "SUBMITTED" };
  }

  if (outcome.outcome === "UNCERTAIN") {
    assertValidTransition("SUBMITTING", "SUBMITTED_UNCONFIRMED");
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "SUBMITTED_UNCONFIRMED", lastError: outcome.error } });
    await logAudit({ userId: application.userId, organizationId: application.organizationId, action: "career:application:submission_uncertain", metadata: { applicationId, error: outcome.error } });
    return { ok: true, status: "SUBMITTED_UNCONFIRMED" };
  }

  // FAILED
  assertValidTransition("SUBMITTING", outcome.retryable ? "FAILED_REQUIRES_REVIEW" : "FAILED");
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { status: outcome.retryable ? "FAILED_REQUIRES_REVIEW" : "FAILED", lastError: outcome.error, retryCount: { increment: 1 } },
  });
  await logAudit({ userId: application.userId, organizationId: application.organizationId, action: "career:application:submission_failed", metadata: { applicationId, error: outcome.error, retryable: outcome.retryable } });
  await notifyUser({ userId: application.userId, organizationId: application.organizationId, type: "SYSTEM_NOTICE", title: "Application failed", message: `Your application for ${job.title} at ${job.company} failed to send: ${outcome.error}` });
  return { ok: false, error: outcome.error };
}

/** §56 mandatory test scenario + real ongoing reconciliation — never blindly retries an UNCONFIRMED/uncertain submission; only promotes it to CONFIRMED/FAILED_REQUIRES_REVIEW based on a real provider signal. */
export async function reconcileSubmissionStatusCore(applicationId: string): Promise<SubmitApplicationResult> {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
  if (!application) return { ok: false, error: "Application not found." };
  if (application.status !== "SUBMITTED" && application.status !== "SUBMITTED_UNCONFIRMED") return { ok: true, status: application.status };

  if (!application.providerConfirmationId) {
    // No provider message id was ever recorded — the status genuinely
    // cannot be resolved automatically.
    if (application.status === "SUBMITTED_UNCONFIRMED") {
      assertValidTransition("SUBMITTED_UNCONFIRMED", "FAILED_REQUIRES_REVIEW");
      await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "FAILED_REQUIRES_REVIEW" } });
      return { ok: true, status: "FAILED_REQUIRES_REVIEW" };
    }
    return { ok: true, status: application.status };
  }

  const confirmation = await checkEmailDeliveryConfirmation(application.providerConfirmationId);
  if (confirmation.confirmed) {
    assertValidTransition(application.status, "CONFIRMED");
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
    await logAudit({ userId: application.userId, organizationId: application.organizationId, action: "career:application:confirmed", metadata: { applicationId } });
    await notifyUser({ userId: application.userId, organizationId: application.organizationId, type: "SYSTEM_NOTICE", title: "Application confirmed", message: "Delivery of your application was confirmed." });
    return { ok: true, status: "CONFIRMED" };
  }
  if (confirmation.bounced) {
    assertValidTransition(application.status, "FAILED_REQUIRES_REVIEW");
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "FAILED_REQUIRES_REVIEW", lastError: "Recruiter email bounced." } });
    return { ok: true, status: "FAILED_REQUIRES_REVIEW" };
  }
  return { ok: true, status: application.status }; // still genuinely unknown — leave as-is, checked again next run
}
