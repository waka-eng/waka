/**
 * Durable Postgres-backed background jobs.
 *
 * The API inserts a row here after the user-facing row is durable. A lightweight
 * in-process tick drains runnable rows immediately, and future cron/processes
 * can call the same worker entry point. Postgres is the durable queue so local
 * and production deployments do not require a separate message broker for
 * classifier/WOW processing.
 */

import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./schema";

export const backgroundJobStatusValues = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export type BackgroundJobStatus = (typeof backgroundJobStatusValues)[number];
export const backgroundJobStatusEnum = pgEnum(
  "background_job_status",
  backgroundJobStatusValues,
);

export const backgroundJobTypeValues = ["process_inspiration"] as const;
export type BackgroundJobType = (typeof backgroundJobTypeValues)[number];
export const backgroundJobTypeEnum = pgEnum(
  "background_job_type",
  backgroundJobTypeValues,
);

export interface ProcessInspirationPayload {
  inspirationId: string;
}

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: backgroundJobTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<ProcessInspirationPayload>().notNull(),
    status: backgroundJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runnableIdx: index("background_jobs_runnable_idx")
      .on(table.runAfter, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    userStatusIdx: index("background_jobs_user_status_idx").on(
      table.userId,
      table.status,
    ),
    idempotencyUnique: uniqueIndex("background_jobs_idempotency_key_unique_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  }),
);

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;

export const backgroundJobsRelations = relations(backgroundJobs, ({ one }) => ({
  user: one(users, {
    fields: [backgroundJobs.userId],
    references: [users.id],
  }),
}));
