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

export const groupTopOfMindProposals = pgTable(
  "group_top_of_mind_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),

    /** Null for add_entry — there is no entry yet. */
    entryId: uuid("entry_id").references(() => topOfMindEntries.id, { onDelete: "cascade" }),

    proposedByProfileId: uuid("proposed_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

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

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One affirmation per member per proposal — agreement is not a counter
    // you can run up by clicking repeatedly.
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
