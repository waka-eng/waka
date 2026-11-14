import { sql } from 'drizzle-orm';
import { check, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './schema-accounts.js';

/** Count-only dispatch reservations, never questions, vectors or responses. */
export const accountRecallLimits = pgTable('account_recall_limits', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  minuteStartedAt: timestamp('minute_started_at', { withTimezone: true }).notNull().defaultNow(),
  minuteCount: integer('minute_count').notNull().default(0),
  hourStartedAt: timestamp('hour_started_at', { withTimezone: true }).notNull().defaultNow(),
  hourCount: integer('hour_count').notNull().default(0),
}, t => [check('account_recall_limits_counts', sql`${t.minuteCount} >= 0 AND ${t.hourCount} >= 0`)]);
