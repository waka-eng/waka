import { inArray, sql } from "drizzle-orm";
import { feedback,principles, signals, signalContradictions,topOfMindEntries, topOfMindEntrySignals } from "../db/index.js";
import { getDb } from "./db.js";
import { citationBodyCurrent, citationStatementCurrent, evidenceSupportCurrent } from './signal-support-state.js';
import {reviewEvidenceCurrent} from './review-evidence.js';
import {feedbackWordingCurrent} from './feedback-revisions.js';

type Db = Pick<ReturnType<typeof getDb>, "select">;

/** Current standing, not a claim that legacy lineage or semantic quality was
 * independently verified. Every current witness must belong to this profile. */
export function personalSignalReadable(profileId: string, countDismissed = false) {
  /* `countDismissed`: only the principles reconcile, which deletes, and must
     treat an undoable dismissal as still standing. Never for a read. */
  const standing = countDismissed
    ? sql`(${signals.status} <> 'retired' OR ${signals.dismissedAt} IS NOT NULL)`
    : sql`${signals.status} <> 'retired' AND ${signals.dismissedAt} IS NULL`;
  return sql`(${signals.profileId} = ${profileId}::uuid AND ${standing}
    AND ${signals.unsupportedAt} IS NULL
    AND (EXISTS (SELECT 1 FROM signal_evidence pe JOIN inspirations pi
      ON pi.id = pe.inspiration_id AND pi.profile_id = pe.owner_profile_id
      WHERE pe.signal_id = ${signals.id} AND pe.profile_id = ${profileId}::uuid
        AND pe.owner_profile_id = ${profileId}::uuid)
      OR EXISTS (SELECT 1 FROM signal_review_evidence re WHERE re.profile_id=${profileId}::uuid AND re.signal_id=${signals.id}
        AND ${reviewEvidenceCurrent('re')}))
    AND NOT EXISTS (SELECT 1 FROM signal_review_evidence re WHERE re.signal_id=${signals.id}
      AND (${reviewEvidenceCurrent('re')}) IS NOT TRUE)
    AND NOT EXISTS (SELECT 1 FROM signal_evidence pe WHERE pe.signal_id = ${signals.id}
      AND (${evidenceSupportCurrent('pe')}) IS NOT TRUE)
    AND NOT EXISTS (SELECT 1 FROM signal_evidence pe WHERE pe.signal_id = ${signals.id}
      AND pe.owner_profile_id <> ${profileId}::uuid))`;
}

/** Apply before a public limit: hidden rows must not crowd readable entries
 * out of the result, nor require fetching an unbounded private artifact. */
export function personalEntrySupportCurrent(profileId: string, countDismissed = false) {
  return sql`(
    EXISTS (SELECT 1 FROM top_of_mind_entry_signals pc WHERE pc.entry_id = ${topOfMindEntries.id})
    AND NOT EXISTS (SELECT 1 FROM top_of_mind_entry_signals pc LEFT JOIN signals ON signals.id = pc.signal_id
      WHERE pc.entry_id = ${topOfMindEntries.id} AND ((${personalSignalReadable(profileId, countDismissed)}) IS NOT TRUE
        OR (${citationStatementCurrent('pc')}) IS NOT TRUE))
    AND NOT EXISTS (SELECT 1 FROM top_of_mind_entry_signals pc WHERE pc.entry_id = ${topOfMindEntries.id}
      AND (${citationBodyCurrent('pc', 'top_of_mind_entries', 'entry_body_revision', 'body_revision')}) IS NOT TRUE)
  )`;
}

export function personalEntryReadable(profileId: string) {
  return sql`(${topOfMindEntries.lockedAt} IS NOT NULL OR ${topOfMindEntries.pinnedAt} IS NOT NULL
    OR ${personalEntrySupportCurrent(profileId)})`;
}

export function personalPrincipleSupportCurrent(profileId: string, minimumSignals: number) {
  return sql`((SELECT count(*) FROM principle_signals ps WHERE ps.principle_id = "principles"."id") >= ${minimumSignals}
    AND NOT EXISTS (SELECT 1 FROM principle_signals ps LEFT JOIN signals ON signals.id = ps.signal_id
      WHERE ps.principle_id = "principles"."id" AND ((${personalSignalReadable(profileId)}) IS NOT TRUE
        OR (${citationStatementCurrent('ps')}) IS NOT TRUE
        OR (${citationBodyCurrent('ps', 'principles', 'principle_statement_revision', 'statement_revision')}) IS NOT TRUE)))`;
}

export function personalPrincipleReadable(profileId: string, minimumSignals: number) {
  return sql`(${principles.lockedAt} IS NOT NULL OR ${principles.origin} = 'declared'
    OR ${personalPrincipleSupportCurrent(profileId, minimumSignals)})`;
}

interface EntryForProjection {
  id: string;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: Date | null;
  pinnedAt: Date | null;
  dismissedAt: Date | null;
}

/** Shared by private/public reads and generator context. A safe subset of a
 * conclusion's citations is not proof of the whole conclusion. Kept wording
 * survives with changed support; stale machine explanation does not. */
export async function projectPersonalEntries<T extends EntryForProjection>(db: Db, profileId: string, rows: T[], includeWithheld = false,citationViews=false) {
  const citationsByEntry = new Map<string, string[]>();
  const citations = rows.length?await db.select({ entryId: topOfMindEntrySignals.entryId, signalId: topOfMindEntrySignals.signalId,
    statement:citationViews?sql<string|null>`CASE WHEN ${signals.profileId}=${profileId}::uuid THEN ${signals.statement} END`:sql<string|null>`NULL`,
    statementRevision:signals.statementRevision,lockedAt:signals.lockedAt,
    answered:citationViews?sql<boolean>`EXISTS(SELECT 1 FROM ${feedback} WHERE ${feedback.profileId}=${profileId}::uuid
      AND ${feedback.targetType}='signal' AND ${feedback.targetId}=${signals.id} AND ${feedbackWordingCurrent()})`:sql<boolean>`false`,
    contested:citationViews?sql<boolean>`EXISTS(SELECT 1 FROM ${signalContradictions} WHERE ${signalContradictions.profileId}=${profileId}::uuid
      AND ${signalContradictions.resolvedAt} IS NULL AND (${signalContradictions.aSignalId}=${signals.id} OR ${signalContradictions.bSignalId}=${signals.id}))`:sql<boolean>`false`,
    current: sql<boolean>`${citationStatementCurrent('top_of_mind_entry_signals')}
      AND ${citationBodyCurrent('top_of_mind_entry_signals', 'top_of_mind_entries', 'entry_body_revision', 'body_revision')}
      AND ${personalSignalReadable(profileId)}` })
    .from(topOfMindEntrySignals).leftJoin(signals, sql`${signals.id} = ${topOfMindEntrySignals.signalId}`)
    .leftJoin(topOfMindEntries, sql`${topOfMindEntries.id} = ${topOfMindEntrySignals.entryId}`)
    .where(inArray(topOfMindEntrySignals.entryId, rows.map((row) => row.id))):[];
  let supportChanged = false;
  const entries = rows.flatMap((row) => {
    const links = citations.filter((link) => link.entryId === row.id);
    const current = links.flatMap((link) => link.current === true && link.signalId ? [link.signalId] : []);
    const changed = links.length === 0 || current.length !== links.length;
    if (changed && row.dismissedAt === null) supportChanged = true;
    if (changed && !includeWithheld && !row.lockedAt && !row.pinnedAt && !row.dismissedAt) return [];
    citationsByEntry.set(row.id, current);
    return [{ ...row, supportChanged: changed,
      ...(changed ? { belief: null, prompt: null } : {}) }];
  });
  return { entries, citationsByEntry, supportChanged,citations };
}
