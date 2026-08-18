/**
 * Drizzle ORM schema — accounts.
 *
 * An account is the auth identity: one login (email+password and/or Google
 * OAuth), one person. It owns no memory of its own — every inspiration,
 * signal, and top of mind hangs off a *profile* (./schema-profiles.ts).
 *
 * That split is the point of the three-layer model: a person and the agents
 * working alongside them share one login but keep separate memories, so
 * "who can sign in" and "whose memory is this" stop being the same question.
 *
 * Display identity (name, avatar, locale, public handle) lives on the
 * profile, not here — a public profile page is a profile's surface, and an
 * agent profile has its own name.
 *
 * Conventions (repo-wide):
 *   - UUID primary keys generated server-side (defaultRandom()).
 *   - timestamptz everywhere, defaulting to NOW() at insert; updated_at is
 *     bumped in application code (Drizzle does not auto-update on UPDATE).
 */

import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    email: text("email").notNull(),
    /** bcrypt hash. Nullable so OAuth-only accounts are valid. */
    passwordHash: text("password_hash"),
    /**
     * Google OIDC "sub" claim — the immutable subject identifier. Google's
     * docs are explicit that email and numeric id may change but sub never
     * does, so it is the only safe long-lived key. Nullable for
     * email/password accounts.
     */
    googleSub: text("google_sub"),

    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex("accounts_email_unique_idx").on(table.email),
    // Sparse-style: many rows may be NULL, but a present value must be
    // unique. Postgres allows multiple NULLs in a UNIQUE index, which is
    // exactly what email/password accounts need.
    googleSubUnique: uniqueIndex("accounts_google_sub_unique_idx").on(table.googleSub),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export const accountsRelations = relations(accounts, ({ many }) => ({
  profiles: many(profiles),
}));
