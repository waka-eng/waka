/**
 * Collaborative shaping of a room's shared direction.
 *
 * Generated readings remain immutable versions in `combination_readings`.
 * These two tables hold the human layer around them: small attributed notes
 * that help WAKA write the next proposal, and one review response per member
 * on that proposal.
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

import { combinationReadings } from "./schema-combinations";
import { groups } from "./schema-groups";
import { users } from "./schema";

export const groupDirectionContributionKinds = [
  "take",
  "feels_true",
  "missing",
  "change",
] as const;
export type GroupDirectionContributionKind =
  (typeof groupDirectionContributionKinds)[number];

export const groupDirectionContributions = pgTable(
  "group_direction_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** The current version the member was responding to. */
    readingId: uuid("reading_id")
      .notNull()
      .references(() => combinationReadings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<GroupDirectionContributionKind>().notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupCreatedIdx: index("group_direction_contributions_group_created_idx").on(
      table.groupId,
      table.createdAt,
    ),
    readingCreatedIdx: index("group_direction_contributions_reading_created_idx").on(
      table.readingId,
      table.createdAt,
    ),
  }),
);

export const groupDirectionResponseValues = ["accept", "keep_current"] as const;
export type GroupDirectionResponseValue =
  (typeof groupDirectionResponseValues)[number];

export const groupDirectionResponses = pgTable(
  "group_direction_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => combinationReadings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: text("value").$type<GroupDirectionResponseValue>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberResponseUnique: uniqueIndex("group_direction_responses_member_unique_idx").on(
      table.readingId,
      table.userId,
    ),
    groupReadingIdx: index("group_direction_responses_group_reading_idx").on(
      table.groupId,
      table.readingId,
    ),
  }),
);

export const groupDirectionContributionsRelations = relations(
  groupDirectionContributions,
  ({ one }) => ({
    group: one(groups, {
      fields: [groupDirectionContributions.groupId],
      references: [groups.id],
    }),
    reading: one(combinationReadings, {
      fields: [groupDirectionContributions.readingId],
      references: [combinationReadings.id],
    }),
    user: one(users, {
      fields: [groupDirectionContributions.userId],
      references: [users.id],
    }),
  }),
);

export const groupDirectionResponsesRelations = relations(
  groupDirectionResponses,
  ({ one }) => ({
    group: one(groups, {
      fields: [groupDirectionResponses.groupId],
      references: [groups.id],
    }),
    reading: one(combinationReadings, {
      fields: [groupDirectionResponses.readingId],
      references: [combinationReadings.id],
    }),
    user: one(users, {
      fields: [groupDirectionResponses.userId],
      references: [users.id],
    }),
  }),
);

export type GroupDirectionContribution =
  typeof groupDirectionContributions.$inferSelect;
export type GroupDirectionResponse = typeof groupDirectionResponses.$inferSelect;
