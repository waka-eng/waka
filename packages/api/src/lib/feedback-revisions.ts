/** A verdict never moves to different words merely because the ID is stable.
 * This predicate binds wording only; each context still applies its own
 * ownership, membership and support rules before limits. */
import { sql } from 'drizzle-orm';

export function feedbackWordingCurrent(feedbackName = 'feedback') {
  const column = (name: string) => sql`${sql.identifier(feedbackName)}.${sql.identifier(name)}`;
  return sql`(
    (${column('target_type')}::text = 'signal' AND EXISTS (SELECT 1 FROM signals fw
      WHERE fw.id = ${column('target_id')} AND fw.statement_revision = coalesce(${column('target_revision')}, 1)))
    OR (${column('target_type')}::text = 'top_of_mind_entry' AND EXISTS (SELECT 1 FROM top_of_mind_entries fw
      WHERE fw.id = ${column('target_id')} AND fw.body_revision = coalesce(${column('target_revision')}, 1)))
    OR (${column('target_type')}::text = 'principle' AND EXISTS (SELECT 1 FROM principles fw
      WHERE fw.id = ${column('target_id')} AND fw.statement_revision = coalesce(${column('target_revision')}, 1)))
  )`;
}
