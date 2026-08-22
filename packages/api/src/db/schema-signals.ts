/**
 * Drizzle ORM schema — signals (layer 2), their evidence, and their shares.
 *
 * A signal is an evidence-backed pattern: a durable distilled statement — a
 * taste, a theme, a tension, a belief — that cites inspirations as evidence.
 * WAKA generates signals; the profile's owner may curate them.
 *
 * Evidence is M:N. One signal cites many inspirations; one inspiration can
 * support many signals. New inspirations either strengthen an existing
 * signal (more evidence, higher confidence) or mint a new one — signals are
 * patterns, not per-capture fragments.
 *
 * The signal is also **the only shareable unit**: a share exposes the
 * distilled statement to a group, never the evidence behind it.
 *
 * The lock rule: a human edit freezes the statement. Regeneration may keep
 * attaching evidence and updating confidence, but never rewrites locked
 * text. A locked signal whose evidence all disappears survives, marked
 * unsupported, rather than being retired.
 */

import { relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { groups } from "./schema-groups";
import { inspirations } from "./schema-inspirations";
import { profiles } from "./schema-profiles";

/**
 * emerging  — minted, below the evidence bar; not yet eligible for the top of mind.
 * active    — promoted (>= MIN evidence); the working set.
 * retired   — evidence gone (and unlocked), or hidden by the owner.
 */
export const signalStatusValues = ["emerging", "active", "retired"] as const;
export type SignalStatus = (typeof signalStatusValues)[number];
export const signalStatusEnum = pgEnum("signal_status", signalStatusValues);

export const evidenceQuoteSourceValues = ["own", "enrichment"] as const;
export type EvidenceQuoteSource = (typeof evidenceQuoteSourceValues)[number];
export const evidenceQuoteSourceEnum = pgEnum(
  "evidence_quote_source",
  evidenceQuoteSourceValues,
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    /** The distilled pattern, in the profile owner's own language. */
    statement: text("statement").notNull(),

    status: signalStatusEnum("status").notNull().default("emerging"),

    /** 0–100, derived from evidence count, time spread, and source diversity. */
    confidence: integer("confidence").notNull().default(0),

    /**
     * Set when a human edits the statement. Non-null means the text is
     * frozen against regeneration — the absolute half of the edit rule.
     */
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    /**
     * Set when a locked signal loses its last evidence. The statement stays
     * (it is the human's), but nothing supports it any more, and readers
     * deserve to know that rather than seeing a confident orphan.
     */
    unsupportedAt: timestamp("unsupported_at", { withTimezone: true }),

    /**
     * Denormalized recency of the newest evidence link. Ranking reads it on
     * every top-of-mind selection; recomputing it from the join each time
     * would be the hot query in the system.
     */
    lastEvidenceAt: timestamp("last_evidence_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileStatusIdx: index("signals_profile_status_idx").on(table.profileId, table.status),
    profileRecencyIdx: index("signals_profile_recency_idx").on(
      table.profileId,
      table.lastEvidenceAt.desc(),
    ),
    /**
     * Target of the composite foreign keys from evidence, shares, and
     * embeddings: a child row must name the same profile as its signal, so
     * a cross-tenant link cannot be written even by buggy application code.
     * A constraint rather than an index, because a composite foreign key
     * needs its target to exist at the moment the constraint is created.
     */
    profileIdIdUnique: unique("signals_profile_id_id_unique").on(table.profileId, table.id),
  }),
);

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;

// ---------------------------------------------------------------------------
// signal_evidence — the M:N link that makes a signal evidence-backed
// ---------------------------------------------------------------------------

export const signalEvidence = pgTable(
  "signal_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    signalId: uuid("signal_id").notNull(),
    inspirationId: uuid("inspiration_id").notNull(),

    /** Why this capture supports this pattern — generated, bounded. */
    reason: text("reason"),
    /**
     * A verbatim span from the inspiration or its attachment enrichment.
     * Nullable on purpose: a missing quote is honest, an invented one is not.
     * Since 2026-08-22 a quote is stored only after `verifyQuote` confirmed
     * it is a literal (whitespace-normalized) span of its source; rows
     * written before then carry a quote with a null `quoteSource`, which is
     * how a surface tells a verified span from a legacy unverified one.
     */
    quote: text("quote"),
    /**
     * Whose words the verified quote is: the person's own text (their
     * capture and reflections) or the fetched page behind their link. The
     * two are different claims about a person and must never render alike.
     * Null when there is no quote — or when the quote predates verification.
     */
    quoteSource: evidenceQuoteSourceEnum("quote_source"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One evidence row per (signal, inspiration) — re-derivation must not
    // inflate a signal's support by recounting the same capture.
    signalInspirationUnique: uniqueIndex("signal_evidence_signal_inspiration_unique_idx").on(
      table.signalId,
      table.inspirationId,
    ),
    signalIdx: index("signal_evidence_signal_idx").on(table.signalId),
    inspirationIdx: index("signal_evidence_inspiration_idx").on(table.inspirationId),
    // Both parents must belong to the same profile as the evidence row.
    signalFk: foreignKey({
      columns: [table.profileId, table.signalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_evidence_signal_fk",
    }).onDelete("cascade"),
    inspirationFk: foreignKey({
      columns: [table.profileId, table.inspirationId],
      foreignColumns: [inspirations.profileId, inspirations.id],
      name: "signal_evidence_inspiration_fk",
    }).onDelete("cascade"),
  }),
);

export type SignalEvidence = typeof signalEvidence.$inferSelect;
export type NewSignalEvidence = typeof signalEvidence.$inferInsert;

// ---------------------------------------------------------------------------
// signal_shares — sharing lives here, at layer 2, and nowhere else
// ---------------------------------------------------------------------------

export const signalShares = pgTable(
  "signal_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    signalId: uuid("signal_id").notNull(),

    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    signalGroupUnique: uniqueIndex("signal_shares_signal_group_unique_idx").on(
      table.signalId,
      table.groupId,
    ),
    groupIdx: index("signal_shares_group_idx").on(table.groupId),
    // Only the signal's own profile can share it.
    signalFk: foreignKey({
      columns: [table.profileId, table.signalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_shares_signal_fk",
    }).onDelete("cascade"),
  }),
);

export type SignalShare = typeof signalShares.$inferSelect;
export type NewSignalShare = typeof signalShares.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const signalsRelations = relations(signals, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [signals.profileId],
    references: [profiles.id],
  }),
  evidence: many(signalEvidence),
  shares: many(signalShares),
}));

export const signalEvidenceRelations = relations(signalEvidence, ({ one }) => ({
  signal: one(signals, {
    fields: [signalEvidence.signalId],
    references: [signals.id],
  }),
  inspiration: one(inspirations, {
    fields: [signalEvidence.inspirationId],
    references: [inspirations.id],
  }),
}));

export const signalSharesRelations = relations(signalShares, ({ one }) => ({
  signal: one(signals, {
    fields: [signalShares.signalId],
    references: [signals.id],
  }),
  group: one(groups, {
    fields: [signalShares.groupId],
    references: [groups.id],
  }),
}));
