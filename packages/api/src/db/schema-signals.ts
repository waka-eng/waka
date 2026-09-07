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
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
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
     * Set when the owner throws the pattern out. The row, its evidence and
     * its embedding all stay — dismissal deletes nothing — and from this
     * moment the embedding is a SUPPRESSION ANCHOR: derivation refuses any
     * candidate near it instead of minting, and writes a `suppressions` row
     * naming this signal. Dismissed rows also carry `status = retired`, which
     * is what already keeps them out of the match scan and the top of mind;
     * this timestamp is the extra fact — refused by their owner, anchoring
     * the ground — and clearing it (the restore verb) returns the pattern to
     * the loop's sight. goals/the-legible-loop.md Phase 3.
     */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),

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

    /**
     * WHOSE MEMORY THIS ROW CITES — split from `profileId` on 2026-08-24,
     * when rooms started distilling from their pooled ground. For a personal
     * signal the two are the same profile; for a room's signal `profileId`
     * is the room's mind and this is the member whose memory stands under
     * the statement. The inspiration FK runs through THIS column, so an
     * evidence row still cannot name a memory its stated owner does not
     * hold — the room case is a lawful pairing, not a loosened net. It is
     * also what the two-voices gate counts: a room signal appears only once
     * `COUNT(DISTINCT owner_profile_id) >= 2`.
     */
    ownerProfileId: uuid("owner_profile_id").notNull(),

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
      columns: [table.ownerProfileId, table.inspirationId],
      foreignColumns: [inspirations.profileId, inspirations.id],
      name: "signal_evidence_inspiration_fk",
    }).onDelete("cascade"),
    /** The two-voices gate's index: COUNT(DISTINCT owner) per signal. */
    signalOwnerIdx: index("signal_evidence_signal_owner_idx").on(
      table.signalId,
      table.ownerProfileId,
    ),
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
// signal_contradictions — contested pairs, held on the record
// ---------------------------------------------------------------------------

/** What owner act settled a contested pair. */
export const contradictionResolutionValues = ["lock", "verdict", "dismissal"] as const;
export type ContradictionResolution = (typeof contradictionResolutionValues)[number];
export const contradictionResolutionEnum = pgEnum(
  "contradiction_resolution",
  contradictionResolutionValues,
);

/**
 * An undirected `contradicts` relation between two of one profile's signals,
 * minted when the three-way judge answers `opposed` in the ambiguous cosine
 * band (goals/no-quiet-corners.md Phase 5). While `resolvedAt` is null both
 * sides serve as CONTESTED — an unresolved conflict awaiting arbitration.
 *
 * Resolution comes ONLY from an owner act — a lock, a verdict, a dismissal.
 * That is doctrine, not design: ruled by the founder 2026-08-23 ("never —
 * the owner resolves", signed in docs/data-model.md's decision log). No
 * evidence weight, however lopsided, resolves a pair on its own. The loser
 * becomes YIELDED — `yieldedSignalId`, a state read off this row — and its
 * signal row stands untouched: a state, never a deletion.
 *
 * Undirected: the pair is stored once with `aSignalId < bSignalId`
 * (normalized by the writer in lib/contested-pairs.ts), so "A contradicts
 * B" and "B contradicts A" cannot drift into two rows.
 */
/**
 * THE GARDENER'S FINDINGS — two standing signals the judge says name ONE
 * pattern. A row is a PROPOSAL: the merge itself is the owner's act (the
 * world never moves unless the user moved it, and a merge moves their
 * memory), resolved as `merged` (evidence unions under the survivor named
 * in `mergedIntoSignalId`, the other retires) or `kept_apart` (a standing
 * answer the gardener respects forever — the pair is never proposed again).
 *
 * Undirected like the contradictions beside it: stored once with
 * `aSignalId < bSignalId`, so one pair cannot drift into two rows.
 */
export const duplicateResolutionEnum = pgEnum("duplicate_resolution", [
  "merged",
  "kept_apart",
]);

export const signalDuplicates = pgTable(
  "signal_duplicates",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    aSignalId: uuid("a_signal_id").notNull(),
    bSignalId: uuid("b_signal_id").notNull(),

    /** the cosine that made the pair suspect, for the record */
    similarity: real("similarity").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: duplicateResolutionEnum("resolved_by"),
    /** the survivor, when resolved as merged — the provenance of the merge */
    mergedIntoSignalId: uuid("merged_into_signal_id"),
  },
  (table) => ({
    pairUnique: uniqueIndex("signal_duplicates_pair_unique_idx").on(
      table.aSignalId,
      table.bSignalId,
    ),
    profileIdx: index("signal_duplicates_profile_idx").on(table.profileId),
    aIdx: index("signal_duplicates_a_idx").on(table.aSignalId),
    bIdx: index("signal_duplicates_b_idx").on(table.bSignalId),
    aFk: foreignKey({
      columns: [table.profileId, table.aSignalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_duplicates_a_fk",
    }).onDelete("cascade"),
    bFk: foreignKey({
      columns: [table.profileId, table.bSignalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_duplicates_b_fk",
    }).onDelete("cascade"),
  }),
);

export type SignalDuplicate = typeof signalDuplicates.$inferSelect;

export const signalContradictions = pgTable(
  "signal_contradictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    aSignalId: uuid("a_signal_id").notNull(),
    bSignalId: uuid("b_signal_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** The side that yielded; one of a/b, null while unresolved. */
    yieldedSignalId: uuid("yielded_signal_id"),
    resolvedBy: contradictionResolutionEnum("resolved_by"),
  },
  (table) => ({
    pairUnique: uniqueIndex("signal_contradictions_pair_unique_idx").on(
      table.aSignalId,
      table.bSignalId,
    ),
    aIdx: index("signal_contradictions_a_idx").on(table.aSignalId),
    bIdx: index("signal_contradictions_b_idx").on(table.bSignalId),
    aFk: foreignKey({
      columns: [table.profileId, table.aSignalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_contradictions_a_fk",
    }).onDelete("cascade"),
    bFk: foreignKey({
      columns: [table.profileId, table.bSignalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_contradictions_b_fk",
    }).onDelete("cascade"),
  }),
);

export type SignalContradiction = typeof signalContradictions.$inferSelect;

// ---------------------------------------------------------------------------
// suppressions — the ground's refusals, on the record
// ---------------------------------------------------------------------------

/**
 * One row per candidate the ground refused: derivation found the candidate at
 * or above `SIGNAL_SUPPRESSION_MIN_COSINE` to a DISMISSED signal's vector and
 * dropped it instead of minting. Every refusal is written here — a silence
 * this system creates is a logged, legible silence, never a quiet one
 * (goals/the-legible-loop.md Phase 3; the antechamber in Phase 5 renders
 * these rows).
 *
 * FK doctrine, same as consultations: the record belongs to the profile whose
 * ground refused (cascade — erasing the person takes their record). The
 * anchor and the capture are simple set-null references — the mark outlives
 * both, which is why the two statements are snapshotted as text: "what was
 * refused, and how close to what" must stay answerable after either row is
 * truly deleted.
 */
export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    /** The dismissed signal whose vector refused this candidate. */
    anchorSignalId: uuid("anchor_signal_id").references(() => signals.id, {
      onDelete: "set null",
    }),
    /** What the anchor said at the moment it refused — survives its deletion. */
    anchorStatement: text("anchor_statement").notNull(),

    /** The capture whose derivation produced the refused candidate. */
    inspirationId: uuid("inspiration_id").references(() => inspirations.id, {
      onDelete: "set null",
    }),
    /** The refused candidate's words — what the antechamber shows. */
    candidateStatement: text("candidate_statement").notNull(),

    /**
     * The cosine that decided, at decision time. Stored because it cannot be
     * recomputed later (vectors move when statements are re-embedded) and a
     * refusal a person cannot audit is not a record. Renders nowhere — the
     * numeral law binds the chrome, not the archive.
     */
    similarity: doublePrecision("similarity").notNull(),

    suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The antechamber and the weather report both read one profile's
    // refusals newest-first.
    profileSuppressedIdx: index("suppressions_profile_suppressed_idx").on(
      table.profileId,
      table.suppressedAt,
    ),
    anchorIdx: index("suppressions_anchor_idx").on(table.anchorSignalId),
  }),
);

export type Suppression = typeof suppressions.$inferSelect;
export type NewSuppression = typeof suppressions.$inferInsert;

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

export const suppressionsRelations = relations(suppressions, ({ one }) => ({
  profile: one(profiles, {
    fields: [suppressions.profileId],
    references: [profiles.id],
  }),
  anchorSignal: one(signals, {
    fields: [suppressions.anchorSignalId],
    references: [signals.id],
  }),
  inspiration: one(inspirations, {
    fields: [suppressions.inspirationId],
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
