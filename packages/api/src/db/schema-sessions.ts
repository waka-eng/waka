/**
 * Drizzle ORM schema — sessions.
 *
 * One row per issued login session. The cookie (or bearer token) carries an
 * opaque token; only its SHA-256 hash is persisted, so a leaked database
 * dump cannot be replayed as live sessions. The row is also the deny-list
 * that makes a stateless JWT revocable: delete it and the session ends on
 * the next request.
 *
 * **A session acts as exactly one profile.** The browser session acts as the
 * human profile; a CLI/MCP session binds to whichever profile was chosen at
 * the loopback login's consent step. Authorization reads that binding: an
 * agent-bound session has full access to its own profile, read-and-capture
 * on the account's human profile, and nothing anywhere else.
 *
 * That binding replaces the old `client: "web" | "cli"` flag — knowing which
 * profile a session acts as subsumes knowing what kind of client it is, and
 * it is the fact authorization actually needs.
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    /** SHA-256 hex digest of the opaque token. 64 hex chars. */
    tokenHash: text("token_hash").notNull(),

    /**
     * Human-readable device label captured at login ("MacBook Pro",
     * "claude-code"), so a connected-devices view can show something more
     * useful than a uuid.
     */
    deviceLabel: text("device_label"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last explicit profile check made through the MCP verification tool. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => ({
    // The hottest read path in the API; uniqueness also guards the
    // (essentially impossible) hash collision.
    tokenHashUnique: uniqueIndex("sessions_token_hash_unique_idx").on(table.tokenHash),
    profileIdx: index("sessions_profile_idx").on(table.profileId),
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export const sessionsRelations = relations(sessions, ({ one }) => ({
  profile: one(profiles, {
    fields: [sessions.profileId],
    references: [profiles.id],
  }),
}));
