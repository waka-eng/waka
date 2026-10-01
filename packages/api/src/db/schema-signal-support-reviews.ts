import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { inspirations } from "./schema-inspirations.js";
import { signals } from "./schema-signals.js";
import type { InspirationMaterialIdentity } from "../lib/inspiration-material.js";

/** Applied decisions, not copies of withdrawn evidence. The two tenant-bearing
 * FKs bind both ends even when a room reviews a member's public inspiration. */
export const signalSupportReviews = pgTable("signal_support_reviews", {
  reviewId: uuid("review_id").notNull(),
  signalId: uuid("signal_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  ownerProfileId: uuid("owner_profile_id").notNull(),
  inspirationId: uuid("inspiration_id").notNull(),
  reviewHash: text("review_hash").notNull(),
  statementHash: text("statement_hash").notNull(),
  material: jsonb("material").$type<InspirationMaterialIdentity>().notNull(),
  verdict: text("verdict").$type<"supported" | "unsupported" | "unresolved">().notNull(),
  issue: text("issue"),
  sourceIds: uuid("source_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.reviewId, table.signalId] }),
  sourceIdx: index("signal_support_reviews_source_idx").on(table.profileId, table.inspirationId, table.signalId, table.createdAt.desc()),
  verdictCheck: check("signal_support_reviews_verdict_check", sql`${table.verdict} IN ('supported', 'unsupported', 'unresolved')`),
  signalFk: foreignKey({ columns: [table.profileId, table.signalId], foreignColumns: [signals.profileId, signals.id], name: "signal_support_reviews_signal_fk" }).onDelete("cascade"),
  sourceFk: foreignKey({ columns: [table.ownerProfileId, table.inspirationId], foreignColumns: [inspirations.profileId, inspirations.id], name: "signal_support_reviews_source_fk" }).onDelete("cascade"),
}));
