/**
 * WHAT A WRONG PASSWORD COSTS THE NEXT ATTEMPT.
 *
 * Password login had no memory of failure at all: no counter, no cooldown,
 * nothing written down. A guess cost an attacker one request, and `/signup`
 * answers 409 for an address that already exists, so they could confirm a
 * target and then guess it forever. This table is the memory that stops that
 * — see `lib/login-throttle.ts`, which owns every rule about reading it.
 *
 * ONE ROW PER BUCKET, NOT ONE ROW PER ATTEMPT.
 *
 * A row per attempt would be an audit log, and an audit log of failed logins
 * is a table an unauthenticated stranger can grow without limit. This is a
 * counter instead: `failures` inside the window that opened at
 * `window_started_at`, upserted in place. The row count is bounded by the
 * number of distinct things tried rather than by how hard they were tried.
 *
 * THE KEY IS AN HMAC, NOT THE THING ITSELF.
 *
 * The buckets are keyed on an email address someone typed and on a network
 * address they connected from. Stored plainly, a leaked backup would be a log
 * of who tried to sign in to what, from where — for addresses that may not
 * even have accounts here. A plain sha-256 would not help: both inputs are
 * low-entropy enough to enumerate offline. So the key is HMAC-SHA-256 under
 * the app secret, which makes the table useless to anyone who has the rows
 * but not the secret, and still lets us look a bucket up in one query.
 *
 * `scope` is not part of the key — the scope name is already inside the HMAC
 * input, so two scopes cannot collide. It is a column so that an operator
 * reading this table can tell an address bucket from a source bucket without
 * being able to reverse either.
 *
 * NO FOREIGN KEY TO `accounts`, DELIBERATELY. Most rows here are for addresses
 * that have no account: that is the whole point of counting them, because a
 * bucket that only exists for real accounts would answer "does this address
 * exist?" by its presence.
 */

import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const loginFailures = pgTable(
  "login_failures",
  {
    /** HMAC-SHA-256 of `<scope>:<value>` under the app secret */
    keyHash: text("key_hash").primaryKey(),

    /** "identifier" | "source" | "device" — for the operator, not the lookup */
    scope: text("scope").notNull(),

    /** failures counted since `window_started_at` */
    failures: integer("failures").notNull().default(0),

    /** when the current window opened; a window that has run out resets to 1 */
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /* Rows go stale the moment their window closes and are reaped in bulk;
       without this index that sweep is a full scan of a table whose size an
       attacker gets a say in. */
    windowStartedAtIdx: index("login_failures_window_started_at_idx").on(
      table.windowStartedAt,
    ),
  }),
);

export type LoginFailure = typeof loginFailures.$inferSelect;
export type NewLoginFailure = typeof loginFailures.$inferInsert;
