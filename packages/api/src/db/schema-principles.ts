/**
 * Layer 4 — principles: how the profile chooses, stripped of context.
 *
 * The structural mirror of top of mind. Top of mind is ONE bounded artifact,
 * rewritten whole and decaying by design; principles are a GROWING, uncapped
 * set selected by longevity — minted per candidate, merged on overlap, and
 * never truncated. A rule ("≤$100 for LLM testing") is context-bound and is
 * stored only as evidence; the principle is the generator it compiles from.
 * See docs/data-model.md ("Principle (layer 4)") and docs/goals/principles.md.
 *
 * Two columns carry the honesty model:
 *   - `state`: held (demonstrated by history), aspirational (declared by the
 *     owner, visibly undemonstrated), contested (in live dispute — the
 *     owner's verdict, or a judged conflict between two principles).
 *   - `origin`: minted (by the nightly generation) or declared (the owner's
 *     own words). Reconciliation after evidence loss reads it: a declared
 *     principle falls back to aspirational; an unedited minted one is removed.
 * Human-edited wording is preserved at any origin. unsupportedAt records loss
 * of support separately from a contested stance.
 */

import { relations, sql } from "drizzle-orm";
import {
  bigint,
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

import { profiles } from "./schema-profiles";
import { signals } from "./schema-signals";

export const principleTypeValues = ["value", "maxim", "stance"] as const;
export type PrincipleType = (typeof principleTypeValues)[number];
export const principleTypeEnum = pgEnum("principle_type", principleTypeValues);

export const principleStateValues = ["held", "aspirational", "contested"] as const;
export type PrincipleState = (typeof principleStateValues)[number];
export const principleStateEnum = pgEnum("principle_state", principleStateValues);

export const principleOriginValues = ["minted", "declared"] as const;
export type PrincipleOrigin = (typeof principleOriginValues)[number];
export const principleOriginEnum = pgEnum("principle_origin", principleOriginValues);

export const principles = pgTable(
  "principles",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    /** The directive, in the owner's language. Phrased as a constraint. */
    statement: text("statement").notNull(),
    statementRevision: bigint('statement_revision', { mode: 'bigint' }).notNull().default(sql`1`),
    /** Room derivation policy; never inferred from today's citations. */
    inputPolicy: text("input_policy"),

    type: principleTypeEnum("type").notNull().default("maxim"),
    state: principleStateEnum("state").notNull().default("held"),
    origin: principleOriginEnum("origin").notNull().default("minted"),

    /**
     * Position in the decidability order — THE tie-breaker when principles
     * conflict. Lower rank wins. Unique per profile so two principles can
     * never claim the same precedence.
     */
    rank: integer("rank").notNull(),

    /**
     * Set when the owner arranges the order. Sticky: once any row carries
     * this, generation only ever appends at the bottom and never re-sorts
     * what the owner arranged.
     */
    ownerRankedAt: timestamp("owner_ranked_at", { withTimezone: true }),

    /**
     * The edit-rule lock. Declarations are locked from birth — they are the
     * owner's words on arrival; a minted statement locks on first owner edit.
     */
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    /** When it became held — "held since" on every surface. */
    heldSince: timestamp("held_since", { withTimezone: true }),

    /** Evidence no longer clears the bar; human-owned words still stand. */
    unsupportedAt: timestamp("unsupported_at", { withTimezone: true }),

    /**
     * The other half of a judged conflict, when state is contested via the
     * conflict evaluation. Both rows point at each other; resolution (merge,
     * retire, or just rank them) clears it.
     */
    conflictsWithId: uuid("conflicts_with_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileRankUnique: uniqueIndex("principles_profile_rank_unique_idx").on(
      table.profileId,
      table.rank,
    ),
    profileStateIdx: index("principles_profile_state_idx").on(table.profileId, table.state),
    profileIdIdUnique: unique("principles_profile_id_id_unique").on(table.profileId, table.id),
  }),
);

export const principleSignals = pgTable(
  "principle_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementRevision: bigint('statement_revision', { mode: 'bigint' }),
    principleStatementRevision: bigint('principle_statement_revision', { mode: 'bigint' }),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    principleId: uuid("principle_id").notNull(),
    signalId: uuid("signal_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One citation per (principle, signal) — re-evaluation must not inflate
    // a principle's support by recounting the same signal.
    principleSignalUnique: uniqueIndex("principle_signals_principle_signal_unique_idx").on(
      table.principleId,
      table.signalId,
    ),
    principleIdx: index("principle_signals_principle_idx").on(table.principleId),
    signalIdx: index("principle_signals_signal_idx").on(table.signalId),
    // Both parents must belong to the same profile as the citation row.
    principleFk: foreignKey({
      columns: [table.profileId, table.principleId],
      foreignColumns: [principles.profileId, principles.id],
      name: "principle_signals_principle_fk",
    }).onDelete("cascade"),
    signalFk: foreignKey({
      columns: [table.profileId, table.signalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "principle_signals_signal_fk",
    }).onDelete("cascade"),
  }),
);

export const principlesRelations = relations(principles, ({ many }) => ({
  citations: many(principleSignals),
}));

export const principleSignalsRelations = relations(principleSignals, ({ one }) => ({
  principle: one(principles, {
    fields: [principleSignals.principleId],
    references: [principles.id],
  }),
  signal: one(signals, {
    fields: [principleSignals.signalId],
    references: [signals.id],
  }),
}));

export type Principle = typeof principles.$inferSelect;
export type PrincipleSignal = typeof principleSignals.$inferSelect;
