/** Operational claim history, not memory. Reusing/deleting a source job must
 * not erase model-budget accounting. No text, payload or credentials live here. */
import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './schema-accounts';

export const backgroundJobRuns = pgTable('background_job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  // Intentionally no job/profile FK: cancelling work must not refund paid starts.
  jobId: uuid('job_id').notNull(),
  requestVersion: bigint('request_version', { mode: 'bigint' }).notNull().default(sql`1`),
  attempt: integer('attempt').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
}, table => ({
  accountWindow: index('background_job_runs_account_window').on(table.accountId, table.startedAt),
  claim: index('background_job_runs_claim').on(table.jobId, table.startedAt),
  expiry: index('background_job_runs_expiry').on(table.startedAt),
}));
