/**
 * Drizzle ORM schema — signal activations.
 *
 * The leaky integrate-and-fire layer of the spark engine
 * (docs/brain-inspired-spark-engine.md). One row per signal that has ever
 * been charged: captures charge semantic neighbors, revisits/reflections/
 * edits charge the signal itself. Activation decays lazily (half-life is
 * applied at read time), so rows are only written when a charge arrives.
 *
 * This is machine-derived ops data (the "unconscious"): it never enters
 * vault files and is fully rebuildable — dropping the table only delays
 * sparks, never loses meaning.
 */

import { index, pgTable, real, timestamp, uuid } from "drizzle-orm/pg-core";

import { signals, users } from "./schema";

export const signalActivations = pgTable(
  "signal_activations",
  {
    inspirationId: uuid("signal_id")
      .primaryKey()
      .references(() => signals.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Nominal charge as of `activatedAt`; decay is applied at read time. */
    activation: real("activation").notNull().default(0),

    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * Last time this signal's neighborhood was evaluated for convergence
     * firing — the refractory bookkeeping that bounds judge cost.
     */
    lastFireCheckAt: timestamp("last_fire_check_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userActivationIdx: index("signal_activations_user_activation_idx").on(
      table.userId,
      table.activation.desc(),
    ),
  }),
);

export type SignalActivation = typeof signalActivations.$inferSelect;
export type NewSignalActivation = typeof signalActivations.$inferInsert;
