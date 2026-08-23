/**
 * Drizzle ORM schema — inspirations (layer 1).
 *
 * An inspiration is a capture event: whatever arrived — pasted text, a link,
 * an image, an agent's relayed excerpt. Editable and deletable, unbounded,
 * and never distilled in place: distillation produces *signals* (layer 2),
 * which cite inspirations as evidence.
 *
 * Inspirations cross an account boundary ONLY when their author marked them
 * public. That is a deliberate reversal of the original invariant ("only
 * signals are shareable"): rooms now hold a field made of their members'
 * memories, so a room can show what people actually keep rather than only the
 * machine's readings of it. The gate is per capture and set by the person
 * saving it, never inferred and never defaulted open — `private` is the
 * default at the column level, so anything written by an older path or a
 * client that has not been updated stays invisible to everyone else.
 * See docs/data-model.md.
 *
 * `source` records whose initiative the content is, which is a different
 * fact from which session captured it (that is the session's bound profile):
 * an agent relaying the human's own words on request writes "app"; an agent
 * logging its own observation writes "agent".
 */

import { relations, sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

/** Shape of what arrived. Advisory: extraction reads the content regardless. */
/**
 * "decision" joined the shape kinds 2026-08-23 (goals/no-quiet-corners.md,
 * Phase 1): a decision is a capture, not a layer — recorded by the acting
 * session into its own profile, optionally citing the principles it
 * consulted through `decision_principle_citations`, whose composite FKs
 * make an invented citation physically unstorable.
 */
export const inspirationKindValues = ["note", "link", "image", "mixed", "decision"] as const;
export type InspirationKind = (typeof inspirationKindValues)[number];
export const inspirationKindEnum = pgEnum("inspiration_kind", inspirationKindValues);

/** Whose initiative the content is — never inferred from the connection. */
export const inspirationSourceValues = ["app", "agent"] as const;
export type InspirationSource = (typeof inspirationSourceValues)[number];
export const inspirationSourceEnum = pgEnum("inspiration_source", inspirationSourceValues);

/**
 * Who may see this capture. `private` is the whole archive's default and the
 * column default, so the failure mode of every bug, older row and stale
 * client is "nobody else sees it" rather than "everyone does".
 *
 * `public` does not mean the internet — it means the rooms this profile's
 * account belongs to. There is no world-readable capture.
 */
export const inspirationVisibilityValues = ["private", "public"] as const;
export type InspirationVisibility = (typeof inspirationVisibilityValues)[number];
export const inspirationVisibilityEnum = pgEnum(
  "inspiration_visibility",
  inspirationVisibilityValues,
);

export const inspirations = pgTable(
  "inspirations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    text: text("text").notNull(),
    kind: inspirationKindEnum("kind"),
    source: inspirationSourceEnum("source").notNull().default("app"),
    visibility: inspirationVisibilityEnum("visibility").notNull().default("private"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The archive's default read: newest first, scoped to one profile.
    profileCreatedIdx: index("inspirations_profile_created_idx").on(
      table.profileId,
      table.createdAt.desc(),
    ),
    /**
     * Full-text search index. The old archive filtered the newest ~200 rows
     * in application memory, so recall silently stopped at the edge of that
     * window; searching in Postgres is what makes a deep archive findable.
     * "simple" rather than "english": WAKA captures are frequently Korean,
     * and the simple configuration does not stem-mangle non-English text.
     */
    textSearchIdx: index("inspirations_text_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${table.text})`,
    ),
    /**
     * The target of every child table's composite foreign key. Children
     * reference (profile_id, id) rather than id alone, so Postgres itself
     * refuses a row whose parent belongs to a different profile — tenant
     * isolation becomes an invariant of the schema instead of a rule every
     * query has to remember.
     *
     * A table constraint rather than a unique index: a composite foreign key
     * needs its target to exist when the constraint is created, and
     * constraints are emitted with the table while indexes come after.
     */
    profileIdIdUnique: unique("inspirations_profile_id_id_unique").on(
      table.profileId,
      table.id,
    ),
  }),
);

export type Inspiration = typeof inspirations.$inferSelect;
export type NewInspiration = typeof inspirations.$inferInsert;

export const inspirationsRelations = relations(inspirations, ({ one }) => ({
  profile: one(profiles, {
    fields: [inspirations.profileId],
    references: [profiles.id],
  }),
}));
