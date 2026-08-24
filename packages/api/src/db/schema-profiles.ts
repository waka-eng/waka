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

/**
 * `group` is A ROOM'S MIND (2026-08-24): the profile that owns what a room
 * distils from its pooled ground. It belongs to a room rather than an
 * account — `accountId` null, `groupId` set — and migration 0025's CHECK
 * (`profiles_mind_shape_check`) pins that shape both ways. Every
 * account-scoped query filters on `account_id = $x`, which NULL never
 * satisfies, so a room's mind is invisible to all of them by construction.
 */
export const profileTypeValues = ["human", "agent", "group"] as const;
export type ProfileType = (typeof profileTypeValues)[number];
export const profileTypeEnum = pgEnum("profile_type", profileTypeValues);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Null for exactly one kind of profile: a room's mind (see the enum). */
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),

    type: profileTypeEnum("type").notNull(),

    /**
     * The room this mind belongs to, for `type = 'group'` and only then.
     *
     * The FOREIGN KEY (→ groups, ON DELETE CASCADE: the room takes its mind
     * with it), the one-mind-per-room UNIQUE index, and the shape CHECK all
     * live in migration 0025 rather than here — `schema-groups` already
     * imports this module for `groupMembers.profileId`, and declaring the
     * reference from this side too would make the two modules a cycle.
     */
    groupId: uuid("group_id"),

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
