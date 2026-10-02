import { and, eq, inArray, sql } from "drizzle-orm";
import { groupTopOfMindProposals, principles, signals, topOfMindEntries, topOfMindEntrySignals } from "../db/index.js";
import { getDb } from "./db.js";
import { GROUP_INPUT_POLICY } from "./group-inputs.js";
import { GROUP_SIGNAL_MIN_VOICES } from "./signal-derivation-thresholds.js";
import { citationBodyCurrent, citationStatementCurrent, evidenceSupportCurrent } from './signal-support-state.js';

type Db = Pick<ReturnType<typeof getDb>, "select">;

/** A reusable predicate on the outer signals row. No bounded wall scan. */
export function groupSignalReadable(groupId: string) {
  return sql`(
    ${signals.inputPolicy} = ${GROUP_INPUT_POLICY}
    AND ${signals.status} <> 'retired' AND ${signals.dismissedAt} IS NULL
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = ${signals.profileId} AND p.type = 'group' AND p.group_id = ${groupId}::uuid)
    AND (SELECT count(DISTINCT e.owner_profile_id)
      FROM signal_evidence e JOIN inspirations i ON i.id = e.inspiration_id AND i.profile_id = e.owner_profile_id
      JOIN group_members m ON m.profile_id = e.owner_profile_id AND m.group_id = ${groupId}::uuid
      WHERE e.signal_id = ${signals.id} AND i.visibility = 'public'
        AND ${evidenceSupportCurrent('e')}) >= ${GROUP_SIGNAL_MIN_VOICES}
    AND NOT EXISTS (SELECT 1 FROM signal_evidence e JOIN inspirations i ON i.id = e.inspiration_id AND i.profile_id = e.owner_profile_id
      JOIN group_members m ON m.profile_id = e.owner_profile_id AND m.group_id = ${groupId}::uuid
      WHERE e.signal_id = ${signals.id} AND i.visibility = 'public' AND (${evidenceSupportCurrent('e')}) IS NOT TRUE)
  )`;
}

/** All citations, not a safe subset of a possibly unsafe conclusion. */
export function groupPrincipleReadable(groupId: string, minimumSignals: number) {
  return sql`(
    ${principles.inputPolicy} = ${GROUP_INPUT_POLICY}
    AND (SELECT count(*) FROM principle_signals ps WHERE ps.principle_id = "principles"."id") >= ${minimumSignals}
    AND NOT EXISTS (
      SELECT 1 FROM principle_signals ps LEFT JOIN signals ON signals.id = ps.signal_id
      WHERE ps.principle_id = "principles"."id" AND ((${groupSignalReadable(groupId)}) IS NOT TRUE
        OR (${citationStatementCurrent('ps')}) IS NOT TRUE
        OR (${citationBodyCurrent('ps', 'principles', 'principle_statement_revision', 'statement_revision')}) IS NOT TRUE)
    )
  )`;
}

export function groupEntrySupportCurrent(groupId: string) {
  return sql`(${topOfMindEntries.inputPolicy} = ${GROUP_INPUT_POLICY}
    AND EXISTS (SELECT 1 FROM top_of_mind_entry_signals pc WHERE pc.entry_id = ${topOfMindEntries.id})
    AND NOT EXISTS (SELECT 1 FROM top_of_mind_entry_signals pc LEFT JOIN signals ON signals.id = pc.signal_id
      WHERE pc.entry_id = ${topOfMindEntries.id} AND ((${groupSignalReadable(groupId)}) IS NOT TRUE
        OR (${citationStatementCurrent('pc')}) IS NOT TRUE
        OR (${citationBodyCurrent('pc', 'top_of_mind_entries', 'entry_body_revision', 'body_revision')}) IS NOT TRUE)))`;
}

interface EntryForProjection {
  id: string;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: Date | null;
  inputPolicy: string | null;
}

/** Used for live views, historical views and generation context alike. */
export async function projectGroupEntries<T extends EntryForProjection>(db: Db, groupId: string, rows: T[]) {
  const citationsByEntry = new Map<string, string[]>();
  if (rows.length === 0) return { entries: rows, citationsByEntry, restricted: false };
  const citations = await db.select({ entryId: topOfMindEntrySignals.entryId, signalId: topOfMindEntrySignals.signalId,
    current: sql<boolean>`${citationStatementCurrent('top_of_mind_entry_signals')}
      AND ${citationBodyCurrent('top_of_mind_entry_signals', 'top_of_mind_entries', 'entry_body_revision', 'body_revision')}` })
    .from(topOfMindEntrySignals).leftJoin(signals, eq(signals.id, topOfMindEntrySignals.signalId))
    .leftJoin(topOfMindEntries, eq(topOfMindEntries.id, topOfMindEntrySignals.entryId))
    .where(inArray(topOfMindEntrySignals.entryId, rows.map((row) => row.id)));
  const citedIds = [...new Set(citations.flatMap((row) => row.signalId ? [row.signalId] : []))];
  const allowed = new Set(citedIds.length ? (await db.select({ id: signals.id }).from(signals)
    .where(and(inArray(signals.id, citedIds), groupSignalReadable(groupId)))).map((row) => row.id) : []);
  const accepted = await db.select({ body: groupTopOfMindProposals.body }).from(groupTopOfMindProposals)
    .where(and(eq(groupTopOfMindProposals.groupId, groupId), eq(groupTopOfMindProposals.status, "accepted"),
      inArray(groupTopOfMindProposals.kind, ["add_entry", "edit_entry"])));
  const publicWords = new Set(accepted.flatMap((row) => row.body?.trim() ? [row.body.trim()] : []));
  let restricted = false;
  const entries = rows.flatMap((row) => {
    const links = citations.filter((citation) => citation.entryId === row.id);
    const safeIds = links.flatMap((link) => link.current === true && link.signalId && allowed.has(link.signalId) ? [link.signalId] : []);
    const authored = row.lockedAt !== null && publicWords.has(row.body);
    if (authored) {
      citationsByEntry.set(row.id, safeIds);
      // Consent applies to the proposed body only. Never carry a legacy
      // generated explanation just because members approved different words.
      return [{ ...row, belief: null, prompt: null }];
    }
    if (row.inputPolicy === GROUP_INPUT_POLICY && links.length > 0 && safeIds.length === links.length) {
      citationsByEntry.set(row.id, safeIds);
      return [row];
    }
    restricted = true;
    return [];
  });
  return { entries, citationsByEntry, restricted };
}
