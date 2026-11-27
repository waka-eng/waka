import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { profiles } from './schema-profiles';

export const hunchStatusValues = ['pending', 'affirmed', 'declined', 'replaced'] as const;
export type HunchStatus = (typeof hunchStatusValues)[number];

/**
 * A HUNCH: ONE TENTATIVE LINE FROM THE FIRST SAVES (insight goal, phase 3,
 * 2026-11-26). Before a reading can be published (it needs two distinct
 * saves and the reviewer), the creature guesses out loud from what is there
 * and asks "Am I close?". Kept apart from the reading so the reading's own
 * rules stay whole. A row is pending until answered: affirmed (Yes),
 * declined with the person's correction (Not quite), or replaced by a newer
 * hunch. Rows citing a save are deleted when that save is deleted or its
 * words change (migration trigger), since a hunch quotes what it cites.
 */
export const hunches = pgTable('hunches', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  inspirationIds: uuid('inspiration_ids').array().notNull(),
  status: text('status').$type<HunchStatus>().notNull().default('pending'),
  /** What the person said instead, on Not quite. */
  correction: text('correction'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  profileCreatedIdx: index('hunches_profile_created_idx').on(table.profileId, table.createdAt.desc()),
}));
