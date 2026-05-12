/**
 * Drizzle ORM schema — WAKA Inspirations
 *
 * Tables defined here:
 *   - users         : authenticated accounts (email+password and/or Google OAuth)
 *   - inspirations  : per-user captured inspirations with async cluster classification
 *
 * Tables defined in sibling modules (kept out of this file to keep AC scopes
 * small and reviewable):
 *   - attachments   : ./schema-attachments.ts (Sub-AC 1.x)
 *   - reflections   : ./schema-reflections.ts (Sub-AC 1.x)
 *
 * Conventions:
 *   - All primary keys are UUIDs generated server-side (defaultRandom()).
 *   - All timestamps are stored with timezone (timestamp with time zone) and
 *     default to NOW() at insert time. updated_at is bumped in application code
 *     (Drizzle does not auto-update on UPDATE).
 *   - cluster is a Postgres enum so the database itself enforces the allowed
 *     classification labels declared in the ontology (ClusterEnum).
 */

import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Allowed cluster classification labels.
 *
 * Ordering here is the canonical order written into Postgres; do NOT reorder
 * existing values once a migration has been applied (Postgres enum order is
 * part of the type identity).
 */
export const clusterEnumValues = [
  "outlier",
  "bridge",
  "morph",
  "convergence",
  "tension",
  "loop",
] as const;

export type Cluster = (typeof clusterEnumValues)[number];

export const clusterEnum = pgEnum("cluster", clusterEnumValues);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

/**
 * A user account. May be created via:
 *   - email + password   → password_hash set, google_sub null
 *   - Google OAuth       → google_sub set, password_hash may be null
 *   - both linked        → both set (e.g. user signed up with email then linked Google)
 *
 * email is always required and globally unique.
 *
 * google_sub stores the Google OpenID "sub" claim — the immutable, opaque
 * subject identifier returned by Google. We use the OIDC term ("sub") rather
 * than "id" because Google's own docs are explicit that the email or numeric
 * id may change but the sub never does, and it's the only thing safe to use
 * as a long-lived primary key.
 *
 * avatar_url is captured at OAuth callback time so the UI can render a user
 * avatar without re-hitting Google. It's nullable for email/password accounts
 * that have not linked an avatar.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    email: text("email").notNull(),
    // bcrypt/argon2 hash. Nullable so OAuth-only accounts are valid.
    passwordHash: text("password_hash"),
    // Google OIDC "sub" claim. Nullable so email/password accounts are valid.
    googleSub: text("google_sub"),

    name: text("name").notNull().default(""),
    // URL of the user's avatar image (e.g. Google profile picture).
    // Nullable: email/password signups won't have one until they link OAuth.
    avatarUrl: text("avatar_url"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Lookup by email (login) must be unique and indexed.
    emailUnique: uniqueIndex("users_email_unique_idx").on(table.email),
    // Lookup by Google subject during OAuth callback. Sparse-style: many rows
    // may be NULL, but when present the value must be unique. Postgres allows
    // multiple NULLs in a UNIQUE index by default, which is what we want.
    googleSubUnique: uniqueIndex("users_google_sub_unique_idx").on(
      table.googleSub,
    ),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// inspirations
// ---------------------------------------------------------------------------

/**
 * A single inspiration captured by a user.
 *
 * cluster + classified_at are populated asynchronously by the SST Queue
 * classifier worker. Both stay NULL until classification succeeds. If Gemini
 * returns nothing or an invalid label, cluster remains NULL and the UI
 * degrades gracefully (per AC).
 *
 * kind and category are free-form metadata carried over from the original
 * single-file UI (e.g. "note", "link", "image"; numeric category bucket).
 */
export const inspirations = pgTable(
  "inspirations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    text: text("text").notNull(),

    kind: text("kind"),
    category: integer("category"),
    /**
     * Persistent signal snapshots used by the WOW-moment pipeline. Later
     * workers update these only when constituent signals change; list/create
     * paths do not calculate them synchronously.
     */
    importanceScore: integer("importance_score").notNull().default(0),
    wowScore: integer("wow_score").notNull().default(0),

    cluster: clusterEnum("cluster"),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // The list view filters by user_id and orders by created_at DESC; a
    // composite index supports both in one B-tree walk.
    userCreatedIdx: index("inspirations_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    // Backfill / re-classify jobs scan rows where cluster IS NULL.
    clusterNullIdx: index("inspirations_cluster_null_idx")
      .on(table.id)
      .where(sql`${table.cluster} IS NULL`),
  }),
);

export type Inspiration = typeof inspirations.$inferSelect;
export type NewInspiration = typeof inspirations.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  inspirations: many(inspirations),
}));

export const inspirationsRelations = relations(inspirations, ({ one }) => ({
  user: one(users, {
    fields: [inspirations.userId],
    references: [users.id],
  }),
}));
