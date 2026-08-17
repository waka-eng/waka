/**
 * PROVING AN ADDRESS.
 *
 * Password signup asks for an email and believes it. That is what made the
 * Google pre-hijacking possible — an unproven password sitting on somebody
 * else's address until its real owner arrived. This is the other half of that
 * fix: a way for the person who signed up to prove the address is theirs.
 *
 * The token is stored HASHED, for the reason a password is. This table is a
 * set of bearer credentials: whoever holds a row's plaintext can verify that
 * account, so a leaked backup would otherwise be a list of working takeover
 * links. Lookup is by hash, and the plaintext exists only in the email.
 *
 * One live token per account, enforced by a unique index rather than by
 * remembering to delete. Asking for a new link retires the old one, so a stale
 * message in an old inbox stops working the moment a newer one is requested.
 */
import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./schema-accounts";

export const emailVerifications = pgTable("email_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  /** sha-256 of the token that was emailed; the plaintext is never stored */
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** when the last link went out, so resending can be throttled */
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailVerificationsRelations = relations(emailVerifications, ({ one }) => ({
  account: one(accounts, {
    fields: [emailVerifications.accountId],
    references: [accounts.id],
  }),
}));
