/**
 * Drizzle ORM schema — CLI login codes.
 *
 * The short-lived, single-use codes the loopback login flow exchanges for a
 * session (see routes/auth-cli.ts). Only the SHA-256 hash is stored, and the
 * row is deleted on lookup regardless of outcome, so a code is single-use
 * whether it turns out to be valid, expired, or already spent.
 *
 * The code carries the **profile the user picked at the consent step**: the
 * session it mints binds to that profile, so an agent logging in for its own
 * memory and a human logging in for theirs are different credentials from
 * the moment of consent onward.
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const cliLoginCodes = pgTable(
  "cli_login_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    codeHash: text("code_hash").notNull(),

    /** Device label the CLI supplied, carried onto the minted session. */
    deviceLabel: text("device_label"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeHashUnique: uniqueIndex("cli_login_codes_code_hash_unique_idx").on(table.codeHash),
    expiresAtIdx: index("cli_login_codes_expires_at_idx").on(table.expiresAt),
  }),
);

export type CliLoginCode = typeof cliLoginCodes.$inferSelect;
export type NewCliLoginCode = typeof cliLoginCodes.$inferInsert;

export const cliLoginCodesRelations = relations(cliLoginCodes, ({ one }) => ({
  profile: one(profiles, {
    fields: [cliLoginCodes.profileId],
    references: [profiles.id],
  }),
}));
