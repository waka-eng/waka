/**
 * Drizzle ORM schema — profiles.
 *
 * A profile is the unit that owns memory. Every profile — human or agent —
 * owns a full three-layer stack: inspirations → signals → one top of mind.
 *
 * Each account has exactly one human profile (its owner's own memory) and
 * any number of agent profiles (an agent's own working memory). The schema
 * supports N agent profiles; the product currently offers one.
 *
 * Agent separation is structural, not a filter: an agent's observations
 * live in the agent profile's own stack rather than as a lens over the
 * human's. See docs/data-model.md.
 */

import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./schema-accounts";

export const profileTypeValues = ["human", "agent"] as const;
export type ProfileType = (typeof profileTypeValues)[number];
export const profileTypeEnum = pgEnum("profile_type", profileTypeValues);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    type: profileTypeEnum("type").notNull(),

    /** Display name. For agents, what the agent calls itself. */
    name: text("name").notNull().default(""),
    avatarUrl: text("avatar_url"),
    /** Generation is locale-aware, and generation is per-profile. */
    preferredLocale: text("preferred_locale").notNull().default("en-US"),

    /** Public surface — a public page is a profile's surface, not an account's. */
    publicHandle: text("public_handle"),
    publicProfileEnabled: boolean("public_profile_enabled").notNull().default(false),
    publicTopOfMindEnabled: boolean("public_top_of_mind_enabled").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountIdx: index("profiles_account_idx").on(table.accountId),
    publicHandleUnique: uniqueIndex("profiles_public_handle_unique_idx").on(table.publicHandle),
    /**
     * Exactly one human profile per account, enforced by the database rather
     * than by convention: a partial unique index over account_id restricted
     * to human rows. Agent rows are unconstrained.
     */
    oneHumanPerAccount: uniqueIndex("profiles_one_human_per_account_idx")
      .on(table.accountId)
      .where(sql`${table.type} = 'human'`),
  }),
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export const profilesRelations = relations(profiles, ({ one }) => ({
  account: one(accounts, {
    fields: [profiles.accountId],
    references: [accounts.id],
  }),
}));
