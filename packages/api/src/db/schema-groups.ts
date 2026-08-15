/**
 * Drizzle ORM schema — groups and their members.
 *
 * A group pools its members' **shared signals** onto a wall and grows one
 * co-edited top of mind from them. Membership is between human profiles;
 * agent profiles do not join walls.
 *
 * What a group can see is bounded by layer: a share exposes a signal's
 * statement, never the inspirations behind it. That boundary is enforced in
 * the read paths, and the schema keeps it honest by never linking a group to
 * an inspiration at all.
 */

import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const groupMemberRoleValues = ["owner", "member"] as const;
export type GroupMemberRole = (typeof groupMemberRoleValues)[number];
export const groupMemberRoleEnum = pgEnum("group_member_role", groupMemberRoleValues);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull(),
    /** Short code a member types to join. Unique while the group lives. */
    joinCode: text("join_code").notNull(),

    createdByProfileId: uuid("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    joinCodeUnique: uniqueIndex("groups_join_code_unique_idx").on(table.joinCode),
  }),
);

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    role: groupMemberRoleEnum("role").notNull().default("member"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupProfileUnique: uniqueIndex("group_members_group_profile_unique_idx").on(
      table.groupId,
      table.profileId,
    ),
    profileIdx: index("group_members_profile_idx").on(table.profileId),
  }),
);

export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;

export const groupsRelations = relations(groups, ({ many }) => ({
  members: many(groupMembers),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, {
    fields: [groupMembers.groupId],
    references: [groups.id],
  }),
  profile: one(profiles, {
    fields: [groupMembers.profileId],
    references: [profiles.id],
  }),
}));
