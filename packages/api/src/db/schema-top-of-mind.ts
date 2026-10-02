/**
 * Drizzle ORM schema — top of mind (layer 3): the artifact, its entries, and
 * their citations.
 *
 * A top of mind is the single synthesized artifact answering "what currently
 * matters, is believed, and is in question". There is exactly one live
 * artifact per profile and exactly one per group — enforced below by partial
 * unique indexes, not by convention.
 *
 * Regeneration never mutates: it writes a new version and points the old one
 * at it (`replaced_by_id`), so the history is a chain rather than a series of
 * overwrites. Every refresh records a decision, including "no change" — a
 * silent empty pass is indistinguishable from a broken generator, which is
 * how the previous system hid its failures.
 *
 * Entry state (locked / pinned / dismissed) lives on the entry as columns,
 * not as feedback rows: they are properties of the thing, and the generator
 * has to read them on every pass.
 */

import { relations, sql } from "drizzle-orm";
import {
  check,
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { groups } from "./schema-groups";
import { profiles } from "./schema-profiles";
import { signals } from "./schema-signals";

export const topOfMindStatusValues = ["live", "superseded"] as const;
export type TopOfMindStatus = (typeof topOfMindStatusValues)[number];
export const topOfMindStatusEnum = pgEnum("top_of_mind_status", topOfMindStatusValues);

/** Why this version exists — including the honest "nothing changed". */
export const topOfMindRevisionReasonValues = [
  "initial",
  "regenerated",
  "no_change",
  "member_proposal",
  "human_edit",
] as const;
export type TopOfMindRevisionReason = (typeof topOfMindRevisionReasonValues)[number];
export const topOfMindRevisionReasonEnum = pgEnum(
  "top_of_mind_revision_reason",
  topOfMindRevisionReasonValues,
);

export const topOfMinds = pgTable(
  "top_of_minds",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Exactly one of profileId / groupId is set — see the CHECK below. */
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),

    version: integer("version").notNull().default(1),
    status: topOfMindStatusEnum("status").notNull().default("live"),
    reason: topOfMindRevisionReasonEnum("reason").notNull().default("initial"),

    /** Forward pointer to the version that replaced this one. */
    replacedById: uuid("replaced_by_id"),
    replacedAt: timestamp("replaced_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerExclusive: check(
      "top_of_minds_owner_exclusive",
      sql`(${table.profileId} IS NOT NULL AND ${table.groupId} IS NULL) OR (${table.profileId} IS NULL AND ${table.groupId} IS NOT NULL)`,
    ),
    // "There is exactly one top of mind per profile" as a database fact.
    oneLivePerProfile: uniqueIndex("top_of_minds_one_live_per_profile_idx")
      .on(table.profileId)
      .where(sql`${table.status} = 'live' AND ${table.profileId} IS NOT NULL`),
    oneLivePerGroup: uniqueIndex("top_of_minds_one_live_per_group_idx")
      .on(table.groupId)
      .where(sql`${table.status} = 'live' AND ${table.groupId} IS NOT NULL`),
    profileVersionIdx: index("top_of_minds_profile_version_idx").on(
      table.profileId,
      table.version.desc(),
    ),
  }),
);

export type TopOfMind = typeof topOfMinds.$inferSelect;
export type NewTopOfMind = typeof topOfMinds.$inferInsert;

// ---------------------------------------------------------------------------
// top_of_mind_entries
// ---------------------------------------------------------------------------

export const topOfMindEntryTypeValues = [
  "pattern",
  "tension",
  "question",
  "hypothesis",
  "action",
] as const;
export type TopOfMindEntryType = (typeof topOfMindEntryTypeValues)[number];
export const topOfMindEntryTypeEnum = pgEnum(
  "top_of_mind_entry_type",
  topOfMindEntryTypeValues,
);

export const topOfMindEntries = pgTable(
  "top_of_mind_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Room derivation policy; null legacy entries require review. */
    inputPolicy: text("input_policy"),

    topOfMindId: uuid("top_of_mind_id")
      .notNull()
      .references(() => topOfMinds.id, { onDelete: "cascade" }),

    type: topOfMindEntryTypeEnum("type").notNull(),

    /** The entry itself, in the owner's voice. */
    body: text("body").notNull(),
    bodyRevision: bigint('body_revision', { mode: 'bigint' }).notNull().default(sql`1`),
    /**
     * A crisp declarative claim, when the entry supports one. Native here by
     * deliberate decision rather than inherited: the old pipeline generated
     * belief statements, stored them, and then dropped them at the surface.
     */
    belief: text("belief"),
    /** An invitation to reflect — a question the entry raises. */
    prompt: text("prompt"),

    /** Human edit freezes the text against regeneration. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),

    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    topOfMindIdx: index("top_of_mind_entries_top_of_mind_idx").on(
      table.topOfMindId,
      table.sortOrder,
    ),
  }),
);

export type TopOfMindEntry = typeof topOfMindEntries.$inferSelect;
export type NewTopOfMindEntry = typeof topOfMindEntries.$inferInsert;

// ---------------------------------------------------------------------------
// top_of_mind_entry_signals — what each entry rests on
// ---------------------------------------------------------------------------

/**
 * Citations as foreign keys rather than an id array: the synthesis step is a
 * language model naming signals, and a real FK is what makes "every cited
 * signal exists" a database guarantee instead of a validation someone has to
 * remember to run.
 *
 * The FK guarantees the signal existed WHEN THE CITATION WAS WRITTEN. It does
 * not follow that deleting the signal later should unwrite the citation: this
 * used to be `notNull` + `onDelete: "cascade"`, which meant one signal delete
 * silently stripped citation rows out of every HISTORICAL version of every
 * artifact that had ever rested on it — personal and group alike. An old
 * version's entry then read as if it had cited nothing, which is
 * indistinguishable from the horoscope the validation exists to prevent, and
 * "history is walkable" was false one delete at a time. Now the signal's
 * departure leaves the row with a null `signalId`: the record that this entry
 * rested on something, whose owner has since taken it back.
 */
export const topOfMindEntrySignals = pgTable(
  "top_of_mind_entry_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementRevision: bigint('statement_revision', { mode: 'bigint' }),
    entryBodyRevision: bigint('entry_body_revision', { mode: 'bigint' }),

    entryId: uuid("entry_id")
      .notNull()
      .references(() => topOfMindEntries.id, { onDelete: "cascade" }),

    /** Null means the cited signal was deleted after this version was written. */
    signalId: uuid("signal_id").references(() => signals.id, {
      onDelete: "set null",
    }),

    /**
     * Which member's signal fed a group entry. Null on personal artifacts,
     * where the answer is never in question — and null after the owner
     * erases their account: the erasure doctrine (founder ruling,
     * 2026-08-23) says a sentence the room approved belongs to the room,
     * so the citation survives as a departed mark rather than cascading
     * away with the person.
     */
    ownerProfileId: uuid("owner_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entrySignalUnique: uniqueIndex("top_of_mind_entry_signals_unique_idx").on(
      table.entryId,
      table.signalId,
    ),
    entryIdx: index("top_of_mind_entry_signals_entry_idx").on(table.entryId),
  }),
);

export type TopOfMindEntrySignal = typeof topOfMindEntrySignals.$inferSelect;
export type NewTopOfMindEntrySignal = typeof topOfMindEntrySignals.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const topOfMindsRelations = relations(topOfMinds, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [topOfMinds.profileId],
    references: [profiles.id],
  }),
  group: one(groups, {
    fields: [topOfMinds.groupId],
    references: [groups.id],
  }),
  entries: many(topOfMindEntries),
}));

export const topOfMindEntriesRelations = relations(topOfMindEntries, ({ one, many }) => ({
  topOfMind: one(topOfMinds, {
    fields: [topOfMindEntries.topOfMindId],
    references: [topOfMinds.id],
  }),
  citations: many(topOfMindEntrySignals),
}));

export const topOfMindEntrySignalsRelations = relations(topOfMindEntrySignals, ({ one }) => ({
  entry: one(topOfMindEntries, {
    fields: [topOfMindEntrySignals.entryId],
    references: [topOfMindEntries.id],
  }),
  signal: one(signals, {
    fields: [topOfMindEntrySignals.signalId],
    references: [signals.id],
  }),
}));
