/**
 * harvest_candidates — sentences of the person's own, picked from their work
 * by a collector they run, waiting for them to keep or let go.
 *
 * Founder, 2026-10-15: "if I use the WAKA MCP, then the agent would derive
 * 'oh, this looks like inspiration, this looks important' ... so in here we
 * need more than a yes and a no. When the user says no, select why not."
 * The design is the "WAKA Harvest" artifact of 2026-10-12, and
 * `docs/plans/2026-10-15-claims-principles-share.md` holds the decisions.
 *
 * ── THE BASKET, NOT THE CHEST ───────────────────────────────────────────
 *
 * A candidate is not an inspiration. Nothing here is read by signal
 * extraction, the top of mind or principles, and nothing here is a memory:
 * it becomes one only when the person keeps it, and then it is written as an
 * ordinary inspiration through the ordinary save, and this row only points
 * at it.
 *
 * ── THE WORDS LIVE HERE ONLY WHILE UNDECIDED ────────────────────────────
 *
 * `text` is present exactly while `status` is `pending`, and a CHECK holds
 * that. Kept: the words now live in the inspiration. Declined: the words
 * are deleted at once and only the reason, the context and the hash stay.
 * Lapsed after seven days unchosen: the words, the title and the hash go,
 * and only the context and the fact of lapsing stay.
 *
 * Deleting on lapse is consistent with "fading never deletes". That law
 * protects what a person kept; a candidate was never kept, and holding
 * unchosen lines from private conversations indefinitely would be the larger
 * breach. The hash goes on lapse so a sentence that stays true may be
 * proposed again; it stays on decline so a refused sentence is not.
 *
 * ── WHO MAY WRITE WHAT ──────────────────────────────────────────────────
 *
 * Proposing is open to the human's own sessions, the keeper key included:
 * that key's whole job is to carry things in from a terminal. Deciding is a
 * browser act — `humanSessionsOnly` refuses the keeper key — because a key
 * on disk approving what its own collector gathered would be the machine
 * making the memory on the person's behalf.
 */
import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { inspirations } from "./schema-inspirations";
import { profiles } from "./schema-profiles";

export const harvestStatusValues = ["pending", "kept", "declined", "lapsed"] as const;
export type HarvestStatus = (typeof harvestStatusValues)[number];

/** Why a candidate was not kept — six reasons: the five in the Harvest
    design, and `other`, the person's own answer in `reasonNote`
    (2026-10-15: "let user provide their own answers"). */
export const harvestReasonValues = ["not_mine", "already_kept", "private", "trivial", "miscut", "other"] as const;
export type HarvestReason = (typeof harvestReasonValues)[number];

/**
 * Where a candidate came from, described without its content: which tool,
 * which project, what time of day, how far into the session. It is what
 * lets the collector learn when the person is worth listening to without
 * keeping anything they said.
 */
export interface HarvestContext {
  tool?: string;
  project?: string;
  hour?: number;
  position?: string;
  mode?: string;
  readExternal?: boolean;
  exploration?: boolean;
}

export const harvestCandidates = pgTable(
  "harvest_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** The person's own words, verbatim. Present only while pending. */
    text: text("text"),
    /** A short label the collector may give; never a rewrite of the words. */
    title: text("title"),
    context: jsonb("context").$type<HarvestContext>().notNull().default({}),
    /** SHA-256 of the normalised words. Kept on keep and decline, so the same
        sentence is not proposed twice; dropped on lapse. */
    sourceHash: text("source_hash"),
    status: text("status").$type<HarvestStatus>().notNull().default("pending"),
    reason: text("reason").$type<HarvestReason>(),
    /** Why not, in the person's own words, when `reason` is `other`. */
    reasonNote: text("reason_note"),
    inspirationId: uuid("inspiration_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => ({
    waiting: index("harvest_candidates_waiting").on(table.profileId, table.status, table.createdAt),
    once: uniqueIndex("harvest_candidates_once").on(table.profileId, table.sourceHash),
    /* Declared without `.onDelete(...)` on purpose: deleting the save must
       null `inspiration_id` ALONE, and a bare composite `ON DELETE SET NULL`
       would null `profile_id` too. The column-list form `ON DELETE SET NULL
       ("inspiration_id")` that says so is not expressible in the builder, so
       it lives in migration 0072 — the same split `conversations`'
       `initial_inspiration_id` uses. */
    keptAs: foreignKey({
      columns: [table.profileId, table.inspirationId],
      foreignColumns: [inspirations.profileId, inspirations.id],
      name: "harvest_candidates_inspiration_fk",
    }),
    statusCheck: check("harvest_candidates_status_check", sql`${table.status} IN ('pending','kept','declined','lapsed')`),
    reasonCheck: check(
      "harvest_candidates_reason_check",
      sql`${table.reason} IS NULL OR ${table.reason} IN ('not_mine','already_kept','private','trivial','miscut','other')`,
    ),
    reasonNoteCheck: check(
      "harvest_candidates_reason_note_check",
      sql`${table.reasonNote} IS NULL OR (${table.reason} = 'other' AND length(${table.reasonNote}) BETWEEN 1 AND 280)`,
    ),
    wordsWhileWaiting: check("harvest_candidates_words_check", sql`(${table.status} = 'pending') = (${table.text} IS NOT NULL)`),
  }),
);
