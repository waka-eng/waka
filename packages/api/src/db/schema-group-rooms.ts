/**
 * Chat-oriented discussion rooms — RETIRED SURFACE, LIVE TABLES.
 *
 * `routes/group-rooms.ts` served these under `/api/group-rooms`: rooms with
 * participants, generated prompts and reactions. No client ever called it —
 * the product's room is `/api/groups`, whose board and direction are built
 * from pooled signals rather than from a conversation. The route and its tests
 * were deleted rather than left to rot as a second, half-true idea of a room.
 *
 * These table definitions stay ON PURPOSE. Two reasons, and neither is inertia:
 *
 * 1. **Deleting them would generate a migration that drops them.** `drizzle-kit
 *    generate` diffs this schema against the database, so removing these
 *    declarations emits `DROP TABLE` against whatever rows production holds.
 *    An unused table costs nothing; an unrecoverable one costs everything.
 *
 * 2. **`lib/account-erasure.ts` still reads and clears them.** Erasure must
 *    account for every table a user's rows can reach, including retired ones.
 *    A table the erasure path cannot see is a table that outlives the account
 *    it belonged to.
 *
 * So: do not "clean up" this file by deleting it. Dropping these tables is a
 * deliberate data decision that needs its own migration and its own reckoning
 * with the erasure path — not a side effect of tidying dead code.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { signals, users } from "./schema";
import { wowMoments } from "./schema-wow-moments";

export const groupConversationRooms = pgTable(
  "group_conversation_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    feedbackSummary: jsonb("feedback_summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    ownerCreatedIdx: index("group_conversation_rooms_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt.desc(),
    ),
  }),
);

export const groupRoomParticipants = pgTable(
  "group_room_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => groupConversationRooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    invitedEmail: text("invited_email"),
    displayName: text("display_name").notNull().default(""),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("group_room_participants_room_idx").on(table.roomId),
    userIdx: index("group_room_participants_user_idx").on(table.userId),
    roomUserUnique: uniqueIndex("group_room_participants_room_user_unique_idx")
      .on(table.roomId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
  }),
);

export const groupRoomSignals = pgTable(
  "group_room_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => groupConversationRooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    shareRaw: boolean("share_raw").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedIdx: index("group_room_signals_room_created_idx").on(
      table.roomId,
      table.createdAt.desc(),
    ),
    roomSignalUnique: uniqueIndex("group_room_signals_room_signal_unique_idx").on(
      table.roomId,
      table.signalId,
    ),
  }),
);

export const groupRoomPrompts = pgTable(
  "group_room_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => groupConversationRooms.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceTopOfMindNoteId: uuid("source_top_of_mind_note_id").references(
      () => wowMoments.id,
      { onDelete: "set null" },
    ),
    promptText: text("prompt_text").notNull(),
    rationale: text("rationale").notNull().default(""),
    actionLabel: text("action_label").notNull().default("Keep talking"),
    evidencePreviews: jsonb("evidence_previews")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedIdx: index("group_room_prompts_room_created_idx").on(
      table.roomId,
      table.createdAt.desc(),
    ),
  }),
);

export const groupRoomFeedback = pgTable(
  "group_room_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => groupConversationRooms.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id").references(() => groupRoomPrompts.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull().default("useful"),
    note: text("note").notNull().default(""),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedIdx: index("group_room_feedback_room_created_idx").on(
      table.roomId,
      table.createdAt.desc(),
    ),
  }),
);

export type GroupConversationRoom = typeof groupConversationRooms.$inferSelect;
export type NewGroupConversationRoom = typeof groupConversationRooms.$inferInsert;
export type GroupRoomPrompt = typeof groupRoomPrompts.$inferSelect;

export const groupConversationRoomRelations = relations(groupConversationRooms, ({ many, one }) => ({
  owner: one(users, {
    fields: [groupConversationRooms.ownerUserId],
    references: [users.id],
  }),
  participants: many(groupRoomParticipants),
  signals: many(groupRoomSignals),
  prompts: many(groupRoomPrompts),
  feedback: many(groupRoomFeedback),
}));

export const groupRoomParticipantRelations = relations(groupRoomParticipants, ({ one }) => ({
  room: one(groupConversationRooms, {
    fields: [groupRoomParticipants.roomId],
    references: [groupConversationRooms.id],
  }),
  user: one(users, {
    fields: [groupRoomParticipants.userId],
    references: [users.id],
  }),
}));

export const groupRoomSignalRelations = relations(groupRoomSignals, ({ one }) => ({
  room: one(groupConversationRooms, {
    fields: [groupRoomSignals.roomId],
    references: [groupConversationRooms.id],
  }),
  signal: one(signals, {
    fields: [groupRoomSignals.signalId],
    references: [signals.id],
  }),
}));

export const groupRoomPromptRelations = relations(groupRoomPrompts, ({ one, many }) => ({
  room: one(groupConversationRooms, {
    fields: [groupRoomPrompts.roomId],
    references: [groupConversationRooms.id],
  }),
  sourceTopOfMindNote: one(wowMoments, {
    fields: [groupRoomPrompts.sourceTopOfMindNoteId],
    references: [wowMoments.id],
  }),
  feedback: many(groupRoomFeedback),
}));

export const groupRoomFeedbackRelations = relations(groupRoomFeedback, ({ one }) => ({
  room: one(groupConversationRooms, {
    fields: [groupRoomFeedback.roomId],
    references: [groupConversationRooms.id],
  }),
  prompt: one(groupRoomPrompts, {
    fields: [groupRoomFeedback.promptId],
    references: [groupRoomPrompts.id],
  }),
}));
