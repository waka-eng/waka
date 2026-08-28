/**
 * Sibling-read grants — the hand on the agent-to-agent door.
 *
 * goal: no-quiet-corners, Phase 6 (register item 5). The access matrix used
 * to give an agent-bound session read+capture on EVERY profile in the
 * account, sibling agents included — an open door nobody had asked for.
 * The flip to opt-in is founder-ruled (2026-08-23, signed in
 * docs/data-model.md's decision log) and ships with these rows: an agent
 * session may read a sibling agent's memory only through an explicit,
 * human-granted, revocable grant. The human's own profile needs no grant
 * (conditioning-and-relaying is the product), and the human session needs
 * none anywhere — the account holder is the account's admin.
 *
 * Revocation is a timestamp, not a delete: who could read whom, and when
 * that ended, is exactly the kind of fact this goal exists to keep. The
 * grant lists beside credentials, and like a credential it is
 * infrastructure — it is not memory, and it does not ride the export.
 */

import {
  index,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const agentReadGrants = pgTable(
  "agent_read_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The agent session allowed through the door. */
    granteeProfileId: uuid("grantee_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    /** The sibling agent whose memory may be read. */
    targetProfileId: uuid("target_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    /** The human hand that opened the door. Null once that profile is
        erased — a departed mark, never a dangling id. */
    grantedByProfileId: uuid("granted_by_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the human closes the door again. Takes effect on the next
        request — the check reads live rows, nothing is cached. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    granteeTargetIdx: index("agent_read_grants_grantee_target_idx").on(
      table.granteeProfileId,
      table.targetProfileId,
    ),
  }),
);

export type AgentReadGrant = typeof agentReadGrants.$inferSelect;
