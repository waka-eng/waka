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

import { asc, eq, inArray } from "drizzle-orm";

import {
  attachments,
  consultations,
  decisionPrincipleCitations,
  feedback,
  inspirations,
  principleSignals,
  principleStatements,
  principles,
  profiles,
  reflections,
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
    experiences: experienceRows,
    inspirations: inspirationRows,
    attachments: attachmentRows,
    reflections: reflectionRows,
    signals: signalRows,
    signalEvidence: evidenceRows,
    signalStatements: signalStatementRows,
    signalShares: shareRows,
    signalContradictions: contradictionRows,
    topOfMinds: topOfMindRows,
    topOfMindEntries: entryRows,
    topOfMindEntrySignals: entrySignalRows,
    principles: principleRows,
    principleSignals: principleCitationRows,
    principleStatements: principleStatementRows,
    consultations: consultationRows,
    suppressions: suppressionRows,
    feedback: feedbackRows,
    decisionPrincipleCitations: decisionCitationRows,
  };
}

export type ProfileExport = Awaited<ReturnType<typeof assembleProfileExport>>;
