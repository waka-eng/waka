/**
 * Drizzle ORM schema — cli_login_codes table.
 *
 * One-time exchange codes for the CLI/MCP loopback login flow
 * (`GET /api/auth/cli/start` -> `POST /api/auth/cli/exchange`). A code is
 * minted while the user already has a live browser `waka_session` cookie,
 * handed to a `http://127.0.0.1:*` redirect, and immediately exchanged
 * server-to-server for a brand-new session JWT.
 *
 * Why a separate table instead of reusing `sessions`?
 *   - A code carries only `userId` — no session JWT is minted (and no
 *     `sessions` row created) until the exchange call succeeds. This keeps
 *     the 30-day session token out of the browser URL / history entirely;
 *     only a short-lived, single-use code ever appears there.
 *   - The row is deleted the moment it is exchanged (or once expired), so
 *     this table stays tiny and never needs a "revoke" concept of its own.
 *
 * Columns:
 *   - id         : opaque row id (uuid).
 *   - codeHash   : SHA-256 hex digest of the opaque code (same hashing
 *                  helper as `sessions.tokenHash`, `hashSessionToken`). The
 *                  plaintext code is never stored.
 *   - userId     : FK to users.id; ON DELETE CASCADE so a deleted user's
 *                  in-flight login attempts vanish with them.
 *   - expiresAt  : hard expiry, short-lived (minutes, not days) — this is a
 *                  same-machine redirect round-trip, not a user-facing wait.
 *   - createdAt  : audit timestamp.
 *
 * Indexes:
 *   - codeHashUnique : the exchange endpoint's hot path is
 *                      `WHERE code_hash = $1` — must be unique + indexed.
 *   - expiresAtIdx   : background sweep, mirrors `sessions_expires_at_idx`.
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
// cli_login_codes
// ---------------------------------------------------------------------------

export const cliLoginCodes = pgTable(
  "cli_login_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // SHA-256 hex digest of the opaque exchange code. 64 hex chars.
    codeHash: text("code_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeHashUnique: uniqueIndex("cli_login_codes_code_hash_unique_idx").on(
      table.codeHash,
    ),
    expiresAtIdx: index("cli_login_codes_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

export type CliLoginCode = typeof cliLoginCodes.$inferSelect;
export type NewCliLoginCode = typeof cliLoginCodes.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const cliLoginCodesRelations = relations(cliLoginCodes, ({ one }) => ({
  user: one(users, {
    fields: [cliLoginCodes.userId],
    references: [users.id],
  }),
}));
