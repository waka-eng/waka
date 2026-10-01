import type { Sql } from "postgres";
import { GROUP_INPUT_POLICY } from "./group-inputs.js";

/**
 * Metadata-only inventory, not a conclusion that each record leaked. Runs
 * before or after migration 0032: to_jsonb tolerates the absent policy column.
 * No text, answer, quote, vector, name, credential, or job payload is returned.
 * SQL itself enforces read-only, consistent-snapshot operation.
 */
export async function buildGroupInputImpactReport(client: Sql, groupId: string, limit = 500) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Report limit must be 1–1000");
  return client.begin("isolation level repeatable read read only", async (tx) => {
    const [group] = await tx`SELECT id FROM groups WHERE id = ${groupId}`;
    if (!group) throw new Error("Group not found");
    const signals = await tx`
      SELECT s.id, s.profile_id, s.status, s.locked_at IS NOT NULL AS human_edited,
        to_jsonb(s)->>'input_policy' AS input_policy,
        EXISTS (
          SELECT 1 FROM signal_evidence e JOIN reflections r
            ON r.inspiration_id = e.inspiration_id AND r.profile_id = e.owner_profile_id
          WHERE e.signal_id = s.id AND NOT r.skipped AND length(trim(coalesce(r.answer, ''))) > 0
        ) AS has_current_reflection_on_evidence,
        count(*) OVER()::int AS total_count
      FROM signals s JOIN profiles p ON p.id = s.profile_id
      WHERE p.group_id = ${groupId} AND p.type = 'group'
        AND (to_jsonb(s)->>'input_policy') IS DISTINCT FROM ${GROUP_INPUT_POLICY}
      ORDER BY s.id LIMIT ${limit}`;
    // Current citations cannot prove earlier prompt context was clean. Include
    // the entire group's derivative history until it has separate policy stamps.
    const readings = await tx`
      SELECT m.id, m.version, m.status, m.created_at,
        (SELECT count(*)::int FROM top_of_mind_entries e WHERE e.top_of_mind_id = m.id) AS entry_count,
        (SELECT count(*)::int FROM top_of_mind_entries e WHERE e.top_of_mind_id = m.id AND e.locked_at IS NOT NULL) AS human_edited_entry_count,
        count(*) OVER()::int AS total_count
      FROM top_of_minds m WHERE m.group_id = ${groupId}
      ORDER BY m.version DESC, m.id LIMIT ${limit}`;
    const principles = await tx`
      SELECT r.id, r.origin, r.state, r.locked_at IS NOT NULL AS human_edited,
        count(*) OVER()::int AS total_count
      FROM principles r JOIN profiles p ON p.id = r.profile_id
      WHERE p.group_id = ${groupId} AND p.type = 'group'
      ORDER BY r.id LIMIT ${limit}`;
    const jobs = await tx`
      SELECT j.id, j.type, j.status, j.attempts, count(*) OVER()::int AS total_count
      FROM background_jobs j
      WHERE j.status IN ('pending', 'running', 'failed') AND (
        j.payload->>'groupId' = ${groupId}
        OR j.payload->>'deriveIntoProfileId' IN (SELECT id::text FROM profiles WHERE group_id = ${groupId} AND type = 'group')
        OR j.profile_id IN (SELECT id FROM profiles WHERE group_id = ${groupId} AND type = 'group')
      ) ORDER BY j.id LIMIT ${limit}`;
    const section = (rows: typeof signals) => ({
      total: Number(rows[0]?.total_count ?? 0),
      truncated: Number(rows[0]?.total_count ?? 0) > rows.length,
      records: rows.map(({ total_count: _total, ...record }) => record),
    });
    return {
      groupId, policy: GROUP_INPUT_POLICY, generatedAt: new Date().toISOString(),
      mode: "read_only" as const,
      unverifiedSignals: section(signals),
      readingsForReview: section(readings),
      principlesForReview: section(principles),
      jobsForReview: section(jobs),
      limitations: [
        "Existing reflections show possible exposure, not proof they affected a statement.",
        "Deleted reflections and prior prompt context cannot be reconstructed from current citations.",
        "All reading/principle versions remain in review scope until their input lineage is verified.",
        "Browser caches, external logs, and completed job payload retention require separate review.",
        "This inventory authorizes no repair or deletion. Preserve human wording and current sharing choices.",
      ],
    };
  });
}
