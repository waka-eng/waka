/**
 * Drizzle ORM schema — consultations: the read-side record.
 *
 * A consultation is the record that a session was served a profile's
 * derived memory: who read, whose memory, which surface, which version.
 * Until this table existed, `sessions.lastSeenAt` was the entire
 * read-side trace — write-side provenance was unusually rich and the
 * read side was blank, so "what was the agent told?" was archaeology
 * instead of a query.
 *
 * Doctrine (goals/no-quiet-corners.md, Phase 1):
 *
 *   - Consultations are INFRASTRUCTURE beside sessions — never a fifth
 *     layer, never input to generation. Nothing reads this table to
 *     decide what to say; it exists to answer for what was said.
 *   - A receipt proves *consultation*, never obedience.
 *   - The record outlives the credential: a pruned session leaves its
 *     mark with a null session id, and an erased reader becomes
 *     "someone" (set null) while the served profile's record stands.
 *     Erasing the SERVED profile takes its whole record with it — the
 *     read log of a person's memory is part of that person's stack.
 */

import {
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations } from "./schema-inspirations";
import { principles } from "./schema-principles";
import { profiles } from "./schema-profiles";
import { sessions } from "./schema-sessions";

export const consultationSurfaceValues = [
  "signals",
  "top_of_mind",
  "principles",
  /** the weather + antechamber serve: told sentences carry no memory, but
      the antechamber carries refused candidates — derived readings of the
      person, so the serve is on the record like any other */
  "weather",
  /** the whole-stack egress (`GET /api/export`) — the largest serve there
      is, and the owner's own read is still a read on the record */
  "export",
] as const;
export type ConsultationSurface = (typeof consultationSurfaceValues)[number];
export const consultationSurfaceEnum = pgEnum(
  "consultation_surface",
  consultationSurfaceValues,
);

export const consultations = pgTable(
  "consultations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Whose derived memory was served. The record belongs to this stack. */
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    /** The credential that read. Null once the session is pruned — the
        mark outlives the credential. */
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),

    /** The profile the session was acting as — the reader. Null once the
        reader has erased their account: "someone read this", a departed
        mark, never a dangling id. */
    readerProfileId: uuid("reader_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),

    surface: consultationSurfaceEnum("surface").notNull(),

    /** The artifact version served (top of mind). Null on surfaces with
        no version concept, and null when the honest answer was "nothing
        synthesized yet" — that serve is a consultation too. */
    artifactVersion: integer("artifact_version"),

    /** The rendering's day-stamp (principles — the canonical document is
        a daily rendering, not a versioned row). */
    renderedOn: date("rendered_on"),

    servedAt: timestamp("served_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileServedIdx: index("consultations_profile_served_idx").on(
      table.profileId,
      table.servedAt,
    ),
  }),
);

export type Consultation = typeof consultations.$inferSelect;
export type NewConsultation = typeof consultations.$inferInsert;

/**
 * The write-back half: a decision is a capture, not a layer. A
 * `kind=decision` inspiration may cite the principles it consulted, and
 * BOTH foreign keys here are composite through `profile_id` — the citation
 * physically cannot join an inspiration and a principle that belong to
 * different profiles, and cannot name a principle that does not exist.
 * An invented citation is unstorable, which is the entire point: the
 * p-id citations our skills instruct agents to make stop evaporating
 * into their own transcripts.
 */
export const decisionPrincipleCitations = pgTable(
  "decision_principle_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id").notNull(),
    inspirationId: uuid("inspiration_id").notNull(),
    principleId: uuid("principle_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    inspirationFk: foreignKey({
      columns: [table.profileId, table.inspirationId],
      foreignColumns: [inspirations.profileId, inspirations.id],
      name: "decision_citations_inspiration_fk",
    }).onDelete("cascade"),
    principleFk: foreignKey({
      columns: [table.profileId, table.principleId],
      foreignColumns: [principles.profileId, principles.id],
      name: "decision_citations_principle_fk",
    }).onDelete("cascade"),
    // One citation per (decision, principle) — citing twice is not citing
    // harder.
    decisionPrincipleUnique: uniqueIndex("decision_citations_unique_idx").on(
      table.inspirationId,
      table.principleId,
    ),
  }),
);

export type DecisionPrincipleCitation = typeof decisionPrincipleCitations.$inferSelect;
export type NewDecisionPrincipleCitation = typeof decisionPrincipleCitations.$inferInsert;
