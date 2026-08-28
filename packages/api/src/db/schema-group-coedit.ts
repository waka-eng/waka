/**
 * Drizzle ORM schema — group co-editing: proposals and affirmations.
 *
 * A group's top of mind is not edited by whoever clicks first. A member
 * proposes a change to an entry (or a new entry); other members affirm it;
 * an accepted proposal is what produces the next version of the artifact.
 *
 * This is the direction machinery from the previous model, re-pointed at
 * top-of-mind entries — the mechanism was sound, it was just attached to a
 * concept that no longer exists.
 */

import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { groups } from "./schema-groups";
import { profiles } from "./schema-profiles";
import { topOfMindEntries } from "./schema-top-of-mind";

export const groupProposalKindValues = ["edit_entry", "add_entry", "remove_entry"] as const;
export type GroupProposalKind = (typeof groupProposalKindValues)[number];
export const groupProposalKindEnum = pgEnum("group_proposal_kind", groupProposalKindValues);

export const groupProposalStatusValues = ["open", "accepted", "declined"] as const;
export type GroupProposalStatus = (typeof groupProposalStatusValues)[number];
export const groupProposalStatusEnum = pgEnum(
  "group_proposal_status",
  groupProposalStatusValues,
);

/**
 * What a member said to a proposal. Founder ruling (2026-08-23): refusal is a
 * COUNTED STANCE, not a veto — a "declined" row is a recorded no that sits in
 * the tally beside the yeses, and the proposal falls only when the nos make a
 * majority of yeses impossible. One person can no longer kill a sentence for
 * a room of five by pressing first.
 */
export const groupStanceValues = ["affirmed", "declined"] as const;
export type GroupStance = (typeof groupStanceValues)[number];
export const groupStanceEnum = pgEnum("group_stance", groupStanceValues);

export const groupTopOfMindProposals = pgTable(
  "group_top_of_mind_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),

    /** Null for add_entry — there is no entry yet. */
    entryId: uuid("entry_id").references(() => topOfMindEntries.id, { onDelete: "cascade" }),

    /**
     * Nullable since the erasure doctrine (founder ruling, 2026-08-23): a
     * SETTLED proposal is the room's record of a decision, so it outlives
     * its author — erasure sets this null and the surface reads "someone".
     * The erased author's OPEN proposals are withdrawn explicitly by
     * `eraseAccount` instead: an unanswered ask leaves with the asker.
     */
    proposedByProfileId: uuid("proposed_by_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),

    kind: groupProposalKindEnum("kind").notNull(),
    status: groupProposalStatusEnum("status").notNull().default("open"),

    /** The proposed text. Null for remove_entry. */
    body: text("body"),
    /** Why the member thinks the wall should say this. */
    rationale: text("rationale"),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupStatusIdx: index("group_top_of_mind_proposals_group_status_idx").on(
      table.groupId,
      table.status,
    ),
  }),
);

export type GroupTopOfMindProposal = typeof groupTopOfMindProposals.$inferSelect;
export type NewGroupTopOfMindProposal = typeof groupTopOfMindProposals.$inferInsert;

export const groupTopOfMindAffirmations = pgTable(
  "group_top_of_mind_affirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => groupTopOfMindProposals.id, { onDelete: "cascade" }),

    /**
     * Nullable since the erasure doctrine (founder ruling, 2026-08-23): a
     * stance on a SETTLED decision is history and outlives the person who
     * held it — erasure sets this null. Stances on still-open proposals are
     * withdrawn explicitly by `eraseAccount`, the same way removal from a
     * room withdraws a live hand.
     */
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),

    /**
     * The answer itself. The table name predates the ruling that made a no
     * recordable — it now holds every stance, and renaming it would churn
     * the room-history record for a word. The default keeps every row from
     * before the ruling meaning what it meant: those rows were all yeses.
     */
    stance: groupStanceEnum("stance").notNull().default("affirmed"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One stance per member per proposal — an answer is not a counter you can
    // run up by clicking repeatedly; answering again replaces your answer.
    proposalProfileUnique: uniqueIndex("group_top_of_mind_affirmations_unique_idx").on(
      table.proposalId,
      table.profileId,
    ),
  }),
);

export type GroupTopOfMindAffirmation = typeof groupTopOfMindAffirmations.$inferSelect;
export type NewGroupTopOfMindAffirmation = typeof groupTopOfMindAffirmations.$inferInsert;

export const groupTopOfMindProposalsRelations = relations(
  groupTopOfMindProposals,
  ({ one, many }) => ({
    group: one(groups, {
      fields: [groupTopOfMindProposals.groupId],
      references: [groups.id],
    }),
    proposedBy: one(profiles, {
      fields: [groupTopOfMindProposals.proposedByProfileId],
      references: [profiles.id],
    }),
    affirmations: many(groupTopOfMindAffirmations),
  }),
);

export const groupTopOfMindAffirmationsRelations = relations(
  groupTopOfMindAffirmations,
  ({ one }) => ({
    proposal: one(groupTopOfMindProposals, {
      fields: [groupTopOfMindAffirmations.proposalId],
      references: [groupTopOfMindProposals.id],
    }),
  }),
);
