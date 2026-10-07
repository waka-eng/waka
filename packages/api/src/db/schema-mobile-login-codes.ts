import { pgTable, text, timestamp, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { profiles } from './schema-profiles';

/** A two-minute human-profile handoff; no reusable bearer credential. */
export const mobileLoginCodes = pgTable('mobile_login_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  appId: text('app_id').notNull(),
  stateHash: text('state_hash').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  codeHashUnique: uniqueIndex('mobile_login_codes_code_hash_unique_idx').on(table.codeHash),
  expiresAtIdx: index('mobile_login_codes_expires_at_idx').on(table.expiresAt),
}));
