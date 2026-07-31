/**
 * Drizzle ORM schema — inspiration revisit events.
 *
 * Revisit events are lightweight, append-only user interactions that indicate a
 * caller intentionally returned to a saved inspiration. They are deliberately
 * separate from list reads so ordinary history rendering does not inflate WOW
 * scoring signals.
 */

import { relations } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { inspirations, signals, users } from "./schema";

export const inspirationRevisitEventTypeValues = [
  "detail_opened",
  "detail_returned",
  "reflection_created",
  "inspiration_updated",
  /**
   * The save itself, carrying how long the composer was open before it
   * (`elapsedMs`). This is the pulse-speed proxy: a fast save is a reaction,
   * a slow one is a composition. Unlike every other value here it is written
   * server-side at capture and never accepted from the revisits route — the
   * signal cannot be "revisited" at the moment it is created.
   */
  "capture_saved",
] as const;

export type InspirationRevisitEventType =
  (typeof inspirationRevisitEventTypeValues)[number];

export const inspirationRevisitEventTypeEnum = pgEnum(
  "signal_revisit_event_type",
  inspirationRevisitEventTypeValues,
);

/**
 * Event types that count as *returning* to a signal.
 *
 * Scoring reads this table to measure revisit behaviour, and `capture_saved`
 * is the one member that is not a return at all — it is the save itself.
 * Counting it would credit every freshly captured signal with a revisit it
 * never had, inflating importance and wow scores at creation. Anything added
 * to the enum in future is a revisit unless it is deliberately excluded here.
 */
export const revisitCountingEventTypes = inspirationRevisitEventTypeValues.filter(
  (value) => value !== "capture_saved",
);

export const signalRevisitEvents = pgTable(
  "signal_revisit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    inspirationId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),

    eventType: inspirationRevisitEventTypeEnum("event_type").notNull(),

    /**
     * Composer-open -> save duration, in milliseconds. Only ever set for
     * `capture_saved`; NULL everywhere else. Client-reported and therefore
     * advisory — treat it as a weak ordering signal, not a measurement.
     */
    elapsedMs: integer("elapsed_ms"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    inspirationCreatedIdx: index(
      "signal_revisit_events_signal_created_idx",
    ).on(table.userId, table.inspirationId, table.createdAt.desc()),
    userCreatedIdx: index("signal_revisit_events_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  }),
);

export const inspirationRevisitEvents = signalRevisitEvents;

export type SignalRevisitEvent = typeof signalRevisitEvents.$inferSelect;
export type NewSignalRevisitEvent = typeof signalRevisitEvents.$inferInsert;
export type InspirationRevisitEvent = SignalRevisitEvent;
export type NewInspirationRevisitEvent = NewSignalRevisitEvent;

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
