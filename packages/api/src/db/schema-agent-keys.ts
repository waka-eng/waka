/**
 * agent_keys — a standing credential for an agent profile.
 *
 * Meeting decision, 2026-08-17: "에이전트별 이름 및 API 키 발급" — each agent
 * gets its own name and its own key, so permission separation is between
 * PROFILES rather than between one human credential shared around. The name
 * already lives on the agent's profile row; this table is the key.
 *
 * Why sessions were not enough. A session is a login artifact: it expires, it
 * is minted by a browser consent flow, and a headless agent — the marketing
 * agent running on a schedule — has neither a browser nor a person watching
 * it log in. A key is issued ONCE by the human hand, lives until revoked, and
 * binds to exactly one agent profile, so the access matrix applies to the
 * agent as itself rather than as whoever logged in last.
 *
 * The secret is shown once at issue time and never stored: only its SHA-256
 * lands here, the same posture the sessions table takes, so a leaked database
 * leaks no credentials. `prefix` keeps the first characters so a person can
 * tell their keys apart in a list without the list being worth stealing.
 *
 * Revocation is a timestamp, not a delete — who could act, and when that
 * ended, is history the account owner may need to read back.
 */
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const agentKeys = pgTable(
  "agent_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The agent profile this key acts as. Cascade: no orphaned credentials. */
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** SHA-256 hex digest of the secret. 64 chars; the secret itself never lands. */
    tokenHash: text("token_hash").notNull(),
    /** The secret's first characters, for telling keys apart in a list. */
    prefix: text("prefix").notNull(),
    /** Optional human label ("laptop", "marketing cron"). */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("agent_keys_token_hash_unique_idx").on(table.tokenHash),
    profileIdx: index("agent_keys_profile_idx").on(table.profileId),
  }),
);

export type AgentKey = typeof agentKeys.$inferSelect;
export type NewAgentKey = typeof agentKeys.$inferInsert;
