/** Revision predicates shared by serving and generation. Missing lineage
 * denotes baseline standing only; it never follows a changed statement. */
import { inArray, sql } from 'drizzle-orm';
import { signals } from '../db/index.js';
import type { getDb } from './db.js';
import { BackgroundJobHeldError } from './background-job-hold.js';
import { GROUP_INPUT_POLICY } from './group-inputs.js';

const column = (table: string, name: string) => sql`${sql.identifier(table)}.${sql.identifier(name)}`;

export function evidenceSupportCurrent(evidenceName = 'signal_evidence', signalName = 'signals') {
  const evidence = (name: string) => column(evidenceName, name);
  return sql`(coalesce(${evidence('statement_revision')}, 1) = ${column(signalName, 'statement_revision')}
    AND coalesce(${evidence('material_revision')}::numeric,
      CASE WHEN ${evidence('material')}->>'policy' = 'inspiration-material-v1'
        AND ${evidence('material')}->>'revision' ~ '^[1-9][0-9]*$'
        THEN (${evidence('material')}->>'revision')::numeric END, 1)
      = (SELECT CASE WHEN ${evidence('profile_id')} = ${evidence('owner_profile_id')}
          THEN r.personal_revision ELSE r.public_revision END
        FROM inspiration_revisions r WHERE r.inspiration_id = ${evidence('inspiration_id')}
          AND r.profile_id = ${evidence('owner_profile_id')}))`;
}

export function citationStatementCurrent(citationName: string, signalName = 'signals') {
  return sql`coalesce(${column(citationName, 'statement_revision')}, 1) = ${column(signalName, 'statement_revision')}`;
}

export function citationBodyCurrent(citationName: string, parentName: string, citationColumn: string, parentColumn: string) {
  return sql`coalesce(${column(citationName, citationColumn)}, 1) = ${column(parentName, parentColumn)}`;
}

export async function loadSignalStatementRevisions(db: Pick<ReturnType<typeof getDb>, 'select'>, ids: string[]) {
  return new Map(ids.length ? (await db.select({ id: signals.id, revision: signals.statementRevision }).from(signals)
    .where(inArray(signals.id, ids))).map((row) => [row.id, row.revision]) : []);
}

export async function loadPendingSignalSupportSources(db: Pick<ReturnType<typeof getDb>, 'execute'>, profileId: string) {
  return db.execute<{ ownerProfileId: string; inspirationId: string; groupId: string | null }>(sql`
    SELECT DISTINCT e.owner_profile_id AS "ownerProfileId", e.inspiration_id AS "inspirationId", p.group_id AS "groupId"
    FROM signal_evidence e JOIN signals s ON s.id = e.signal_id AND s.profile_id = e.profile_id
    JOIN inspirations i ON i.id = e.inspiration_id AND i.profile_id = e.owner_profile_id
    JOIN profiles p ON p.id = e.profile_id
    WHERE e.profile_id = ${profileId}::uuid AND s.status::text <> 'retired' AND s.dismissed_at IS NULL
      AND (${evidenceSupportCurrent('e', 's')}) IS NOT TRUE
      AND (e.owner_profile_id = e.profile_id OR (p.type::text = 'group' AND s.input_policy = ${GROUP_INPUT_POLICY}
        AND i.visibility::text = 'public' AND EXISTS (SELECT 1 FROM group_members m
          WHERE m.group_id = p.group_id AND m.profile_id = e.owner_profile_id)))
    ORDER BY e.owner_profile_id, e.inspiration_id`);
}

/** Scope includes only current allowed sources, not another room's failed job. */
export async function loadSignalSupportWorkState(db: Pick<ReturnType<typeof getDb>, 'execute'>, profileId: string) {
  const sources = await loadPendingSignalSupportSources(db, profileId);
  const jobs = await db.execute<{ status: string; inspirationId: string; type: string; runAfter: string | Date }>(sql`
    SELECT j.status::text, j.type::text, j.run_after AS "runAfter", j.payload->>'inspirationId' AS "inspirationId"
    FROM background_jobs j JOIN inspirations i ON i.id::text = j.payload->>'inspirationId' AND i.profile_id = j.profile_id
    JOIN profiles p ON p.id = ${profileId}::uuid
    WHERE j.type::text IN ('review_signal_support', 'assess_signal_support', 'derive_signals')
      AND coalesce(j.payload->>'deriveIntoProfileId', j.profile_id::text) = p.id::text
      AND (i.profile_id = p.id OR (p.type::text = 'group' AND i.visibility::text = 'public'
        AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = p.group_id AND m.profile_id = i.profile_id)))`);
  const pendingIds = new Set(sources.map((source) => source.inspirationId));
  const relevant = jobs.filter((job) => pendingIds.has(job.inspirationId) ||
    ((job.type === 'review_signal_support' || job.type === 'assess_signal_support') && (job.status === 'pending' || job.status === 'running')));
  const reviewJobs=await db.execute<{status:string;runAfter:Date|string}>(sql`SELECT DISTINCT j.status::text,j.run_after AS "runAfter"
    FROM background_jobs j JOIN review_answers a ON a.id::text=j.payload->>'answerId' AND a.profile_id=j.profile_id
    WHERE j.profile_id=${profileId}::uuid AND j.type::text='derive_review_answer'
      AND EXISTS(SELECT 1 FROM signal_review_evidence e WHERE e.profile_id=a.profile_id AND e.answer_id=a.id
        AND review_evidence_current(e.profile_id,e.signal_id,e.answer_id) IS NOT TRUE)`);
  const activeJobs = [...relevant,...reviewJobs].filter((job) => job.status === 'pending' || job.status === 'running');
  const nextRun = activeJobs.length ? Math.min(...activeJobs.map((job) => job.status === 'running' ? Date.now() : new Date(job.runAfter).getTime())) : null;
  return { sources, active: activeJobs.length > 0, running: activeJobs.some((job) => job.status === 'running'), nextRun,
    failed: [...relevant,...reviewJobs].some((job) => job.status === 'failed'),
    pending: sources.length > 0 || activeJobs.length > 0 };
}

export async function assertSignalSupportSettled(db: Pick<ReturnType<typeof getDb>, 'execute'>, profileId: string, now: Date) {
  const state = await loadSignalSupportWorkState(db, profileId);
  if (state.failed) throw new Error('Current support could not be checked; retry the reading');
  if (state.active) throw new BackgroundJobHeldError(new Date(Math.max(now.getTime() + 5_000, state.nextRun ?? 0)), 'Current support is being checked');
}
