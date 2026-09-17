import type { SequenceStepInput } from "@/lib/validations/outreach";

/**
 * Split out of opportunity-outreach-actions.ts: a `"use server"` file may
 * only export async functions (Next.js strips/rejects any other export at
 * build time — production's stricter build turned this into "module has no
 * exports at all" for every consumer, including the real
 * `convertOpportunityToOutreach` action itself). These are plain constants,
 * so they live here instead, with no `"use server"` directive.
 */

export const OUTREACH_CAMPAIGN_NAME = "AI Opportunity Outreach";
export const OUTREACH_SEQUENCE_NAME = "AI Opportunity Outreach — Default";
export const OUTREACH_SEQUENCE_NAME_LINKEDIN = "AI Opportunity Outreach — Default (LinkedIn)";

/**
 * Day 0 / 2 / 5 / 9 / 15 cadence from the Phase 5 spec, expressed as real
 * `SequenceStepInput`s.
 *
 * IMPORTANT — delayDays is RELATIVE, not cumulative: read carefully in
 * advanceSequenceCore (src/app/dashboard/outreach/_lib/sequence-actions.ts):
 *   const daysSinceSent = (Date.now() - latestDraft.sentAt.getTime()) / 86_400_000;
 *   const requiredDelay = steps[nextIndex].delayDays ?? 0;
 *   if (daysSinceSent < requiredDelay) return { ok: true, advanced: false };
 * `daysSinceSent` is measured from when the *immediately previous* content
 * step was actually SENT, not from Day 0/enrollment. So the calendar days
 * (0, 2, 5, 9, 15) are converted here into RELATIVE deltas between
 * consecutive sends: 0, then +2 (=day 2), +3 (=day 5), +4 (=day 9), +6
 * (=day 15). Using the raw calendar numbers (0, 2, 5, 9, 15) directly as
 * delayDays would be wrong — it would make the real send cadence 0, 2, 7,
 * 16, 31 days, compounding every step.
 *
 * No `WAIT`-type steps: `nextContentStepIndex`/`advanceSequenceCore` skip
 * over `WAIT` steps entirely and read the delay straight off the next real
 * content step's own `delayDays` field, so a separate `WAIT` entry between
 * two `EMAIL` steps would carry no delay of its own and add nothing — the
 * delay already lives on the content step that follows it.
 *
 * DraftPurpose values used (INTRODUCTION, FOLLOW_UP, CASE_STUDY, REMINDER)
 * are all real, existing enum values (see prisma/schema.prisma's
 * `enum DraftPurpose`) — no new value invented.
 */
export const DEFAULT_SEQUENCE_STEPS: SequenceStepInput[] = [
  { order: 0, type: "EMAIL", delayDays: 0, purpose: "INTRODUCTION", tone: "PROFESSIONAL" }, // Day 0
  { order: 1, type: "EMAIL", delayDays: 2, purpose: "FOLLOW_UP", tone: "PROFESSIONAL" }, // Day 2 (0 + 2)
  { order: 2, type: "EMAIL", delayDays: 3, purpose: "FOLLOW_UP", tone: "CONSULTATIVE" }, // Day 5 (2 + 3) — the "value follow-up"
  { order: 3, type: "EMAIL", delayDays: 4, purpose: "CASE_STUDY", tone: "PROFESSIONAL" }, // Day 9 (5 + 4)
  { order: 4, type: "EMAIL", delayDays: 6, purpose: "REMINDER", tone: "PROFESSIONAL" }, // Day 15 (9 + 6)
];

/**
 * Same Day 0/2/5/9/15 cadence, but the Day 0 first touch is a LinkedIn
 * connection request instead of an email — `type`/`purpose` here match
 * resolveStepChannelAndPurpose's own LINKEDIN branch exactly
 * (sequence-actions.ts: `if (step.type === "LINKEDIN") return { channel:
 * "LINKEDIN", purpose: step.purpose ?? "CONNECTION_REQUEST" }`). The Day
 * 2/5/9/15 follow-ups stay EMAIL — a LinkedIn connection request followed by
 * email follow-ups is a normal real-world sequence, and every step from Day
 * 2 onward still needs a real Contact.email regardless of how Day 0 went.
 */
export const DEFAULT_SEQUENCE_STEPS_LINKEDIN_FIRST: SequenceStepInput[] = [
  { order: 0, type: "LINKEDIN", delayDays: 0, purpose: "CONNECTION_REQUEST", tone: "PROFESSIONAL" }, // Day 0
  ...DEFAULT_SEQUENCE_STEPS.slice(1),
];
