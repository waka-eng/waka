/**
 * Drizzle ORM schema — sessions table.
 *
 * Server-side session records. Each row represents one issued login session
 * for one user. The accompanying browser cookie carries an opaque random
 * token; only the SHA-256 hash of that token is persisted here, so a leaked
 * database dump cannot be replayed as live sessions.
 *
 * Why a sessions table when we already mint a JWT?
 *   - Revocation. JWTs are stateless and cannot be invalidated before their
 *     `exp` claim without a deny-list. A sessions row is the deny-list:
 *     deleting it (or marking it expired) immediately ends the session on
 *     the next request.
 *   - Per-device visibility. Listing/expiring sessions per user becomes a
 *     simple SELECT once the rows exist.
 *   - OpenAuth migration path. SST OpenAuth, which we plan to swap in, also
 *     stores server-side sessions; aligning the schema now means the
 *     swap-in does not require a data migration.
 *
 * Columns:
 *   - id             : opaque session row id (uuid).
 *   - userId         : FK to users.id; ON DELETE CASCADE so deleting a user
 *                      automatically wipes their sessions.
 *   - tokenHash      : SHA-256 hex digest of the cookie token. The plaintext
 *                      token is never stored. Unique so a hash collision
 *                      (astronomically unlikely) cannot map to two users.
 *   - expiresAt      : hard expiry. The auth middleware rejects rows with
 *                      expires_at <= now() even if they still exist.
 *   - createdAt      : when the session was issued (audit / "active devices").
 *   - lastSeenAt     : updated on each authenticated request so we can show
 *                      "last active" in the future Sessions UI. Defaults to
 *                      createdAt at insert time.
 *
 * Indexes:
 *   - tokenHashUnique  : the hot path on every authenticated request is
 *                        `WHERE token_hash = $1` — must be unique + indexed.
 *   - userIdx          : list a user's sessions (logout-everywhere, devices UI).
 *   - expiresAtIdx     : a periodic vacuum job will DELETE WHERE expires_at < now().
 */

import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./schema";

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // SHA-256 hex digest of the opaque cookie token. 64 hex chars — stored as
    // text so we don't have to deal with bytea encoding on the way in/out.
    tokenHash: text("token_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Lookup-by-token is the hottest read path in the entire API; uniqueness
    // also doubles as a safety net against the (essentially impossible) hash
    // collision case.
    tokenHashUnique: uniqueIndex("sessions_token_hash_unique_idx").on(
      table.tokenHash,
    ),
    // List sessions for a user (devices UI, "log out everywhere").
    userIdx: index("sessions_user_idx").on(table.userId),
    // Background sweep: DELETE FROM sessions WHERE expires_at < now().
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));
