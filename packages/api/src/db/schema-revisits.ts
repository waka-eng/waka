/**
 * Drizzle ORM schema — inspiration revisit events.
 *
 * Revisit events are lightweight, append-only user interactions that indicate a
 * caller intentionally returned to a saved inspiration. They are deliberately
 * separate from list reads so ordinary history rendering does not inflate WOW
 * scoring signals.
 */

import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { inspirations, users } from "./schema";

export const inspirationRevisitEventTypeValues = [
  "detail_opened",
  "detail_returned",
  "reflection_created",
  "inspiration_updated",
] as const;

export type InspirationRevisitEventType =
  (typeof inspirationRevisitEventTypeValues)[number];

export const inspirationRevisitEventTypeEnum = pgEnum(
  "inspiration_revisit_event_type",
  inspirationRevisitEventTypeValues,
);

export const inspirationRevisitEvents = pgTable(
  "inspiration_revisit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    inspirationId: uuid("inspiration_id")
      .notNull()
      .references(() => inspirations.id, { onDelete: "cascade" }),

    eventType: inspirationRevisitEventTypeEnum("event_type").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    inspirationCreatedIdx: index(
      "inspiration_revisit_events_inspiration_created_idx",
    ).on(table.userId, table.inspirationId, table.createdAt.desc()),
    userCreatedIdx: index("inspiration_revisit_events_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  }),
);

export type InspirationRevisitEvent = typeof inspirationRevisitEvents.$inferSelect;
export type NewInspirationRevisitEvent = typeof inspirationRevisitEvents.$inferInsert;

export const inspirationRevisitEventsRelations = relations(
  inspirationRevisitEvents,
  ({ one }) => ({
    inspiration: one(inspirations, {
      fields: [inspirationRevisitEvents.inspirationId],
      references: [inspirations.id],
    }),
    user: one(users, {
      fields: [inspirationRevisitEvents.userId],
      references: [users.id],
    }),
  }),
);
