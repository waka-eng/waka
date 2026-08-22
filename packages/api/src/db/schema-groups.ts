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

    /**
     * WHO MADE IT — a historical credit, NOT an ownership link.
     *
     * This was `notNull` with `onDelete: "cascade"`, which quietly meant that
     * deleting your account deleted every room you had ever created, for
     * everyone still in it: their shares, the join code, and the top of mind
     * the room had built together. It needed no attacker — it is what happens
     * when a person exercises the delete button the product offers them.
     *
     * The rest of the code is written on the opposite assumption. Leaving a
     * room hands the seat on (`promoteSuccessorOwner`), `deleteGroup`'s own
     * comment says "deleting is not a bigger version of leaving", and
     * `eraseAccount` carefully removes only the group artifacts that CITE the
     * departing member's signals — reasoning that is moot for any group the
     * cascade was about to take whole.
     *
     * Ownership lives on the membership row, where it always did. This column
     * now records who started the room and goes null when they go.
     */
    createdByProfileId: uuid("created_by_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),

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

// ---------------------------------------------------------------------------
// group_membership_events — the door's history
// ---------------------------------------------------------------------------

export const groupMembershipEventKindValues = ["joined", "left", "removed"] as const;
export type GroupMembershipEventKind = (typeof groupMembershipEventKindValues)[number];
export const groupMembershipEventKindEnum = pgEnum(
  "group_membership_event_kind",
  groupMembershipEventKindValues,
);

/**
 * Append-only record of every arrival and departure.
 *
 * The membership row is the CURRENT seat and nothing else: it is deleted on
 * leave and on removal, and a re-join writes a fresh row with a fresh
 * `createdAt` — so before this table existed, a room's past was unreadable.
 * Who had been here, when someone was removed, that a member left and came
 * back: each of those was a row that no longer existed. A room that remembers
 * becoming itself needs the door to keep a ledger, not just a lock.
 *
 * Nothing updates or deletes these rows in application code. The two deletes
 * that reach them are cascades, and both are deliberate: the group's owner
 * taking the whole room down (`deleteGroup` — the room's history belongs to
 * the room), and a profile's erasure (an event naming a person is a trace of
 * that person, and erasure means their traces go).
 */
export const groupMembershipEvents = pgTable(
  "group_membership_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    kind: groupMembershipEventKindEnum("kind").notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupOccurredIdx: index("group_membership_events_group_occurred_idx").on(
      table.groupId,
      table.occurredAt,
    ),
  }),
);

export type GroupMembershipEvent = typeof groupMembershipEvents.$inferSelect;
export type NewGroupMembershipEvent = typeof groupMembershipEvents.$inferInsert;

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
