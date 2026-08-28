/**
 * experiences — the named ground a run of memories was gathered on.
 *
 * Meeting decision, 2026-08-17: the unit of an agent's memory structure is an
 * EXPERIENCE, deliberately not a "project" — "프로젝트를 하지 말자,
 * 엑스피리언스로 하자". A project is a rule scope; an experience is a stretch
 * of lived work ("the NixOS PR", "the Seoul week") that memories were kept
 * DURING, and the graph the meeting sketched hangs off it: a principle stands
 * over signals, signals stand over the experiences whose memories evidence
 * them, and the raw captures sit beneath.
 *
 * An experience BELONGS TO ONE PROFILE — it scopes recall, it never crosses
 * accounts — and an inspiration may name at most one. Signals are deliberately
 * NOT keyed to experiences: a signal's relation to an experience is a fact of
 * its evidence (which memories stand under it, and where they were kept), so
 * it is derived by joining through `signal_evidence` rather than stored twice
 * and allowed to drift.
 *
 * `(profile_id, name)` is unique so capture can find-or-create by name — the
 * way an agent actually says it: "this was during the NixOS PR" — and
 * `(profile_id, id)` is the composite target that lets `inspirations` point
 * here without ever pointing across a tenancy line.
 */
import { pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileNameUnique: uniqueIndex("experiences_profile_name_unique_idx").on(
      table.profileId,
      table.name,
    ),
    /** Composite-FK target: an inspiration names an experience of its own profile only. */
    profileIdIdUnique: unique("experiences_profile_id_id_unique").on(table.profileId, table.id),
  }),
);

export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
