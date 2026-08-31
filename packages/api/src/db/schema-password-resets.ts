/**
 * password_resets — the way back into your own memory.
 *
 * The one finding that locked a real person out of what they kept: no reset
 * route, no token table, no mail transport (audited 2026-08-31; the goal doc
 * `everything-in-the-world.md` Phase 4 deferred it "pending a mail provider",
 * and the provider is now chosen — SES, the stack's own post office). This
 * table is the token half of that promise.
 *
 * Same one-way secret posture as the key tables: only the SHA-256 of the
 * token lands here — the raw token exists once, inside the letter. A row is
 * spent by `used_at`, not deleted, so who asked for a way back, and whether
 * they took it, stays readable. Expiry is short (the letter names it): a
 * reset link is a bearer credential for the whole memory and must not sit
 * live in an inbox for days.
 */
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./schema-accounts";

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    /** SHA-256 hex of the token in the letter. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** Set when the token opens the door. A spent letter cannot open it twice. */
    usedAt: timestamp("used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("password_resets_token_hash_unique").on(table.tokenHash),
    /** The per-account letter budget reads recent rows by account. */
    accountIdx: index("password_resets_account_idx").on(table.accountId, table.createdAt),
  }),
);
