/**
 * keeper_keys — the human's own standing credential.
 *
 * Founder ask, 2026-08-29, completing that day's ruling: agents can no
 * longer capture into the human profile, so the person gets a first-class
 * key for their own MCP — keep and recall from a terminal without the
 * browser consent dance, revocable from the account.
 *
 * The mirror of `agent_keys`, deliberately: same one-way secret posture
 * (only the SHA-256 lands; the secret is shown once), same prefix column
 * for telling keys apart, same revocation-as-timestamp so who could act,
 * and when that ended, stays readable. What differs is the binding — a
 * HUMAN profile only — and the power: the session a keeper key resolves to
 * is `keyScoped`, read + capture on its own profile and nothing else (see
 * `lib/keeper-key-auth.ts` for the argument).
 *
 * Its own table rather than rows in `agent_keys`, because a table named
 * for agents quietly holding the human's credential is exactly the
 * one-name-per-concept drift the canon forbids.
 */
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const keeperKeys = pgTable(
  "keeper_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The human profile this key acts as. Cascade: no orphaned credentials. */
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** SHA-256 hex digest of the secret. 64 chars; the secret itself never lands. */
    tokenHash: text("token_hash").notNull(),
    /** The secret's first characters, for telling keys apart in a list. */
    prefix: text("prefix").notNull(),
    /** Optional human label ("laptop mcp", "work machine"). */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("keeper_keys_token_hash_unique_idx").on(table.tokenHash),
    profileIdx: index("keeper_keys_profile_idx").on(table.profileId),
  }),
);

export type KeeperKey = typeof keeperKeys.$inferSelect;
export type NewKeeperKey = typeof keeperKeys.$inferInsert;
