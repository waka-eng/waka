/**
 * Drizzle ORM schema — mcp_reads: what each key read, for the person to see.
 *
 * Founder, 2026-11-26 (agent to agent, "build all except 5"): an agent that
 * reads someone's memory should do it in the open. Every read a standing key
 * (a keeper key, or an agent profile's key) makes through the API is one row
 * here: whose memory, which key, which tool, and the one detail a person
 * needs to recognise it (what was searched for, how many principles). It is
 * shown in Settings beside the keys, and revoking the key is how to stop it.
 *
 * Kept for `MCP_READ_KEEP_DAYS`, then swept by the daily run. It is
 * infrastructure beside `consultations` (which answers what was SERVED for
 * the record), never input to generation.
 */
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const MCP_READ_KEEP_DAYS = 90;

/* "other": any other read a key made, so nothing it read goes unlogged. */
export const mcpReadToolValues = ["principles", "recall", "inspirations", "inspiration", "signals", "top_of_mind", "profiles", "other"] as const;
export type McpReadTool = (typeof mcpReadToolValues)[number];

export const mcpReads = pgTable(
  "mcp_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Whose memory was read. Erasing the profile takes its log with it. */
    profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** Which kind of standing key read: the person's keeper key, or an agent's. */
    keyKind: text("key_kind").$type<"keeper" | "agent">().notNull(),
    /** The key's id. No foreign key: the record outlives a revoked or deleted key. */
    keyId: uuid("key_id").notNull(),
    tool: text("tool").$type<McpReadTool>().notNull(),
    /** A search's words, or how many were read; never the memory itself. */
    detail: text("detail"),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileReadIdx: index("mcp_reads_profile_read_idx").on(table.profileId, table.readAt),
  }),
);

export type McpRead = typeof mcpReads.$inferSelect;
