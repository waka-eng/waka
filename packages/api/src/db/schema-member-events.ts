/**
 * Drizzle ORM schema — group membership events.
 *
 * `group_members` answers "who is in this room right now" and stays the
 * authority for access control. It cannot answer "when did the room become
 * four people" — leaving deletes the row, so a departed member never existed.
 *
 * This table is the memory: an append-only record of joins and departures.
 * It is what makes a join a *hinge* on the room's timeline — the point where
 * the reading turned because a heart arrived — and what lets a room show the
 * era a member who has since left was part of.
 *
 * Founder decision (2026-08-01): departures stay marked. The timeline never
 * lies about what happened; leaving stops future contribution, not past fact.
 */

import { index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./schema";
import { groups } from "./schema-groups";

export const groupMemberEventValues = [
  "joined",
  /** The member chose to go. */
  "left",
  /** The owner removed them. Distinct from `left` because the timeline
   * should not put someone's own words in their mouth. */
  "removed",
] as const;

export type GroupMemberEventType = (typeof groupMemberEventValues)[number];

export const groupMemberEventEnum = pgEnum(
  "group_member_event",
  groupMemberEventValues,
);

export const groupMemberEvents = pgTable(
  "group_member_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: groupMemberEventEnum("event").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The timeline reads a room's events in order.
    groupAtIdx: index("group_member_events_group_at_idx").on(
      table.groupId,
      table.at,
    ),
    // "Was I in this room then?" — and the backfill's idempotency check.
    groupUserIdx: index("group_member_events_group_user_idx").on(
      table.groupId,
      table.userId,
    ),
  }),
);

export type GroupMemberEventRow = typeof groupMemberEvents.$inferSelect;
export type NewGroupMemberEventRow = typeof groupMemberEvents.$inferInsert;
