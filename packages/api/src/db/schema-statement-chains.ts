/**
 * Statement chains — the machine's original survives (L2 and L4).
 *
 * goal: no-quiet-corners, Phase 2 (register item 1, debt 2). Signals and
 * principles used to overwrite their statement in place: a human edit
 * destroyed the machine's prior sentence, so "what did WAKA think before I
 * corrected it" was unanswerable and revert-to-generated was impossible
 * even in principle. These two tables extend the proven layer-3 writer
 * pattern — supersede chain, forward pointer, partial unique index, reason
 * enum — down to layer 2 and up to layer 4.
 *
 * The chain's law: rows are only ever appended and superseded, never
 * deleted by any writer — the one way a chain row leaves is with its
 * parent (cascade), which is the same erasure doctrine every record here
 * follows. Exactly one row per parent is CURRENT (`superseded_at` null,
 * enforced by partial unique index); the forward pointer is filled the
 * moment a successor lands.
 *
 * `reason` says whose hand wrote each row: derived / restated / minted are
 * the machine's; declared / edited are the owner's; reverted is the
 * machine's sentence returned byte-for-byte by the owner's own act. The
 * revert verb reads the newest machine-side row — see
 * `lib/statement-chains.ts`.
 */

import { isNull, relations, type Column } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* drizzle's partial-index `.where` takes SQL; this keeps the two current-row
   indexes below readable and identical */
const sqlIsNull = (column: Column) => isNull(column);

import { principles } from "./schema-principles";
import { profiles } from "./schema-profiles";
import { signals } from "./schema-signals";

/**
 * derived   — a signal's first statement, written at mint (machine)
 * restated  — the machine reworded an emerging signal on a confirming capture
 * minted    — a principle's first statement, written by generation (machine)
 * declared  — the owner's own principle, their words from birth
 * edited    — the owner rewrote the statement (locks it)
 * reverted  — the machine's statement restored byte-for-byte, lock cleared
 */
export const statementReasonValues = [
  "derived",
  "restated",
  "minted",
  "declared",
  "edited",
  "reverted",
] as const;
export type StatementReason = (typeof statementReasonValues)[number];
export const statementReasonEnum = pgEnum("statement_reason", statementReasonValues);

/** The machine's side of the enum — what the revert verb may return to. */
export const MACHINE_STATEMENT_REASONS: readonly StatementReason[] = [
  "derived",
  "restated",
  "minted",
  "reverted",
];

export const signalStatements = pgTable(
  "signal_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    signalId: uuid("signal_id").notNull(),

    statement: text("statement").notNull(),
    reason: statementReasonEnum("reason").notNull(),

    /** Forward pointer, filled the moment a successor lands. */
    supersededById: uuid("superseded_by_id"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Exactly one current statement per signal.
    currentUnique: uniqueIndex("signal_statements_current_unique_idx")
      .on(table.signalId)
      .where(sqlIsNull(table.supersededAt)),
    signalIdx: index("signal_statements_signal_idx").on(table.signalId),
    signalFk: foreignKey({
      columns: [table.profileId, table.signalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_statements_signal_fk",
    }).onDelete("cascade"),
  }),
);

export const principleStatements = pgTable(
  "principle_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    principleId: uuid("principle_id").notNull(),

    statement: text("statement").notNull(),
    reason: statementReasonEnum("reason").notNull(),

    supersededById: uuid("superseded_by_id"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    currentUnique: uniqueIndex("principle_statements_current_unique_idx")
      .on(table.principleId)
      .where(sqlIsNull(table.supersededAt)),
    principleIdx: index("principle_statements_principle_idx").on(table.principleId),
    principleFk: foreignKey({
      columns: [table.profileId, table.principleId],
      foreignColumns: [principles.profileId, principles.id],
      name: "principle_statements_principle_fk",
    }).onDelete("cascade"),
  }),
);

export type SignalStatement = typeof signalStatements.$inferSelect;
export type PrincipleStatement = typeof principleStatements.$inferSelect;

export const signalStatementsRelations = relations(signalStatements, ({ one }) => ({
  signal: one(signals, {
    fields: [signalStatements.signalId],
    references: [signals.id],
  }),
}));

export const principleStatementsRelations = relations(principleStatements, ({ one }) => ({
  principle: one(principles, {
    fields: [principleStatements.principleId],
    references: [principles.id],
  }),
}));
