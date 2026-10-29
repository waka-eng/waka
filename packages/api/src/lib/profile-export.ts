/**
 * The export — everything, in one deterministic bundle.
 *
 * goal: no-quiet-corners, Phase 3 (register item 6). The anti-Dreaming: a
 * platform's "memory summary" admits it "will not include everything"; this
 * bundle IS everything — principles verbatim, every signal with its lock
 * state, evidence and statement chain, the full top-of-mind version chain
 * with reasons, raw inspirations with their attachments and reflections,
 * the consultation record, the suppression record, the feedback record,
 * and the decision citations. A person can leave with all of it.
 *
 * TENANCY AT EGRESS. Every query here is the same profile-scoped read the
 * serving routes make — the export db test proves the bundle carries every
 * row of the exported profile and zero rows of any other.
 *
 * DETERMINISTIC. Same rows in, same bundle out: every list is ordered by
 * (created_at, id), rows are served whole (no cherry-picked columns to go
 * stale against the schema), and serialization is the caller's plain JSON.
 *
 * DELIBERATELY EXCLUDED, stated rather than implied: embedding vectors and
 * background jobs (recomputable infrastructure, not memory), session rows
 * (credentials are not memory and do not leave), and other members' group
 * content (a room's wall is the room's; the person's own `signalShares`
 * rows record what THEY said out loud, and those are here).
 */

import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { deletedShelfCutoff } from "./deleted-shelf.js";
import {conversations,conversationMessages,conversationReplyRequests} from '../db/schema-conversations.js';
import {principleGenerationSteps} from '../db/schema-principle-work.js';

import {
  attachments,
  consultations,
  decisionPrincipleCitations,
  deletedInspirations,
  HARVEST_LAPSE_DAYS,
  harvestCandidates,
  feedback,
  inspirations,
  inspirationConversationOrigins,
  principleSignals,
  principleStatements,
  principles,
  profiles,
  reflections,
  reviewSessions,
  reviewItems,
  reviewAnswers,
  reviewAnswerSources,
  signalReviewEvidence,
  signalReviewEvidenceSources,
  reviewSignalSupport,
  reviewAnswerProcessing,
  reviewModelRuns,
  signalContradictions,
  signalEvidence,
  experiences,
  signalShares,
  signalStatements,
  signals,
  suppressions,
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
} from "../db/index.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

export async function assembleProfileExport(db: WakaDb, profileId: string) {
  const [profile] = await db
    .select({
      id: profiles.id,
      name: profiles.name,
      type: profiles.type,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);

  const inspirationRows = await db
    .select()
    .from(inspirations)
    .where(eq(inspirations.profileId, profileId))
    .orderBy(asc(inspirations.createdAt), asc(inspirations.id));
  const attachmentRows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.profileId, profileId))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
  const reflectionRows = await db
    .select()
    .from(reflections)
    .where(eq(reflections.profileId, profileId))
    .orderBy(asc(reflections.createdAt), asc(reflections.id));

  const signalRows = await db
    .select()
    .from(signals)
    .where(eq(signals.profileId, profileId))
    .orderBy(asc(signals.createdAt), asc(signals.id));
  const evidenceRows = await db
    .select()
    .from(signalEvidence)
    .where(eq(signalEvidence.profileId, profileId))
    .orderBy(asc(signalEvidence.createdAt), asc(signalEvidence.id));
  const signalStatementRows = await db
    .select()
    .from(signalStatements)
    .where(eq(signalStatements.profileId, profileId))
    .orderBy(asc(signalStatements.createdAt), asc(signalStatements.id));
  const shareRows = await db
    .select()
    .from(signalShares)
    .where(eq(signalShares.profileId, profileId))
    .orderBy(asc(signalShares.createdAt), asc(signalShares.id));
  const contradictionRows = await db
    .select()
    .from(signalContradictions)
    .where(eq(signalContradictions.profileId, profileId))
    .orderBy(asc(signalContradictions.createdAt), asc(signalContradictions.id));

  const topOfMindRows = await db
    .select()
    .from(topOfMinds)
    .where(eq(topOfMinds.profileId, profileId))
    .orderBy(asc(topOfMinds.createdAt), asc(topOfMinds.id));
  const artifactIds = topOfMindRows.map((row) => row.id);
  const entryRows = artifactIds.length
    ? await db
        .select()
        .from(topOfMindEntries)
        .where(inArray(topOfMindEntries.topOfMindId, artifactIds))
        .orderBy(asc(topOfMindEntries.createdAt), asc(topOfMindEntries.id))
    : [];
  const entryIds = entryRows.map((row) => row.id);
  const entrySignalRows = entryIds.length
    ? await db
        .select()
        .from(topOfMindEntrySignals)
        .where(inArray(topOfMindEntrySignals.entryId, entryIds))
        .orderBy(asc(topOfMindEntrySignals.createdAt), asc(topOfMindEntrySignals.id))
    : [];

  const principleRows = await db
    .select()
    .from(principles)
    .where(eq(principles.profileId, profileId))
    .orderBy(asc(principles.rank), asc(principles.id));
  const principleCitationRows = await db
    .select()
    .from(principleSignals)
    .where(eq(principleSignals.profileId, profileId))
    .orderBy(asc(principleSignals.createdAt), asc(principleSignals.id));
  const principleStatementRows = await db
    .select()
    .from(principleStatements)
    .where(eq(principleStatements.profileId, profileId))
    .orderBy(asc(principleStatements.createdAt), asc(principleStatements.id));

  const consultationRows = await db
    .select()
    .from(consultations)
    .where(eq(consultations.profileId, profileId))
    .orderBy(asc(consultations.servedAt), asc(consultations.id));
  const suppressionRows = await db
    .select()
    .from(suppressions)
    .where(eq(suppressions.profileId, profileId))
    .orderBy(asc(suppressions.suppressedAt), asc(suppressions.id));
  const feedbackRows = await db
    .select()
    .from(feedback)
    .where(eq(feedback.profileId, profileId))
    .orderBy(asc(feedback.createdAt), asc(feedback.id));
  const decisionCitationRows = await db
    .select()
    .from(decisionPrincipleCitations)
    .where(eq(decisionPrincipleCitations.profileId, profileId))
    .orderBy(asc(decisionPrincipleCitations.createdAt), asc(decisionPrincipleCitations.id));
  /* The named grounds (2026-08-17): the person's own words for their
     stretches of work, so they belong in "everything visible". The
     inspirations rows already carry experience_id; without this table the
     ids would point at names the export never said. `agent_keys` stays out
     deliberately — the rows are credential hashes plus bookkeeping, not
     memory, and a hash has no business travelling. */
  const experienceRows = await db
    .select()
    .from(experiences)
    .where(eq(experiences.profileId, profileId))
    .orderBy(asc(experiences.createdAt), asc(experiences.id));

  return {
    profile: profile ?? null,
    conversations:await db.select().from(conversations).where(and(eq(conversations.profileId,profileId),isNull(conversations.deletedAt))).orderBy(asc(conversations.createdAt),asc(conversations.id)),
    conversationMessages:await db.select().from(conversationMessages).where(eq(conversationMessages.profileId,profileId)).orderBy(asc(conversationMessages.conversationId),asc(conversationMessages.position)),
    conversationReplyRequests:await db.select().from(conversationReplyRequests).where(eq(conversationReplyRequests.profileId,profileId)).orderBy(asc(conversationReplyRequests.createdAt),asc(conversationReplyRequests.id)),
    principleGenerationSteps:await db.select().from(principleGenerationSteps).where(eq(principleGenerationSteps.profileId,profileId)).orderBy(asc(principleGenerationSteps.startedAt),asc(principleGenerationSteps.id)),
    experiences: experienceRows,
    inspirations: inspirationRows,
    /* What the person deleted and can still bring back for a month, and the
       sentences waiting in their basket or decided there — both are theirs,
       and an export that left them out would say less than the product
       keeps (found in review, 2026-10-15). */
    /* Only what is still on the shelf: a copy past its month is gone, even
       if no sweep has reached it yet. */
    deletedInspirations: (await db.select().from(deletedInspirations).where(and(eq(deletedInspirations.profileId, profileId), gte(deletedInspirations.deletedAt, deletedShelfCutoff(new Date())))).orderBy(asc(deletedInspirations.deletedAt), asc(deletedInspirations.id)))
      .map(row => ({ ...row, personalRevision: row.personalRevision.toString(), publicRevision: row.publicRevision.toString() })),
    /* A candidate past its week has lapsed whether or not the basket was
       opened since, so its words are not exported as if they were waiting. */
    harvestCandidates: (await db.select({ id: harvestCandidates.id, text: harvestCandidates.text, title: harvestCandidates.title, context: harvestCandidates.context,
      status: harvestCandidates.status, reason: harvestCandidates.reason, reasonNote: harvestCandidates.reasonNote, inspirationId: harvestCandidates.inspirationId,
      createdAt: harvestCandidates.createdAt, decidedAt: harvestCandidates.decidedAt })
      .from(harvestCandidates).where(eq(harvestCandidates.profileId, profileId)).orderBy(asc(harvestCandidates.createdAt), asc(harvestCandidates.id)))
      .map((row) => row.status === "pending" && Date.now() - row.createdAt.getTime() >= HARVEST_LAPSE_DAYS * 86_400_000
        ? { ...row, status: "lapsed" as const, text: null, title: null }
        : row),
    inspirationConversationOrigins:await db.select().from(inspirationConversationOrigins).where(eq(inspirationConversationOrigins.profileId,profileId)).orderBy(asc(inspirationConversationOrigins.createdAt),asc(inspirationConversationOrigins.inspirationId)),
    attachments: attachmentRows,
    reflections: reflectionRows,
    reviewSessions: await db.select().from(reviewSessions).where(eq(reviewSessions.profileId,profileId)).orderBy(asc(reviewSessions.createdAt),asc(reviewSessions.id)),
    reviewItems: (await db.select().from(reviewItems).where(eq(reviewItems.profileId,profileId)).orderBy(asc(reviewItems.sessionId),asc(reviewItems.position)))
      .map(row=>({...row,sourceRevision:row.sourceRevision.toString()})),
    reviewAnswers:await db.select().from(reviewAnswers).where(and(eq(reviewAnswers.profileId,profileId),isNull(reviewAnswers.deletedAt))).orderBy(asc(reviewAnswers.createdAt),asc(reviewAnswers.id)),
    reviewAnswerSources:(await db.select().from(reviewAnswerSources).where(eq(reviewAnswerSources.profileId,profileId)).orderBy(asc(reviewAnswerSources.answerId),asc(reviewAnswerSources.inspirationId)))
      .map(row=>({...row,sourceRevision:row.sourceRevision.toString()})),
    signals: signalRows.map((row) => ({ ...row, statementRevision: row.statementRevision.toString() })),
    signalEvidence: evidenceRows.map((row) => ({ ...row, statementRevision: row.statementRevision?.toString() ?? null,
      materialRevision: row.materialRevision?.toString() ?? null })),
    signalReviewEvidence:(await db.select().from(signalReviewEvidence).where(eq(signalReviewEvidence.profileId,profileId)))
      .map(row=>({...row,statementRevision:row.statementRevision.toString()})),
    signalReviewEvidenceSources:(await db.select().from(signalReviewEvidenceSources).where(eq(signalReviewEvidenceSources.profileId,profileId)))
      .map(row=>({...row,materialRevision:row.materialRevision.toString()})),
    reviewSignalSupport:(await db.select().from(reviewSignalSupport).where(eq(reviewSignalSupport.profileId,profileId)))
      .map(row=>({...row,statementRevision:row.statementRevision.toString()})),
    reviewAnswerProcessing:(await db.select().from(reviewAnswerProcessing).where(eq(reviewAnswerProcessing.profileId,profileId)))
      .map(row=>({...row,derivationRequestVersion:row.derivationRequestVersion?.toString()??null,readingRequestVersion:row.readingRequestVersion?.toString()??null})),
    reviewModelRuns:await db.select().from(reviewModelRuns).where(eq(reviewModelRuns.profileId,profileId)).orderBy(asc(reviewModelRuns.startedAt),asc(reviewModelRuns.id)),
    signalStatements: signalStatementRows,
    signalShares: shareRows,
    signalContradictions: contradictionRows,
    topOfMinds: topOfMindRows,
    topOfMindEntries: entryRows.map((row) => ({ ...row, bodyRevision: row.bodyRevision.toString() })),
    topOfMindEntrySignals: entrySignalRows.map((row) => ({ ...row, statementRevision: row.statementRevision?.toString() ?? null,
      entryBodyRevision: row.entryBodyRevision?.toString() ?? null })),
    principles: principleRows.map((row) => ({ ...row, statementRevision: row.statementRevision.toString() })),
    principleSignals: principleCitationRows.map((row) => ({ ...row, statementRevision: row.statementRevision?.toString() ?? null,
      principleStatementRevision: row.principleStatementRevision?.toString() ?? null })),
    principleStatements: principleStatementRows,
    consultations: consultationRows,
    suppressions: suppressionRows,
    feedback: feedbackRows.map((row) => ({ ...row, targetRevision: row.targetRevision?.toString() ?? null })),
    decisionPrincipleCitations: decisionCitationRows,
  };
}

export type ProfileExport = Awaited<ReturnType<typeof assembleProfileExport>>;
